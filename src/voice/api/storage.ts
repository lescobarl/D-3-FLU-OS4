/**
 * FACHADA DE STORAGE del modulo de voz (R7). Superficie PUBLICA.
 * Ningun consumidor de fuera de `src/voice` importa `src/voice/lib/**`: el guard
 * `tests/voiceFacadeGuard.test.ts` lo prohibe.
 */

export { clearUiSessionState, deleteVoiceProfile, findVoiceProfileByLabel, loadUiSessionState, saveUiSessionState } from '../lib/fluStorage.js'
