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
 *                      `kind: 'mudo'` cuando la locucion abierta esta VACIA (no
 *                      hay texto que cortar): a `stallMs` si el microfono MIDE
 *                      su voz (compas del respaldo 2026-11-07) o a
 *                      `muteOpenLocutionMs` si no; y `kind: 'stall'`/`'dead'`
 *                      si no;
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
 * @param {boolean} [m.hasRecentSpeech] hay VOZ medida en la ventana PCM reciente
 *   (`stallVoiceWindowMs`). Un rebuild `stall` con voz presente corta el segmento
 *   que Chrome esta reconociendo; el dueno lo aporta desde `voicedActivity`.
 * @param {boolean} [m.hasOpenLocution] el modulo de conversacion tiene una
 *   locucion ABIERTA (hecho de su dueno: la instantanea de la sesion).
 *   Medido 2026-11-12 18:22: la voz de la mujer no alcanzaba el piso de
 *   identidad y el watchdog reconstruia cada ~8,4 s EN MEDIO de su frase;
 *   Chrome nunca finalizaba y 12 locuciones cerraron «sinTexto». La locucion
 *   abierta es la prueba de habla que el conteo PCM no ve: mientras exista,
 *   el stall no toca el motor.
 * @param {boolean} [m.hasEmptyOpenLocution] la locucion abierta NO tiene texto
 *   todavia. Es la firma del Chrome MUDO: activo, sin resultados y con una
 *   locucion que nunca recibio una palabra. Medido 2026-11-12 19:05 (sesion de
 *   la mujer): 37,2 s asi, cero resultados, y ningun paso del watchdog pudo
 *   tocar el motor (el stall exige sin locucion; el dead exige inactivo). A
 *   partir de `muteOpenLocutionMs` se reconstruye: no hay frase que cortar.
 * @param {boolean} [m.mudoTempranoHecho] a ESTA locucion ya se le dio el rebuild
 *   `mudo` temprano. Lo aporta el unico consumidor, llaveado por `locutionId`:
 *   sin el candado, cada onstart rearma el reloj y el motor se cortaria cada
 *   pocos segundos en medio de la misma frase (defecto medido 2026-11-12 18:22).
 * @param {number} [m.openLocutionMs] ms de AUDIO PROPIO de la locucion abierta
 *   (`fin - inicio` de su tramo). NO es el reloj global: medido 2026-11-13
 *   18:44:08.183, la locucion 4d84debd abrio a las 18:44:07.614 y el mudo
 *   temprano disparo 0,57 s despues porque `sinceMeaningful=4238` venia del
 *   turno ANTERIOR; el audio propio de esa locucion era de 43 ms. El comando
 *   que Chrome estaba oyendo quedo fuera de su ventana y la fila cerro
 *   `Hablante XX` (sin `vozId`: el nombre no alcanzo a las filas de la voz).
 *   Ambas ramas `mudo` exigen que la locucion haya acumulado su propio audio:
 *   sin el piso, un hueco global largo dispara sobre una locucion recien
 *   abierta y corta la frase que Chrome todavia esta procesando.
 * @param {boolean} [m.recoveryDue] toca reintentar Chrome (inactividad de FINALES
 *   aceptados o numero de segmentos; lo mide el dueno del fallback).
 * @param {boolean} [m.fluSpeaking] FLU esta HABLANDO (hecho del dueno
 *   `isFluSpeaking`, `fluSpeech.js`). Mientras habla, el microfono lo gobierna
 *   la pausa de voz (`voiceStallPolicy`): el watchdog NO toca el motor.
 * @param {object} [m.restartCfg] `getConversationRestartConfig(true)`.
 * @returns {{ action: WatchdogAction, kind?: 'stall'|'dead'|'mudo', early?: boolean }}
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
  hasRecentSpeech = false,
  hasOpenLocution = false,
  hasEmptyOpenLocution = false,
  openLocutionMs = 0,
  mudoTempranoHecho = false,
  recoveryDue = false,
  fluSpeaking = false,
  restartCfg = {},
} = {}) {
  // DEFECTO MEDIDO (sesion 753c2361, 2026-11-12 18:59): un TTS de 2,8 s aborto
  // el reconocedor (onend); 1 s despues el tick `dead` lo reconstruyo EN MEDIO
  // del TTS y Chrome transcribio la cola de FLU como «Hablante XX» (row
  // 04954dba). Un solo dueno del microfono durante el habla: mientras FLU
  // habla, ninguna accion del watchdog (ni rebuild, ni recuperacion).
  if (fluSpeaking) return { action: WATCHDOG_ACTIONS.NONE }

  if (probeExpired && !localActive) return { action: WATCHDOG_ACTIONS.RECOVER_BACK }

  if (localActive) {
    if (!probePending && recoveryDue) return { action: WATCHDOG_ACTIONS.RECOVER }
    return { action: WATCHDOG_ACTIONS.NONE }
  }

  const cooldown = Number(restartCfg.stallRebuildMinMs) || 0
  // MUDO TEMPRANO: Chrome lleva el compas medido del respaldo (`stallMs` = 4,2 s
  // en conversacion) sin soltar nada MIENTRAS el microfono MIDE su voz y la
  // locucion abierta sigue vacia. Medido 2026-11-13 14:32: ultimo resultado de
  // Chrome 14:32:39.844; voz medida ok 1.290-1.500 ms entre 14:32:48.501 y
  // 14:32:53.223; primer interim de la mujer 14:32:59.751 (19,9 s): los
  // primeros ~17 s de su frase no los transcribio nadie. El respaldo
  // 2026-11-07 reconstruia cada ~4,2-4,6 s y Chrome escribia ~4 s despues del
  // rebuild (03:07:37.5 -> 03:07:41.9). Aqui se da ESE primer golpe, UNA vez
  // por locucion: los rebuilds repetidos sobre una frase que Chrome esta
  // oyendo son el defecto medido de 18:22 (12 locuciones «sinTexto»), y en ese
  // tick `hasRecentSpeech` era FALSE. Esta rama EXIGE voz medida: no reabre
  // 18:22. Con la locucion sin texto no hay frase que cortar. El `mudo` de
  // `muteOpenLocutionMs` sigue como ultima red para el Chrome trabado sin voz.
  if (
    recognitionActive &&
    hasEmptyOpenLocution &&
    hasRecentSpeech &&
    !mudoTempranoHecho &&
    Number(openLocutionMs) >= Number(restartCfg.stallMs) &&
    Number(sinceMeaningful) >= Number(restartCfg.stallMs) &&
    Number(sinceRebuild) >= cooldown
  ) {
    return { action: WATCHDOG_ACTIONS.REBUILD, kind: 'mudo', early: true }
  }

  // MUDO: Chrome activo, sin resultados y con la locucion abierta VACIA (medido
  // 19:05: 37,2 s). No hay frase que proteger: nada de lo que Chrome ignoro
  // esta escrito, asi que reconstruir no puede cortar texto. El umbral (20 s)
  // queda por ENCIMA del tick de 8,4 s de 18:22 — ahi la locucion abierta si
  // era una frase viva de la mujer y el rebuild la partia — y DENTRO de la
  // ventana medida de 37,2 s.
  if (
    recognitionActive &&
    hasEmptyOpenLocution &&
    Number(openLocutionMs) >= Number(restartCfg.muteOpenLocutionMs) &&
    Number(sinceMeaningful) >= Number(restartCfg.muteOpenLocutionMs) &&
    Number(sinceRebuild) >= cooldown
  ) {
    return { action: WATCHDOG_ACTIONS.REBUILD, kind: 'mudo' }
  }

  // STALL = Chrome activo pero mudo. Con VOZ reciente NO se reconstruye: Chrome
  // puede estar procesando un segmento largo y el reinicio lo tira. Con
  // LOCUCION ABIERTA tampoco: es habla que el piso PCM no alcanza a ver
  // (medido 18:22, mujer con 30-480 ms de voz por ventana). El silencio real
  // (sin voz ni locucion) y el `dead` por onend son las puertas de recuperacion.
  if (
    !hasRecentSpeech &&
    !hasOpenLocution &&
    recognitionActive &&
    Number(sinceMeaningful) >= Number(restartCfg.silentMicStallMs) &&
    Number(sinceRebuild) >= cooldown
  ) {
    return { action: WATCHDOG_ACTIONS.REBUILD, kind: 'stall' }
  }

  if (!recognitionActive && !restartPending && Number(sinceEnd) >= Number(restartCfg.deadRecognitionMs)) {
    return { action: WATCHDOG_ACTIONS.REBUILD, kind: 'dead' }
  }

  if (
    !hasRecentSpeech &&
    !hasOpenLocution &&
    Number(sinceMeaningful) >= Number(restartCfg.stallMs) &&
    Number(sinceRebuild) >= cooldown
  ) {
    return { action: WATCHDOG_ACTIONS.REBUILD, kind: 'stall' }
  }

  return { action: WATCHDOG_ACTIONS.NONE }
}
