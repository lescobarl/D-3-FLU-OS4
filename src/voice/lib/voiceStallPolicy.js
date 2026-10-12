/**
 * DUENO UNICO de las DOS politicas de parada de la escucha (extraidas del hook por el
 * trinquete de tamano de god-file):
 *
 * (a) REANUDAR TRAS EL SUSPEND POR HABLA. Medido por el dueno (2026-10-11 00:32:50 /
 *     00:32:59 / 00:33:20): "[REC] suspend: sin reanudar en suspend (wasListeningBefore:true,
 *     conversationActive:true)" x3 con MicPcm total CLAVADO -> la escucha quedo suspendida
 *     para siempre y dejo de transcribir. Estaba delegada en App (onContractResolved), y un
 *     turno que no cierra o un comando NO lo disparan: la reanudacion la programa EL MISMO que
 *     suspende. El dueno del habla (waitForSpeechIdle) evita abrir en el mismo ms del SPEAKING.
 *
 * (b) SOLTAR EL TURNO QUE NO CERRO. El id del turno se acuna UNA vez (openPreviewTurnRef) y
 *     solo se suelta al cerrar: si el cierre no llega, el turno se CLAVA y el preflight se
 *     repite para el MISMO turn (medido: "Preflight turn=24" repetido). Se suelta con la
 *     ventana del watchdog que YA existe (restart.stallMs), sin numero nuevo.
 */
import { waitForSpeechIdle } from './fluSpeech.js'
import { relayLog } from '../../lib/clientLogRelay'

/**
 * (a) Reanuda la escucha tras el suspend, segun el modo. Unico sitio de esta decision.
 * @param {{ wasListeningBefore?: boolean, isConversationActive?: () => boolean, requestRestart?: (ms: number) => void }} params
 * @returns {'no-escuchaba'|'pasivo'|'activo'} rama tomada
 */
export function resumeAfterSpeechSuspend({ wasListeningBefore = false, isConversationActive = () => false, requestRestart = null } = {}) {
  if (!wasListeningBefore) {
    relayLog('LOG', 'useFluVoiceAssistant', '[REC] suspend: sin reanudar en suspend (no escuchaba)')
    return 'no-escuchaba'
  }
  if (!isConversationActive()) {
    relayLog('LOG', 'useFluVoiceAssistant', '[REC] suspend: reanudando tras habla (modo pasivo)', { wasListeningBefore })
    requestRestart?.(0)
    return 'pasivo'
  }
  relayLog('LOG', 'useFluVoiceAssistant', '[REC] suspend: reanudando tras el habla (conversacion activa)', { wasListeningBefore })
  waitForSpeechIdle().then(() => {
    if (isConversationActive()) requestRestart?.(0)
  })
  return 'activo'
}

/**
 * (b) Suelta el flag del turno abierto cuando el ASR lleva la ventana del watchdog sin
 * resultado (el cierre no llego). @returns {boolean} true si lo solto.
 */
export function releaseStalledTurn({ openPreviewTurnRef = null, sinceResult = 0, stallMs = 0 } = {}) {
  if (!openPreviewTurnRef?.current) return false
  if (!(Number(stallMs) > 0) || Number(sinceResult) < Number(stallMs)) return false
  openPreviewTurnRef.current = false
  relayLog('LOG', 'useFluVoiceAssistant', '[TURNO] flag soltado por watchdog (el cierre no llego)', { sinceResult })
  return true
}
