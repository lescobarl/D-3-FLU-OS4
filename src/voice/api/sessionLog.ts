/**
 * FACHADA DE SESSIONLOG del modulo de voz (R7). Superficie PUBLICA.
 * Ningun consumidor de fuera de `src/voice` importa `src/voice/lib/**`: el guard
 * `tests/voiceFacadeGuard.test.ts` lo prohibe.
 */

export { configureSessionSink, createHttpSessionSink, disableSessionRecorder, enableSessionRecorder, getSessionRecordingStatus, recordSessionEvent } from '../lib/sessionRecorder.js'
