/**
 * FACHADA DE IDENTITY del modulo de voz (R7). Superficie PUBLICA.
 * Ningun consumidor de fuera de `src/voice` importa `src/voice/lib/**`: el guard
 * `tests/voiceFacadeGuard.test.ts` lo prohibe.
 */

export { participantVoiceAnchorsForDiarization, setParticipantAnchorsProvider } from '../lib/participantVoiceAnchors.ts'
export { sameVoiceFloor } from '../lib/speakerClusters.js'
export { compareCosineSignatures, normalizeEmbeddingVector, sessionSpeakerHighWater } from '../lib/speakerCore.js'
export { forgetVoiceName, resolveVoiceIdentity, voiceVectorModel } from '../lib/speakerDirectory.js'
export { applyKnownVoiceName, registerSpeakerIdentityFromCommand } from '../lib/speakerIdentityRegister.js'
export { isAutoSpeakerLabel } from '../lib/voiceIdentity.js'
export { resolveVoiceParticipants } from '../lib/voiceParticipantsSource.ts'
