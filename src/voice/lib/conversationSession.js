/**
 * Sesión de conversación — tres reglas:
 * 1. Frontera = turnCapture acumulativo del ASR (qué ya se registró).
 * 2. Log = delta respecto a la frontera, sin duplicar la línea anterior.
 * 3. Hablante = continuidad (config-driven) salvo "me llamo…".
 */
import { logFluAsyncError } from './fluAsyncError.js'
import { cleanForSpeech } from './audioMath.js'
import { isCalculatingSpeakerId } from './conversationRow.js'
import { FLU_CONFIG } from './fluConfig.js'
import { resolveSpeakerNameFromUtterance } from './speakerPolicy.js'
import { sortSessionSpeakers, normalizeSpeakerLabel, expandSessionSpeakerNames } from './voiceIdentity.js'
import {
  getTranscriptDelta,
  getTurnCommitText,
  getTurnDisplay,
  normalizeTranscriptText,
  prepareLogCommit,
  readTurnCaptureForCommit,
} from './turnTranscript.js'

export function readTurnDisplayCapture(turnState, pendingSpill = '') {
  const display = getTurnDisplay(turnState)
  if (!pendingSpill) return display
  if (!display) return cleanForSpeech(pendingSpill)
  if (display.startsWith(pendingSpill) || pendingSpill.startsWith(display)) {
    return display.length >= pendingSpill.length ? display : pendingSpill
  }
  return cleanForSpeech(`${pendingSpill} ${display}`)
}

export function getLiveTurnDisplay(turnState, pendingSpill = '') {
  return readTurnDisplayCapture(turnState, pendingSpill)
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

/** Texto nuevo para el log de conversación. */
export function resolveConversationLogText(
  sessionBoundary = '',
  turnCapture = '',
  lastLineLogged = '',
) {
  const capture = cleanForSpeech(turnCapture)
  if (!capture) return ''

  const session = trimRecognitionBoundary(sessionBoundary)
  if (session && capture === session) return ''

  const candidate = getTranscriptDelta(session, capture)
  if (!candidate) return ''

  const normalized = normalizeTranscriptText(candidate)
  if (!normalized) return ''
  if (isDuplicateLogPhrase(normalized, lastLineLogged)) return ''
  return normalized
}

export function isDuplicateLogPhrase(phrase = '', lastLogged = '') {
  const current = cleanForSpeech(phrase)
  const previous = cleanForSpeech(lastLogged)
  if (!current) return true
  if (!previous) return false
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

export function shouldSkipTurnLog(lastLoggedCapture = '', turnCapture = '') {
  return !prepareLogCommit(lastLoggedCapture, turnCapture)
}

export function listSessionSpeakers(history = []) {
  const seen = new Set()
  const speakers = []

  for (const entry of history) {
    if (isCalculatingSpeakerId(entry?.speakerId)) continue
    const raw = cleanForSpeech(entry?.speakerName ?? entry?.speaker)
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
