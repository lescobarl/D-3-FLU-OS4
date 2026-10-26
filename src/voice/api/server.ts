/**
 * FACHADA DE SERVER del modulo de voz (R7). Superficie PUBLICA.
 * Ningun consumidor de fuera de `src/voice` importa `src/voice/lib/**`: el guard
 * `tests/voiceFacadeGuard.test.ts` lo prohibe.
 */

export { DEFAULT_SAMPLE_RATE } from '../lib/audioConstants.js'
export { analyzeImage, generateConversationSummary, generateFluContract, generateOpenRouterImage, generateParticipantEvaluation, generateVideoViaFal, generateWorkspaceImage } from '../lib/gemini.js'
