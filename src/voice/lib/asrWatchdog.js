/**
 * Watchdog del ASR en CONVERSACION: una sola decision por tick.
 *
 * DEFECTO MEDIDO (2026-10-20): la decision vivia dentro del efecto del hook, con la
 * degradacion ARRIBA del rebuild. Resultado: a los 3,5 s de una pausa con ruido se
 * encendia Whisper (que alucina) y Chrome no llegaba a reconstruirse nunca; ademas
 * no habia recuperacion (el latch no volvia a Chrome).
 *
 * Orden UNICO por tick (y una sola razon por paso):
 *   1. `recover-back`  la ventana de prueba de Chrome vencio SIN resultado -> local;
 *   2. `recover`       el motor local lleva `recoveryMs` sin FINALES ACEPTADOS (o
 *                      `recoverySegments` finales): se reintenta Chrome. El reloj
 *                      NO cuenta parciales: Whisper puede emitir parciales
 *                      indefinidamente y la recuperacion debe ocurrir igual;
 *   3. `rebuild`       Chrome lleva demasiado sin resultado -> se le reconstruye ANTES;
 *   4. `none`          (la DEGRADACION la evalua despues el dueno del fallback,
 *                      `resolveSilentDegrade` con HABLA y rebuilds).
 *
 * Puro y determinista: sin refs, sin timers, sin audio. El hook solo aporta los
 * datos medidos y ejecuta la accion.
 *
 * @typedef {'recover-back'|'recover'|'rebuild'|'none'} WatchdogAction
 */

export const WATCHDOG_ACTIONS = Object.freeze({
  RECOVER_BACK: 'recover-back',
  RECOVER: 'recover',
  REBUILD: 'rebuild',
  NONE: 'none',
})

/**
 * Decide el paso del watchdog para un tick de conversacion.
 *
 * @param {object} m Medidas del tick y configuracion.
 * @param {number} [m.sinceMeaningful] ms desde el ultimo texto/ingress significativo.
 * @param {number} [m.sinceEnd] ms desde el ultimo onend.
 * @param {number} [m.sinceRebuild] ms desde el ultimo rebuild.
 * @param {boolean} [m.localActive] el motor local (Whisper) es el activo.
 * @param {boolean} [m.recognitionActive] Chrome se declaro activo (onstart).
 * @param {boolean} [m.restartPending] hay un reinicio de Chrome en vuelo.
 * @param {boolean} [m.probePending] hay una ventana de prueba de Chrome abierta.
 * @param {boolean} [m.probeExpired] la ventana de prueba vencio.
 * @param {boolean} [m.recoveryDue] toca reintentar Chrome (inactividad de FINALES
 *   aceptados o numero de segmentos; lo mide el dueno del fallback).
 * @param {object} [m.restartCfg] `getConversationRestartConfig(true)`.
 * @returns {{ action: WatchdogAction, kind?: 'stall'|'dead' }}
 */
export function resolveWatchdogStep({
  sinceMeaningful = 0,
  sinceEnd = 0,
  sinceRebuild = 0,
  localActive = false,
  recognitionActive = false,
  restartPending = false,
  probePending = false,
  probeExpired = false,
  recoveryDue = false,
  restartCfg = {},
} = {}) {
  if (probeExpired && !localActive) return { action: WATCHDOG_ACTIONS.RECOVER_BACK }

  if (localActive) {
    if (!probePending && recoveryDue) return { action: WATCHDOG_ACTIONS.RECOVER }
    return { action: WATCHDOG_ACTIONS.NONE }
  }

  const cooldown = Number(restartCfg.stallRebuildMinMs) || 0
  if (
    recognitionActive &&
    Number(sinceMeaningful) >= Number(restartCfg.silentMicStallMs) &&
    Number(sinceRebuild) >= cooldown
  ) {
    return { action: WATCHDOG_ACTIONS.REBUILD, kind: 'stall' }
  }

  if (!recognitionActive && !restartPending && Number(sinceEnd) >= Number(restartCfg.deadRecognitionMs)) {
    return { action: WATCHDOG_ACTIONS.REBUILD, kind: 'dead' }
  }

  if (Number(sinceMeaningful) >= Number(restartCfg.stallMs) && Number(sinceRebuild) >= cooldown) {
    return { action: WATCHDOG_ACTIONS.REBUILD, kind: 'stall' }
  }

  return { action: WATCHDOG_ACTIONS.NONE }
}
