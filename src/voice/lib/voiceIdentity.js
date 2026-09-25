/**
 * Barrel de compatibilidad de identidad de voz (diarización por embedding).
 *
 * La implementación vive en módulos SRP:
 *   - speakerCore.js       — normalización L2, coseno, id y asignación estricta.
 *   - speakerLabels.js     — etiquetas y nombres de hablante (config-driven).
 *   - speakerClusters.js   — clusters + ventana de audio + match de frase corta.
 *   - speakerDiarization.js— el resolver único `resolveConversationSpeaker`.
 *
 * Este archivo solo re-exporta (una fuente por función); no define lógica.
 */
export {
  normalizeEmbeddingVector,
  compareCosineSignatures,
  labelToSpeakerIdSimple,
  autoSpeakerLabel,
  nextAutoSpeakerLabel,
  getFallbackSpeaker,
  assignSpeaker,
} from './speakerCore.js'
export {
  getVoiceIdentityConfig,
  foldSpeakerKey,
  parseSpeakerIndex,
  isAutoSpeakerLabel,
  isRegisteredSpeakerLabel,
  normalizeSpeakerLabel,
  expandSessionSpeakerNames,
  nextAvailableSpeakerLabel,
  pruneGhostSpeakerClusters,
  sortSessionSpeakers,
  formatSpeakerLabel,
} from './speakerLabels.js'
export {
  ROOM_REMATCH_STRICT,
  SHORT_UTTERANCE_HISTORICAL_MATCH,
  SHORT_UTTERANCE_IMMEDIATE_CONTINUITY,
  cosineThreshold,
  flattenChunksTail,
  flattenChunksWindow,
  trimAudioChunkBuffer,
  isShortUtteranceContext,
  resolveRoomRematchThreshold,
  passesRoomRematchStrict,
  updateClusterSignature,
  findClusterByLabel,
  ensureClusterForLabel,
  findNearestCluster,
  findShortUtteranceHistoricalMatch,
  resolveImmediateShortSpeakerContinuity,
  findLabelsWithSharedVoice,
  findSpeakerLabelsMatchingSignature,
  mergeSpeakerClustersOnRename,
  isVoiceDistinctFromSticky,
} from './speakerClusters.js'
export { resolveConversationSpeaker } from './speakerDiarization.js'
