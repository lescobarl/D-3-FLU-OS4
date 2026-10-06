/**
 * Resolución de hablante desde audio: vectores 512-D en clusters y filas (campo signature).
 */
import {
  getConversationMinVoicedForNewSamples,
  getConversationMinVoicedSamples,
  getVoiceIdentityCaptureConfig,
} from './micCapture.js'
import {
  ensureClusterSpeakerId,
  labelToSpeakerId,
  resolveSpeakerNameFromId,
} from './conversationRow.js'
import { resolveConversationSpeaker as matchSpeakerByVoice, getFallbackSpeaker } from './voiceIdentity.js'
import { relayLog } from '../../lib/clientLogRelay'
import { DEFAULT_SAMPLE_RATE } from './audioConstants.js'

/**
 * @param {number[]} vector — embedding 512-D (solo capa diarización)
 * @returns {{ speakerId: string, speakerName: string }}
 */
export function resolveSpeakerIdentityFromVector(
  vector = [],
  {
    speakerClusters = [],
    lastSpeaker = '',
    lastSignature = null,
    fallbackSpeaker = getFallbackSpeaker(),
    utteranceText = '',
    sampleRate = DEFAULT_SAMPLE_RATE,
    voicedSampleCount = 0,
    atTurnBoundary = true,
    allowNewCluster = false,
    preferSpeaker = '',
    reservedLabels = [],
    sessionPrimary = '',
  } = {},
) {
  const captureCfg = getVoiceIdentityCaptureConfig()
  const workingClusters = speakerClusters.map((cluster) => ensureClusterSpeakerId({
    ...cluster,
    signature: Array.isArray(cluster?.signature) ? [...cluster.signature] : cluster?.signature,
    signatureHistory: Array.isArray(cluster?.signatureHistory)
      ? cluster.signatureHistory.map((e) => (Array.isArray(e) ? [...e] : e))
      : cluster?.signatureHistory,
  }))

  let label = fallbackSpeaker
  const diagnosis = {}
  if (Array.isArray(vector) && vector.length) {
    label =
      matchSpeakerByVoice({
        signatureVector: vector,
        speakerClusters: workingClusters,
        lastSpeaker,
        lastSignature,
        voicedSampleCount,
        utteranceText,
        sampleRate,
        preferSpeaker,
        thresholds: captureCfg.conversationSpeakerThresholds,
        maxAutoSpeakers: captureCfg.conversationMaxAutoSpeakers ?? 0,
        atTurnBoundary,
        allowNewCluster,
        reservedLabels,
        sessionPrimary,
        minVoicedSamples: getConversationMinVoicedSamples(sampleRate),
        minVoicedSamplesForNew: getConversationMinVoicedForNewSamples(sampleRate),
        diagnosis,
      }) || fallbackSpeaker
  }
  if (typeof window !== 'undefined') {
    relayLog(
      'LOG',
      'Identity',
      `label="${label}" reason=${diagnosis.reason || ''} lastSim=${Number(diagnosis.lastTurnSimilarity ?? 0).toFixed(3)} auto=${diagnosis.autoClusterCount ?? workingClusters.length} last="${lastSpeaker || ''}" prefer="${preferSpeaker || ''}" boundary=${Boolean(atTurnBoundary)}`,
    )
  }

  const matched = workingClusters.find(
    (c) => String(c?.label || '').trim() === String(label || '').trim(),
  )
  const speakerId = matched?.speakerId || labelToSpeakerId(label)
  const speakerName = resolveSpeakerNameFromId(speakerId, workingClusters)
  return { speakerId, speakerName, workingClusters, label, signatureVector: vector }
}
