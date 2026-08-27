/**
 * API pública de embeddings: navegador → Web Worker; Node → speakerEmbeddingCore.
 */
export {
  preloadSpeakerEmbeddingModel,
  getSpeakerEmbeddingModelStatus,
  computeSpeakerEmbedding,
} from './speakerEmbeddingCore.js'

export {
  embedAudioForDiarization,
  preloadVoiceIdWorker,
  resolveSpeakerFromAudio,
} from './voiceIdWorkerClient.js'
