/**
 * FACHADA DE SERVER del modulo de voz (R7). Superficie PUBLICA.
 * Ningun consumidor de fuera de `src/voice` importa `src/voice/lib/**`: el guard
 * `tests/voiceFacadeGuard.test.ts` lo prohibe.
 */

export { DEFAULT_SAMPLE_RATE } from '../lib/audioConstants.js'
// Módulo CONVERSACIÓN nuevo: se expone por la fachada para que un entrypoint lo
// alcance (orphanModulesGuard). El arranque de producto queda tras `conversation.engine`.
export { motorConversacionActivo } from '../conversation/index.ts'
export { analyzeImage, generateConversationSummary, generateFluContract, generateOpenRouterImage, generateParticipantEvaluation, generateVideoViaFal, generateWorkspaceImage } from '../lib/gemini.js'
