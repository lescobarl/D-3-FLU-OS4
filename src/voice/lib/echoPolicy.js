/**
 * Eco de la voz de FLU: DUENO UNICO de QUE texto es fuente de eco y DE CUANDO se puede
 * medir (B2).
 *
 * DEFECTO MEDIDO (2026-10-10): el recorte del eco (`peelWakeQuestionEcho`) se alimentaba
 * con `lastCommitted`, que en el ingress es la ULTIMA FILA DEL LOG DE USUARIO
 * (`logRowsTextRef` -> `userRowsTextView`): el eco se medía contra el texto del propio
 * usuario, no contra el texto REAL de FLU. Y el recorte quitaba cualquier trozo de 1..8
 * palabras igual a la cabeza o la cola de la fuente, sin cobertura ni ventana: una
 * locucion real que repetia palabras de lo ultimo dicho se truncaba
 * (`'el elote y el maiz'` -> `'y el maiz'`).
 *
 * AQUI viven las tres decisiones, una sola vez:
 *   1) FUENTE: la ultima fila de FLU (su texto real) del historial.
 *   2) VENTANA: anclada al FIN de su habla (epoch ms de esa fila) -> `echoWindowMs`.
 *   3) COBERTURA: un eco repite CASI TODO lo anterior -> `echoCoverageFloor`.
 *
 * Sin dependencias de audio (para que `audioMath` pueda consumirlo sin ciclos): el
 * criterio de cobertura se expone como predicado puro sobre palabras.
 */
import { FLU_CONFIG } from './fluConfig.js'
import { useIntegrationStore } from '../../store/integrationStore.ts'

/**
 * Instante REAL en que FLU TERMINO de hablar (lo registra el dueno unico del TTS,
 * `fluSpeech.js`, en el `onend` del utterance). La ventana de eco se ancla aqui, NO al
 * timestamp de la fila: la fila se escribe ANTES de que el TTS empiece y su timestamp
 * envejece mientras FLU aun habla, asi que el eco de su propia voz volvia con la
 * ventana cerrada (medido en vivo 2026-10-20: el "Error HTTP de Gemini (402)." que
 * FLU hablo se capturo como fila del usuario 4-5 s despues de la fila).
 */
let fluSpeechEndedAt = 0

/** El dueno del TTS marca aqui el fin real del habla de FLU (epoch ms). */
export function recordFluSpeechEnd(at = Date.now()) {
  const value = Number(at)
  if (Number.isFinite(value) && value > 0) fluSpeechEndedAt = value
}

/** Fin real del habla de FLU (0 si esta sesion aun no registro ninguno). */
export function lastFluSpeechEndedAt() {
  return fluSpeechEndedAt
}

/** Ventana (ms) tras el fin del habla de FLU en la que su voz puede volver por el micro. */
export function echoWindowMs(config = FLU_CONFIG) {
  const value = Number(config?.transcript?.fluQuery?.echoWindowMs)
  return Number.isFinite(value) && value > 0 ? value : 3000
}

/** Fraccion minima del texto de FLU que debe cubrir la locucion para ser ECO. */
export function echoCoverageFloor(config = FLU_CONFIG) {
  const value = Number(config?.transcript?.fluQuery?.echoCoverageFloor)
  return Number.isFinite(value) && value > 0 && value < 1 ? value : 0.6
}

/** true si una fuente con esa edad (ms desde el FIN de su habla) puede generar eco. */
export function isEchoWindowOpen(ageMs, { windowMs = echoWindowMs() } = {}) {
  const age = Number(ageMs)
  if (!Number.isFinite(age)) return false
  return age >= 0 && age <= windowMs
}

/**
 * `true` si el trozo encaja como eco de la fuente: cubre al menos `floor` de SUS palabras.
 * Un eco de verdad repite casi todo lo anterior; repetir su cola es habla nueva.
 */
export function echoChunkCovers(chunkWords = [], sourceWords = [], floor = echoCoverageFloor()) {
  const chunk = Array.isArray(chunkWords) ? chunkWords.filter(Boolean).length : 0
  const source = Array.isArray(sourceWords) ? sourceWords.filter(Boolean).length : 0
  if (!chunk || !source) return false
  return chunk / source >= floor
}

/**
 * Texto REAL de FLU (ultima fila `flu` del historial) y su edad respecto al fin de su habla.
 *
 * @param {{ now?: () => number, history?: Array<{role?: string, text?: string, timestamp?: number}> }} [options]
 * @returns {{ text: string, ageMs: number }}
 */
export function resolveFluEchoSource({ now = () => Date.now(), history = null } = {}) {
  const rows = Array.isArray(history)
    ? history
    : useIntegrationStore.getState().conversationHistory
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]
    if (row?.role !== 'flu') continue
    const text = String(row.text || '').trim()
    if (!text) continue
    const at = Number(row.timestamp)
    // El ancla del eco es el FIN REAL del habla de FLU (onend del TTS). El timestamp
    // de la fila se escribio ANTES de hablar: usarlo cerraba la ventana mientras el
    // eco aun podia volver por el micro. Si el TTS no registro su fin (habla de otra
    // sesion/tab), se conserva el timestamp de la fila como referencia.
    const speechEnd = lastFluSpeechEndedAt()
    const anchor =
      Number.isFinite(speechEnd) && speechEnd > 0 && speechEnd >= at ? speechEnd : at
    return {
      text,
      ageMs: Number.isFinite(anchor) ? Math.max(0, now() - anchor) : Number.POSITIVE_INFINITY,
    }
  }
  return { text: '', ageMs: Number.POSITIVE_INFINITY }
}

/**
 * Fuentes de eco que APLICAN a esta locucion: el texto pasivo de la MISMA locucion (su
 * propia ventana es inmediata) y, solo si la ventana sigue abierta, el texto real de FLU.
 *
 * @param {{ passiveText?: string, now?: () => number, history?: Array<object> }} [options]
 * @returns {string[]}
 */
export function resolveEchoSources({ passiveText = '', now = () => Date.now(), history = null } = {}) {
  const out = []
  const passive = String(passiveText || '').trim()
  if (passive) out.push(passive)
  const flu = resolveFluEchoSource({ now, history })
  if (flu.text && isEchoWindowOpen(flu.ageMs)) out.push(flu.text)
  return out
}
