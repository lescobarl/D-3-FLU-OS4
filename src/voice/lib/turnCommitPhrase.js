// ============================================================
// turnCommitPhrase — punto ÚNICO de cierre de la locución del turno.
// ------------------------------------------------------------
// Defecto que cierra (medido en el log del dueño): si el guard anti-alucinación
// marcaba la captura cruda del ASR como basura, el commit devolvía '' EN
// SILENCIO y el turno moría mudo — con la respuesta de Gemini ya pagada y
// descartada, sin fila y sin habla (log: "latencia IA: 1102ms" seguido de
// LISTENING, sin onContractResolved ni SPEAKING).
//
// Regla única: ante una captura cruda corrupta NO se descarta el turno, se
// commitea el texto VALIDADO del turno; y si tampoco hay texto válido, el
// motivo queda registrado. Descarte silencioso = imposible.
//
// `log` se inyecta para no acoplar este módulo al relé de logs del motor.
// El ECO de la wake ("ok flu ok flu <orden>") se consume ANTES del guard: esa
// repetición es el mismo eco que el mandato ya recorta, no tartamudeo del ASR.
// Sin ese recorte el eco marcaba una locución REAL como basura, la frase del
// turno caía al texto post-wake y la fila quedaba duplicada (con y sin wake).
// ============================================================
import { cleanForSpeech, stripLeadingWakeEcho } from './audioMath.js'
import { getWakeWords } from './wakeTurnCommit.js'
import { resolveCommittablePhrase } from './garbageTranscript.js'

const clip = (value) => cleanForSpeech(String(value || '')).slice(0, 80)

/**
 * Frase canónica a commitear para el turno, o '' si no hay texto válido.
 * Nunca falla en silencio: cada descarte emite su motivo por `log`.
 *
 * @param {{ capture?: string, fallback?: string, log?: (channel: string, scope: string, message: string) => void, wakeWords?: string[] }} [options]
 * @returns {string}
 */
export function resolveTurnCommitPhrase({ capture, fallback = '', log, wakeWords = getWakeWords() } = {}) {
  const emit = typeof log === 'function' ? log : () => {}
  const canonicalCapture = stripLeadingWakeEcho(capture, wakeWords)
  const canonicalFallback = stripLeadingWakeEcho(fallback, wakeWords)
  const { phrase, usedFallback, reason } = resolveCommittablePhrase(canonicalCapture, canonicalFallback)
  const canonical = cleanForSpeech(phrase)

  if (!canonical) {
    if (reason) {
      emit(
        'WARN',
        'turnCommitPhrase',
        `turno SIN texto válido (motivo=${reason}) capture="${clip(capture)}" fallback="${clip(fallback)}" → se cierra sin habla`,
      )
    }
    return ''
  }

  if (usedFallback) {
    emit(
      'WARN',
      'turnCommitPhrase',
      `captura del ASR descartada (motivo=${reason}) "${clip(capture)}" → se usa el texto validado del turno "${canonical.slice(0, 80)}"`,
    )
  }
  return canonical
}
