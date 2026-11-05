/**
 * FACHADA DE WORKERS del modulo de voz (R7). Superficie PUBLICA.
 * Ningun consumidor de fuera de `src/voice` importa `src/voice/lib/**`: el guard
 * `tests/voiceFacadeGuard.test.ts` lo prohibe.
 */

export { createWorkerPendingBridge } from '../lib/workerPendingBridge.js'
