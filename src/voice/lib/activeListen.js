/**
 * Escucha activa: estado, hablantes, finales. Motor de texto en conversationStream.js.
 */
import { cleanForSpeech, detectWakeIntroducedName, stripDiacritics } from './audioMath.js'
import { FLU_CONFIG, getActiveListenConfig } from './fluConfig.js'
import { nextAvailableSpeakerLabel } from './voiceIdentity.js'
import { integrateMicPacket, mergeSpeechText, mergeMicChunks, readStreamDisplay, resolveCommitCapture, utterancesRelate, utterancesSameRevision } from './conversationStream.js'

export {
  advancePublishedDisplay,
  advancePublishedDisplay as applyDisplayTranscript,
  assessStreamParity,
  checkStreamParity,
  integrateMicPacket,
  mergeSpeechText,
  processListenPacket,
  readStreamDisplay,
  readStreamDisplay as readLastPhrasePreview,
  readSession,
  readPublishedText,
  resolveLogParagraphBreak,
  resolveLogRowAction,
  resolveCommitCapture,
  stripPriorTurnsFromInterim,
  archiveCommittedTurn,
  buildPriorRowsForStrip,
  trimCommittedRowsRef,
  validateLogRowsNoPrefixDup,
  validateLogRowsNoAsrRevisionDup,
  utterancesSameRevision,
  utterancesAsrProgress,
  countSharedSpeechWords,
  rowDuplicatesPrior,
  collapseRepeatedSpeech,
  collapseEchoPhrase,
  mergeMicChunks,
  pickBestMicInterim,
  collapseMisorderedMicMerge,
  micPublishedParityOk,
  collapseAsrStutter,
  normalizeMicText,
  hasSpeechAnchor,
  shouldRefreshStream,
  shouldRefreshStream as shouldEmitConversationLog,
  utterancesRelate,
} from './conversationStream.js'

import { shouldRelaxIngressTextGuards } from './ingressGuards.js'

export { isSpeakerVoiceAbruptChange, shouldRelaxIngressTextGuards } from './ingressGuards.js'

export function createActiveListenState() {
  return {
    transcript: '',
    openLine: '',
    pendingInterim: '',
    lastFinalAtMs: 0,
    speakerIndex: 1,
  }
}

export function resetActiveListenState(state) {
  state.transcript = ''
  state.openLine = ''
  state.pendingInterim = ''
  state.lastFinalAtMs = 0
  state.speakerIndex = 1
}

/** @deprecated Usar mergeSpeechText */
export const appendNewHeard = (base, incoming) => mergeSpeechText(base, incoming)

export function readSessionTranscript(state) {
  return cleanForSpeech(state?.transcript || '')
}

export function readDisplayText(state) {
  return cleanForSpeech(state?.openLine || '')
}

export function resolveActiveSpeaker(state, utterance = '') {
  const wakeWords = FLU_CONFIG.voiceCommands?.wakeWords || []
  const introduced = detectWakeIntroducedName(utterance, wakeWords)
  if (introduced) return introduced
  return getSpeakerLabel(state)
}

export function readCommandText(state) {
  return readStreamDisplay(state)
}

export function storePendingInterim(state, text = '') {
  integrateMicPacket(state, { interim: text })
}

/** Un final por onresult: fusiona varios fragmentos acumulativos o secuenciales. */
export function pickLongestFinal(chunks = []) {
  return mergeMicChunks(chunks)
}

/** Final ya cubierto por lo commitado; preview abierto siempre se sella en commit. */
export function isRedundantFinal(finalText = '', context = {}) {
  const fin = cleanForSpeech(finalText)
  if (!fin) return true

  const preview = cleanForSpeech(context.preview || context.displayLine || '')
  if (context.openPreview && preview) {
    if (fin === preview) return false
    if (utterancesSameRevision(preview, fin)) return false
    if (preview.length <= fin.length && fin.startsWith(preview)) return false
    if (shouldRelaxIngressTextGuards(context) && fin.length > preview.length) return false
  }

  const candidates = [
    cleanForSpeech(context.lastEmitted || ''),
    cleanForSpeech(context.lastCommitted || ''),
  ].filter(Boolean)

  // Repetición exacta tras una pausa real (>= ventana de eco ASR) = el usuario re-dice
  // la frase: NO es redundante, es un turno nuevo. Solo colapsa el eco rápido (loop).
  const msSinceLastCommit = Number(context.msSinceLastCommit) || 0
  const echoStreakWindowMs =
    Number(FLU_CONFIG?.voiceIdentity?.capture?.committedEchoStreakWindowMs) || 1200
  const isFreshRepeat = msSinceLastCommit > 0 && msSinceLastCommit >= echoStreakWindowMs

  for (const last of candidates) {
    if (fin === last) {
      if (isFreshRepeat) continue
      return true
    }
    if (last.length >= fin.length) {
      if (last.startsWith(fin) || last.endsWith(fin)) {
        return true
      }
      const finWordCount = fin.split(/\s+/).filter(Boolean).length
      if (finWordCount > 1 && last.includes(` ${fin}`)) {
        return true
      }
      if (utterancesRelate(last, fin)) {
        if (
          finWordCount <= 2 &&
          last.length > fin.length + 6 &&
          !last.startsWith(fin) &&
          !last.endsWith(fin)
        ) {
          continue
        }
        return true
      }
    }
    if (utterancesSameRevision(last, fin)) {
      if (fin === last) return true
      if (fin.length <= last.length && last.startsWith(fin)) return true
      continue
    }
  }
  return false
}

/** No acortar por ruido ASR; no bloquear sufijos sueltos («estas» tras frase larga). */
export function wouldShrinkLog(capture = '', lastEmitted = '') {
  const next = cleanForSpeech(capture)
  const prev = cleanForSpeech(lastEmitted)
  if (!next || !prev || next.length >= prev.length) return false
  if (!utterancesRelate(prev, next)) return false
  if (prev.startsWith(next)) return true
  if (prev.endsWith(` ${next}`)) return true
  return false
}

export function formatSpeakerLabel(index, speakersCfg) {
  const template = speakersCfg.labelTemplate || 'Hablante {n}'
  return template.replace('{n}', String(index))
}

export function getSpeakerLabel(state) {
  const { speakers } = getActiveListenConfig()
  const index = Number(state?.speakerIndex)
  return formatSpeakerLabel(Number.isFinite(index) && index >= 1 ? index : 1, speakers)
}

export function shouldOpenNewParagraph(state, nowMs = Date.now()) {
  const { speakers } = getActiveListenConfig()
  const breakOnPause = speakers.paragraphBreakOnPause !== false
  if (!breakOnPause) return false
  if (!state.lastFinalAtMs || !cleanForSpeech(state.openLine)) return false
  return nowMs - state.lastFinalAtMs >= speakers.paragraphBreakMs
}

export function confirmFinal(state, finalText = '', nowMs = Date.now()) {
  const utterance = resolveCommitCapture({
    final: finalText,
    interim: state.pendingInterim,
    state,
    published: readStreamDisplay(state),
  })
  state.pendingInterim = ''

  const newParagraph = shouldOpenNewParagraph(state, nowMs)
  if (newParagraph) {
    const { speakers } = getActiveListenConfig()
    if (speakers.autoAdvanceOnPause) {
      advanceSpeaker(state)
    }
  }

  if (utterance) {
    integrateMicPacket(state, { final: utterance })
  }

  if (newParagraph) {
    state.openLine = ''
    state.pendingInterim = ''
  }

  if (utterance && detectNextSpeakerPhrase(utterance)) {
    advanceSpeaker(state)
  }

  state.lastFinalAtMs = nowMs

  const speaker = resolveActiveSpeaker(state, utterance)

  return {
    transcript: state.transcript,
    openLine: state.openLine,
    newParagraph,
    speaker,
  }
}

export function sealPendingInterim(state, nowMs = Date.now()) {
  const pending = cleanForSpeech(state?.pendingInterim || '')
  if (!pending) return confirmFinal(state, '', nowMs)
  return confirmFinal(state, pending, nowMs)
}

export function foldSpeechKey(text = '') {
  return cleanForSpeech(text).toLowerCase()
}

export function phrasesEquivalent(a = '', b = '') {
  const left = foldSpeechKey(a)
  const right = foldSpeechKey(b)
  return Boolean(left) && left === right
}

export function phrasesRelate(lastLine = '', nextPhrase = '') {
  const last = foldSpeechKey(lastLine)
  const next = foldSpeechKey(nextPhrase)
  if (!last || !next) return false
  return next.startsWith(last) || last.startsWith(next)
}

/** @deprecated Usar shouldRefreshStream */
export function shouldEmitLog(previousEmitted = '', nextText = '') {
  const prev = foldSpeechKey(previousEmitted)
  const next = foldSpeechKey(nextText)
  if (!next) return false
  if (!prev) return true
  if (prev === next) return false
  return next.startsWith(prev) && next.length > prev.length
}

export function getRecognitionLanguage(language = 'es', activeLocale = '') {
  const { languages, bilingual } = getActiveListenConfig()
  if (activeLocale) return activeLocale
  if (language === 'both') {
    return bilingual?.defaultLocale || languages.es
  }
  return language === 'en' ? languages.en : languages.es
}

/** Modo escucha: es | en | both (bilingüe). */
export function isBilingualListenMode(language = '') {
  return String(language || '').trim() === 'both'
}

/** Locale BCP-47 del motor SR según modo UI y texto detectado. */
export function resolveRecognitionLocale(language = 'es', detected = '') {
  const { languages } = getActiveListenConfig()
  if (!isBilingualListenMode(language)) {
    return getRecognitionLanguage(language)
  }
  if (detected === 'en') return languages.en
  if (detected === 'es') return languages.es
  return getRecognitionLanguage('both')
}

export function listBilingualLocales() {
  const { languages, bilingual } = getActiveListenConfig()
  const list = bilingual?.locales
  if (Array.isArray(list) && list.length) return list
  return [languages.es, languages.en].filter(Boolean)
}

function normalizePhrase(text = '') {
  return stripDiacritics(cleanForSpeech(text)).toLowerCase()
}

export function matchesListeningAck(phrase = '') {
  const norm = normalizePhrase(phrase)
  if (!norm) return false
  const { listeningAck } = getActiveListenConfig()
  return listeningAck.phrases.some((sample) => {
    const key = normalizePhrase(sample)
    return key && (norm === key || norm.includes(key) || key.includes(norm))
  })
}

export function detectNextSpeakerPhrase(text = '') {
  const norm = normalizePhrase(text)
  if (!norm) return false
  const phrases = FLU_CONFIG.voiceCommands.nextSpeaker || []
  return phrases.some((sample) => {
    const key = normalizePhrase(sample)
    return key && norm.includes(key)
  })
}

export function nextSpeakerLabel(knownLabels = []) {
  const speakersCfg = getActiveListenConfig().speakers
  const cap = Number(speakersCfg.maxSpeakers)
  return nextAvailableSpeakerLabel([], knownLabels, { maxSpeakers: cap > 0 ? cap : 0 })
}

export function resolveConversationSpeaker(transcript = '', lastSpeaker = '') {
  const { speakers } = getActiveListenConfig()
  const wakeWords = FLU_CONFIG.voiceCommands?.wakeWords || []
  const introduced = detectWakeIntroducedName(transcript, wakeWords)
  if (introduced) return introduced
  return cleanForSpeech(lastSpeaker) || speakers.defaultLabel
}

export function advanceSpeaker(state) {
  state.speakerIndex += 1
  state.openLine = ''
  state.lastFinalAtMs = 0
  return getSpeakerLabel(state)
}

export function syncSpeakerIndexFromLabel(state, label = '') {
  const match = String(label || '').match(/^Hablante\s+(\d+)$/i)
  if (!match) return
  const index = Number(match[1])
  if (!Number.isFinite(index) || index < 1) return
  state.speakerIndex = index
}
