/**
 * FACHADA DE MEDIA del modulo de voz (R7). Superficie PUBLICA.
 * Ningun consumidor de fuera de `src/voice` importa `src/voice/lib/**`: el guard
 * `tests/voiceFacadeGuard.test.ts` lo prohibe.
 */

export { hashPromptSeed } from '../lib/fluVisualPipeline.js'
export { resolveGeminiErrorPresentation } from '../lib/geminiDiagnostics.js'
export { fetchFalVideo, fetchOpenRouterImageFallback } from '../lib/imageGeneration.js'
