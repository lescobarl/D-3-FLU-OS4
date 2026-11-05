/**
 * FACHADA DE AUDIO del modulo de voz (R7). Superficie PUBLICA.
 * Ningun consumidor de fuera de `src/voice` importa `src/voice/lib/**`: el guard
 * `tests/voiceFacadeGuard.test.ts` lo prohibe.
 */

export { downsample } from '../lib/asr/resample.js'
export { deriveSearchQuery, isMinuteGenerationRequest, isRecoverableRecognitionError, normalizeSpokenCommand, splitTranscriptAtWakeWord } from '../lib/audioMath.js'
export { concatFloat32 } from '../lib/pcmChunks.js'

/** Cargador PEREZOSO de Whisper (no entra en el chunk por la fachada). */
export const loadWhisperWasmTranscriber = () => import('../lib/asr/whisperWasmTranscriber.js')

/** Cargador PEREZOSO del motor de reconocimiento Whisper. */
export const loadWhisperRecognitionEngine = () => import('../lib/asr/whisperRecognitionEngine.js')
