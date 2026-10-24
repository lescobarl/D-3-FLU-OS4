/**
 * FACHADA DE CONFIG del modulo de voz (R7). Superficie PUBLICA.
 * Ningun consumidor de fuera de `src/voice` importa `src/voice/lib/**`: el guard
 * `tests/voiceFacadeGuard.test.ts` lo prohibe.
 */

export { FLU_CONFIG, getCanonicalWakeWord, isSessionResetCommand } from '../lib/fluConfig.js'
