/**
 * Reloj de segmentos de audio (performance.now) para diarización cronológica.
 */
import { FLU_CONFIG } from './fluConfig.js'

let lastCommitPerfAt = 0

export function getSegmentSilenceGapMs(config = FLU_CONFIG) {
  const ms = Number(config.voiceIdentity?.capture?.identityPipeline?.segmentSilenceGapMs)
  if (Number.isFinite(ms) && ms > 0) return ms
  const hold = Number(config.voiceIdentity?.capture?.conversationAudio?.voiceHoldMs)
  return Number.isFinite(hold) && hold > 0 ? hold : 1200
}

export function nowPerf() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

export function markCommitPerfNow(at = nowPerf()) {
  lastCommitPerfAt = Number.isFinite(at) ? at : nowPerf()
  return lastCommitPerfAt
}

export function getLastCommitPerfAt() {
  return lastCommitPerfAt
}

export function resetCommitPerfClock() {
  lastCommitPerfAt = 0
}

export function isNewAudioSegment(segmentStartedAtMs, sinceCommitAt = lastCommitPerfAt, config = FLU_CONFIG) {
  const start = Number(segmentStartedAtMs)
  const commit = Number(sinceCommitAt)
  if (!Number.isFinite(start) || start <= 0) return false
  if (!Number.isFinite(commit) || commit <= 0) return false
  return start - commit >= getSegmentSilenceGapMs(config)
}
