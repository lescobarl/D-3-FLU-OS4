/**
 * Preflight de identidad durante el turno (antes del final).
 * Al commit se consume el resultado; la fila se escribe una sola vez.
 */
import { extractTurnAudioSnapshot } from './continuousAudioBuffer.js'
import { resolveSpeakerFromAudio } from './voiceIdWorkerClient.js'
import { labelToSpeakerId } from './conversationRow.js'
import { enqueueSpeakerIdentityJob } from './voiceIdentityQueue.js'
import { FLU_CONFIG } from './fluConfig.js'
import { DEFAULT_SAMPLE_RATE } from './audioConstants.js'

const preflightByTurn = new Map()

export function scheduleTurnSpeakerPreflight(turnId, run, { onClusters, continuous = false } = {}) {
  const id = Number(turnId)
  if (!Number.isFinite(id) || id <= 0 || typeof run !== 'function') return

  const prior = preflightByTurn.get(id)
  preflightByTurn.set(id, {
    ...(prior?.ready
      ? {
          ready: true,
          speakerId: prior.speakerId,
          speakerName: prior.speakerName,
          signatureVector: prior.signatureVector,
          workingClusters: prior.workingClusters,
          reason: prior.reason,
        }
      : { ready: false }),
    pending: true,
    turnId: id,
    continuous: Boolean(continuous),
    snapshotAt: Date.now(),
    snapshots: Array.isArray(prior?.snapshots) ? [...prior.snapshots] : [],
  })

  enqueueSpeakerIdentityJob({
    rowId: `preflight-${id}-${continuous ? Date.now() : 0}`,
    run,
    onSuccess: (result) => {
      const slot = preflightByTurn.get(id)
      if (!slot) return
      const weakResult =
        result?.reason === 'no-audio' ||
        result?.reason === 'no-vector' ||
        !(Array.isArray(result?.signatureVector) ? result.signatureVector : result?.vector)?.length
      if (weakResult && slot.ready) {
        preflightByTurn.set(id, { ...slot, pending: false })
        return
      }
      const signatureVector = Array.isArray(result?.signatureVector)
        ? result.signatureVector
        : Array.isArray(result?.vector)
          ? result.vector
          : []
      const snapshotEntry = {
        speakerId: result?.speakerId || '',
        speakerName: result?.speakerName || '',
        signatureVector,
        audioStartSample: Number.isFinite(result?.audioStartSample) ? result.audioStartSample : 0,
        audioStartedAtMs: Number.isFinite(result?.audioStartedAtMs) ? result.audioStartedAtMs : 0,
        snapshotAt: Date.now(),
        reason: result?.reason || '',
      }
      const snapshots = [...(slot.snapshots || []), snapshotEntry]
      preflightByTurn.set(id, {
        ready: true,
        pending: false,
        turnId: id,
        speakerId: result?.speakerId || '',
        speakerName: result?.speakerName || '',
        signatureVector,
        audioStartSample: snapshotEntry.audioStartSample,
        audioStartedAtMs: snapshotEntry.audioStartedAtMs,
        workingClusters: result?.workingClusters || null,
        reason: result?.reason || '',
        snapshots,
        continuous: slot.continuous,
      })
      if (typeof onClusters === 'function' && result?.workingClusters?.length) {
        const defer =
          continuous &&
          FLU_CONFIG.voiceIdentity?.capture?.roomCapture?.deferClusterWritesUntilCommit !== false
        if (!defer) onClusters(result.workingClusters)
      }
    },
    onError: () => {
      const slot = preflightByTurn.get(id)
      if (slot) preflightByTurn.set(id, { ...slot, ready: false, pending: false })
    },
  })
}

export function peekTurnSpeakerPreflight(turnId) {
  const id = Number(turnId)
  return preflightByTurn.get(id) || null
}

export function consumeTurnSpeakerPreflight(turnId) {
  const id = Number(turnId)
  const slot = preflightByTurn.get(id)
  if (!slot) return null
  preflightByTurn.delete(id)
  return slot
}

export function clearTurnSpeakerPreflight(turnId) {
  preflightByTurn.delete(Number(turnId))
}

export function resetTurnSpeakerPreflights() {
  preflightByTurn.clear()
}

export function scheduleClusterRefresh(run, onSuccess) {
  enqueueSpeakerIdentityJob({
    rowId: `cluster-${Date.now()}`,
    run,
    onSuccess: (result) => {
      if (typeof onSuccess === 'function') onSuccess(result)
    },
  })
}

/** Job de audio → hablante (preflight o refresh de clusters). */
export function createTurnSpeakerAudioResolver({
  getAudioBuffer,
  getSampleRate,
  getTurnStartSample,
  getSpeakerClusters,
  getLastSpeaker,
  getLastSignature,
  getFallbackSpeaker,
  getUtteranceText,
  atTurnBoundary = false,
  allowNewCluster = false,
  getPreferSpeaker,
  getSessionPrimary,
  getReservedLabels,
  getAudioStartSample,
  getAudioStartedAtMs,
} = {}) {
  return () => {
    const sampleRate = getSampleRate?.() || DEFAULT_SAMPLE_RATE
    const audioStartSample = getAudioStartSample?.() ?? getTurnStartSample?.() ?? 0
    const audioStartedAtMs = getAudioStartedAtMs?.() || 0
    const buffer = getAudioBuffer?.()
    const audio = buffer
      ? extractTurnAudioSnapshot(buffer, sampleRate, {
          turnAudioStartSample: getTurnStartSample?.() || 0,
          atTurnBoundary,
        })
      : new Float32Array(0)
    const fallback = getFallbackSpeaker?.() || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
    if (!audio.length) {
      return Promise.resolve({
        speakerId: labelToSpeakerId(fallback),
        speakerName: fallback,
        workingClusters: getSpeakerClusters?.() || [],
        signatureVector: [],
        audioStartSample,
        audioStartedAtMs,
        reason: 'no-audio',
      })
    }
    return resolveSpeakerFromAudio(audio, sampleRate, {
      speakerClusters: getSpeakerClusters?.() || [],
      lastSpeaker: getLastSpeaker?.() || '',
      lastSignature: getLastSignature?.() || null,
      fallbackSpeaker: fallback,
      utteranceText: getUtteranceText?.() || '',
      atTurnBoundary,
      allowNewCluster,
      preferSpeaker: getPreferSpeaker?.() || '',
      sessionPrimary: getSessionPrimary?.() || '',
      reservedLabels: getReservedLabels?.() || [],
    }).then((result) => ({
      ...result,
      audioStartSample,
      audioStartedAtMs,
    }))
  }
}
