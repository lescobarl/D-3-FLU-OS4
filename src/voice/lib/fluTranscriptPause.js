/**
 * Pausa / cola ASR débil — lee SOLO fluConfig.transcript.pauseAndWeakAsr (sin fallbacks numéricos aquí).
 * Inventario: docs/reglas-duras.md · listConfiguredTranscriptHardRules()
 */
import { FLU_CONFIG } from './fluConfig.js'
import { cleanForSpeech } from './audioMath.js'

export const TRANSCRIPT_PAUSE_KEYS = [
  'interimOpenLineFlushMs',
  'srGapCommitMs',
  'srGapCommitMinWords',
  'srGapCommitExtensionMinChars',
  'srGapCommitNoNewContentMinChars',
  'postCommitCooldownMs',
  'staleFlushMinWords',
  'staleFlushMinWordsDuringCooldown',
  'pauseContinuationMs',
  'pauseContinuationMinMs',
  'pauseBridgeMinSharedWords',
  'tailMinLengthRatio',
  'tailLiveLengthMarginChars',
  'weakAsrRepetitionUniqueRatio',
  'tailOnlyMaxWords',
  'tailOnlyMaxChars',
  'weakAsrStaleMaxWords',
  'weakAsrStaleMaxChars',
  'weakAsrFinalMaxWords',
  'weakAsrFinalMaxChars',
  'shortCommitMaxWords',
  'shortCommitMaxChars',
  'skipDiarizeOnStaleFlush',
  'treatEmptyPhraseAsWeak',
]

export function getTranscriptPauseCfg() {
  const cfg = FLU_CONFIG.transcript?.pauseAndWeakAsr
  if (!cfg || typeof cfg !== 'object') {
    throw new Error('fluConfig.transcript.pauseAndWeakAsr es obligatorio')
  }
  return cfg
}

export function listConfiguredTranscriptHardRules() {
  const cfg = getTranscriptPauseCfg()
  return TRANSCRIPT_PAUSE_KEYS.filter((key) => key in cfg).map((key) => ({
    key,
    value: cfg[key],
    source: 'fluConfig.transcript.pauseAndWeakAsr',
  }))
}

export function countSpeechWords(text = '') {
  return cleanForSpeech(text).split(/\s+/).filter(Boolean).length
}

function isTailByRelation(shorter = '', longer = '', ratio) {
  const short = cleanForSpeech(shorter)
  const long = cleanForSpeech(longer)
  if (!short || !long || short.length >= long.length) return false
  if (long.toLowerCase().endsWith(short.toLowerCase())) return true
  const p = long.toLowerCase()
  const n = short.toLowerCase()
  if (p.startsWith(n) || n.startsWith(p) || p.includes(` ${n}`)) {
    return short.length < long.length * ratio
  }
  return false
}

export function isPhraseShortForSpeakerHeuristics(phrase = '', lastCommitted = '') {
  const text = cleanForSpeech(phrase)
  if (!text) return getTranscriptPauseCfg().treatEmptyPhraseAsWeak !== false
  const cfg = getTranscriptPauseCfg()
  const ratio = Number(cfg.tailMinLengthRatio)
  if (lastCommitted && isTailByRelation(text, lastCommitted, ratio)) return true
  const words = countSpeechWords(text)
  const staleMin = Number(cfg.staleFlushMinWords)
  if (staleMin > 0 && words < staleMin) return true
  const maxW = Number(cfg.shortCommitMaxWords)
  const maxC = Number(cfg.shortCommitMaxChars)
  if (maxW > 0 && countSpeechWords(text) <= maxW) {
    return !(maxC > 0) || text.length < maxC
  }
  if (maxC > 0 && text.length < maxC) return true
  return false
}

export function isWeakAsrSpeakerEvidence({
  phrase = '',
  staleInterimFlush = false,
  lastCommitted = '',
} = {}) {
  const cfg = getTranscriptPauseCfg()
  const text = cleanForSpeech(phrase)
  if (!text) return cfg.treatEmptyPhraseAsWeak !== false

  const prior = cleanForSpeech(lastCommitted)
  const ratio = Number(cfg.tailMinLengthRatio)
  if (prior && isTailByRelation(text, prior, ratio)) return true

  const words = text.split(/\s+/).filter(Boolean)
  if (words.length >= 3) {
    const unique = new Set(words.map((w) => w.toLowerCase()))
    const repetitionRatio = Number(cfg.weakAsrRepetitionUniqueRatio)
    if (unique.size <= Math.ceil(words.length * repetitionRatio)) return true
  }

  const wordsCount = countSpeechWords(text)
  const staleMin = Number(cfg.staleFlushMinWords)
  if (staleInterimFlush && staleMin > 0 && wordsCount > 0 && wordsCount < staleMin) return true
  const maxW = Number(staleInterimFlush ? cfg.weakAsrStaleMaxWords : cfg.weakAsrFinalMaxWords)
  const maxC = Number(staleInterimFlush ? cfg.weakAsrStaleMaxChars : cfg.weakAsrFinalMaxChars)
  if (maxW > 0 && wordsCount <= maxW && (!(maxC > 0) || text.length < maxC)) return true
  if (maxC > 0 && maxW <= 0 && text.length < maxC) return true
  return false
}
