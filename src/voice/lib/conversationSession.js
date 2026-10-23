/**
 * Sesión de conversación — tres reglas:
 * 1. Frontera = turnCapture acumulativo del ASR (qué ya se registró).
 * 2. Log = delta respecto a la frontera, sin duplicar la línea anterior.
 * 3. Hablante = continuidad (config-driven) salvo "me llamo…".
 */
import { logFluAsyncError } from './fluAsyncError.js'
import { resolveRowSpeakerLabel } from './conversationRow'
import { cleanForSpeech } from './audioMath.js'
import { isCalculatingSpeakerId } from './conversationRow.js'
import { FLU_CONFIG } from './fluConfig.js'
import { resolveSpeakerNameFromUtterance } from './speakerPolicy.js'
import { sortSessionSpeakers, normalizeSpeakerLabel, expandSessionSpeakerNames } from './voiceIdentity.js'
import { committedEchoStreakWindowMs } from './activeListen.js'
import {
  getTranscriptDelta,
  getTurnCommitText,
  getTurnDisplay,
  readTurnCaptureForCommit,
} from './turnTranscript.js'

/**
 * Texto visible del turno: el display del turno y, si hay `pendingSpill`, la fusion de
 * ambos (gana el mas largo cuando uno es prefijo del otro). DUENO de esa fusion; la
 * consume `readCommandSnapshot`, la API viva del turno. No se exporta: dos nombres para
 * la misma regla invitaban a elegir uno distinto en cada sitio.
 * @param {object} turnState
 * @param {string} [pendingSpill]
 * @returns {string}
 */
function readTurnDisplayCapture(turnState, pendingSpill = '') {
  const display = getTurnDisplay(turnState)
  if (!pendingSpill) return display
  if (!display) return cleanForSpeech(pendingSpill)
  if (display.startsWith(pendingSpill) || pendingSpill.startsWith(display)) {
    return display.length >= pendingSpill.length ? display : pendingSpill
  }
  return cleanForSpeech(`${pendingSpill} ${display}`)
}

/** Cola de 1 letra suelta ("… se l") — no bloquear "me escuchas", "estás", etc. */
export function endsWithPartialWord(text = '') {
  const value = cleanForSpeech(text)
  if (!value) return false
  const match = value.match(/\s([a-záéíóúüñ])$/i)
  if (!match) return false
  const tail = match[1].toLowerCase()
  const completeShort = new Set(['a', 'y', 'o', 'u'])
  return !completeShort.has(tail)
}

/**
 * Misma linea VISIBLE ya registrada. Es la regla del LOG (no la de la captura ni la del
 * commit), y comparte con ellas UN solo criterio de tiempo: la ventana de eco del ASR
 * (`committedEchoStreakWindowMs`, dueno en activeListen).
 *
 * Dentro de la ventana, la reemision identica/prefijo/sufijo es el MISMO evento (doble final
 * / loop de Chrome: una sola fila). PASADA la ventana la repeticion es habla NUEVA: una
 * pregunta mas corta segundos despues de otra larga se colapsaba como duplicada y la
 * locucion se quedaba SIN fila (clase de defecto medida 2026-10-18 en el ingreso: el mismo
 * criterio estaba duplicado aqui, sin el escape de la pausa).
 *
 * @param {string} phrase frase candidata
 * @param {string} lastLogged ultima frase registrada
 * @param {{ msSinceLastEmit?: number }} [options] ms desde el ultimo registro; 0 = sin dato
 * @returns {boolean} `true` si NO hay que registrar una fila nueva
 */
export function isDuplicateLogPhrase(phrase = '', lastLogged = '', { msSinceLastEmit = 0 } = {}) {
  const current = cleanForSpeech(phrase)
  const previous = cleanForSpeech(lastLogged)
  if (!current) return true
  if (!previous) return false
  // Habla nueva: una pausa real (>= ventana de eco) separa DOS locuciones distintas.
  if (Number(msSinceLastEmit) > 0 && Number(msSinceLastEmit) >= committedEchoStreakWindowMs()) return false
  if (current === previous) return true
  if (previous.length > current.length) {
    if (previous.startsWith(current) || previous.endsWith(` ${current}`)) return true
  }
  return false
}

export function readTurnCapture(turnState, pendingSpill = '') {
  return getTurnCommitText(turnState, pendingSpill)
}

export function readCommandSnapshot(turnState, pendingSpill = '') {
  return readTurnDisplayCapture(turnState, pendingSpill)
}

export function computeSpillAfterLog(turnState, pendingSpill = '', loggedCapture = '') {
  const logged = cleanForSpeech(loggedCapture)
  const remainder = readTurnCapture(turnState, pendingSpill)
  if (!logged) return remainder
  return getTranscriptDelta(logged, remainder)
}

export function createCommitQueue() {
  let chain = Promise.resolve()
  return {
    enqueue(task) {
      const run = chain.then(() => task())
      chain = run.catch((error) => {
        logFluAsyncError('commit-queue', error)
      })
      return run
    },
  }
}

export function listSessionSpeakers(history = []) {
  const seen = new Set()
  const speakers = []

  for (const entry of history) {
    if (isCalculatingSpeakerId(entry?.speakerId)) continue
    // Por VOZ: el nombre RESUELTO de esa voz (no la etiqueta cruda).
    const raw = cleanForSpeech(resolveRowSpeakerLabel(entry))
    if (!raw || raw.toLowerCase() === 'flu') continue
    for (const part of expandSessionSpeakerNames(raw)) {
      const name = normalizeSpeakerLabel(part) || part
      if (!name || name.toLowerCase() === 'flu' || isCalculatingSpeakerId(entry?.speakerId)) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      speakers.push(name)
    }
  }

  return sortSessionSpeakers(speakers)
}

export function filterSessionHistoryByStart(history = [], startedAt = 0) {
  const sessionStart = Number(startedAt) || 0
  const rows = Array.isArray(history) ? history : []
  if (!sessionStart) return rows.filter((entry) => Boolean(cleanForSpeech(entry?.text ?? entry?.transcript ?? '')))

  return rows.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false
    const text = cleanForSpeech(entry?.text ?? entry?.transcript ?? '')
    if (!text) return false
    const timestamp = Number(entry?.timestamp)
    return Number.isFinite(timestamp) && timestamp >= sessionStart
  })
}

export function resolvePassiveSpeaker(transcript = '', lastSpeaker = '', fallback = FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker) {
  const wakeWords = FLU_CONFIG.voiceCommands?.wakeWords || []
  const introduced = resolveSpeakerNameFromUtterance(transcript, { wakeWords })
  if (introduced) return introduced
  return cleanForSpeech(lastSpeaker) || fallback
}

export function trimRecognitionBoundary(boundary = '', maxChars = 4000) {
  const text = cleanForSpeech(boundary)
  if (!text || text.length <= maxChars) return text
  return text.slice(-maxChars)
}

export { readTurnCaptureForCommit }
