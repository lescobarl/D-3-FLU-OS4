/**
 * FACHADA DE UICONFIG del modulo de voz (R7). Superficie PUBLICA.
 * Ningun consumidor de fuera de `src/voice` importa `src/voice/lib/**`: el guard
 * `tests/voiceFacadeGuard.test.ts` lo prohibe.
 */

export { getFluParticipantConfig, isFluParticipantEnabled, setFluParticipantOverrides } from '../lib/fluParticipantConfig.js'
export { formatStreamSttUiStatus } from '../lib/transcriptConfig.js'
export { VISUAL_CONFIG } from '../lib/visualConfig.js'
