/**
 * Guardas de ingress: relajar shrink/redundante y forzar filas nuevas en el log.
 */
import { cleanForSpeech, compareCosineSignatures, speechWords } from './audioMath.js'
import { FLU_CONFIG } from './fluConfig.js'
import { getTranscriptPauseCfg } from './fluTranscriptPause.js'
import { getIngressGuardsCfg, getSpeakerThresholdsCfg } from './fluTranscriptMotor.js'
import { utterancesAsrProgress, utterancesRelate, utterancesSameRevision } from './conversationStream.js'

/** Cambio abrupto de hablante (etiqueta o embedding 512-D L2-normalizado). */
export function isSpeakerVoiceAbruptChange(context = {}) {
  const finalSpeaker = cleanForSpeech(
    context.finalSpeaker || context.speaker || context.commitSpeaker || '',
  )
  const previewSpeaker = cleanForSpeech(
    context.previewSpeaker || context.interimSpeaker || context.lastLoggedSpeaker || '',
  )
  if (
    finalSpeaker &&
    previewSpeaker &&
    finalSpeaker !== previewSpeaker &&
    !finalSpeaker.includes('/') &&
    !previewSpeaker.includes('/')
  ) {
    return true
  }

  const finalSig = context.finalSignature || context.signatureVector
  const previewSig =
    context.previewSignature || context.interimSignature || context.lastSignature
  if (!Array.isArray(finalSig) || !finalSig.length || !Array.isArray(previewSig) || !previewSig.length) {
    return false
  }

  const thresholds = getSpeakerThresholdsCfg()
  const similarity = compareCosineSignatures(finalSig, previewSig)
  const continuity = Number(context.continuityThreshold ?? thresholds.cosineContinuityThreshold)
  const floor = Number(context.abruptSimilarityFloor ?? thresholds.cosineNewVoiceThreshold)
  const drop = Number(context.abruptSimilarityDrop ?? thresholds.abruptSimilarityDrop)

  if (similarity < floor) return true
  if (similarity < continuity - drop) return true
  return false
}

export function msSinceLastCommit(context = {}) {
  const explicit = Number(context.msSinceLastCommit)
  if (Number.isFinite(explicit) && explicit >= 0) return explicit
  const pause = Number(context.pauseBeforeMs ?? context.openLineAgeMs ?? context.userPauseMs ?? 0)
  return Number.isFinite(pause) && pause > 0 ? pause : 0
}

/** >1.5s desde último commit del bloque o cambio de hablante → no shrink / no redundant agresivo. */
export function shouldRelaxIngressTextGuards(context = {}) {
  if (context.forceRelaxGuards === true) return true
  if (isSpeakerVoiceAbruptChange(context)) return true
  const gateMs = Number(
    context.relaxAfterCommitMs ?? FLU_CONFIG.transcript?.relaxGuardsAfterCommitMs,
  )
  return msSinceLastCommit(context) >= gateMs
}

function novelWords(next = '', prior = '') {
  const nw = speechWords(next)
  const priorSet = new Set(speechWords(prior))
  return nw.filter((word) => !priorSet.has(word))
}

/**
 * Texto nuevo o variación semántica limpia → nueva fila (p. ej. «marcada la victoria»).
 */
export function shouldForceNewLogRowOnCommit(next = '', committed = '', prior = '', context = {}) {
  const fin = cleanForSpeech(next)
  const comm = cleanForSpeech(committed)
  const prev = cleanForSpeech(prior)
  if (!fin) return false

  const anchor = comm || prev
  if (!anchor) return true

  if (fin === anchor) return false

  if (utterancesAsrProgress(anchor, fin) && fin.length >= anchor.length) {
    return false
  }

  if (utterancesSameRevision(anchor, fin)) return false

  const ingress = getIngressGuardsCfg()

  if (shouldRelaxIngressTextGuards(context)) {
    if (!utterancesRelate(anchor, fin) && !utterancesSameRevision(anchor, fin)) return true
    const novel = novelWords(fin, anchor)
    if (novel.length >= Number(ingress.novelWordMinCount)) return true
    if (novel.length >= 1 && fin.length >= Number(ingress.novelWordMinTextLength)) return true
    if (
      !anchor.toLowerCase().includes(fin.toLowerCase()) &&
      fin.length >= Number(ingress.alternateNewRowMinLength)
    ) {
      return true
    }
  }

  return preferNewRowHeuristic(fin, anchor, context)
}

function preferNewRowHeuristic(fin, anchor, context) {
  if (shouldPreferShortFinalFromContext(fin, anchor, context)) return true
  return false
}

function shouldPreferShortFinalFromContext(fin, anchor, context) {
  const pauseMs = msSinceLastCommit(context)
  const minPause = Number(getTranscriptPauseCfg().pauseContinuationMinMs)
  if (pauseMs < minPause) return false
  const finWords = fin.split(/\s+/).filter(Boolean)
  if (finWords.length > Number(getIngressGuardsCfg().forceNewRowShortFinalMaxWords)) return true
  const novel = novelWords(fin, anchor)
  return novel.length > 0
}
