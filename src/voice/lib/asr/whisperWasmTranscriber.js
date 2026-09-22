/**
 * Transcriptor ÚNICO de escucha (§9): Whisper WASM on-device sobre el PCM.
 * Encapsula UN solo worker. La app lo inyecta (DI); nadie más transcribe.
 * Modelo y opciones desde `FLU_CONFIG.transcript.asr` (sin hardcode).
 */
import { getAsrConfig } from './voiceActivitySegmenter.js'
import { logCaughtError } from '../../../lib/caughtError';

/**
 * @param {{ workerFactory?: () => Worker, modelId?: string, dtype?: string }} [options]
 *   Fábrica inyectable (por defecto, el worker real de Whisper WASM) y override
 *   de modelo/dtype (para usar `tiny` en interim y `base` en final).
 */
export function createWhisperWasmTranscriber({ workerFactory, modelId, dtype } = {}) {
  let worker = null
  let seq = 0
  const pending = new Map()
  const baseConfig = getAsrConfig()
  const config = {
    ...baseConfig,
    ...(modelId ? { modelId } : {}),
    ...(dtype ? { dtype } : {}),
  }

  function ensureWorker() {
    if (worker) return worker
    worker =
      typeof workerFactory === 'function'
        ? workerFactory()
        : new Worker(new URL('../../workers/whisperAsr.worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (event) => {
      const { id, ok, result, error } = event.data || {}
      const entry = pending.get(id)
      if (!entry) return
      pending.delete(id)
      if (ok) entry.resolve(result)
      else entry.reject(new Error(error || 'whisper worker error'))
    }
    worker.onerror = (event) => {
      const error = new Error(String(event?.message || 'whisper worker error'))
      for (const entry of pending.values()) entry.reject(error)
      pending.clear()
      // Reintento: se destruye el worker roto; la próxima petición lo recrea.
      try {
        worker.terminate()
      } catch {
        logCaughtError('[catch] src/voice/lib/asr/whisperWasmTranscriber.js');
        // ignore
      }
      worker = null
    }
    return worker
  }

  function request(type, payload = {}) {
    const active = ensureWorker()
    seq += 1
    const id = seq
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      active.postMessage({ id, type, payload })
    })
  }

  return Object.freeze({
    get modelId() {
      return config.modelId
    },
    preload() {
      return request('preload', { modelId: config.modelId, dtype: config.dtype })
    },
    async transcribe(samples) {
      if (!samples?.length) return ''
      const audio = samples instanceof Float32Array ? samples : new Float32Array(samples)
      const result = await request('transcribe', {
        samples: audio,
        sampleRate: config.targetSampleRate,
        modelId: config.modelId,
        language: config.language,
        dtype: config.dtype,
        initialPrompt: config.initialPrompt,
      })
      return String(result?.text || '').trim()
    },
    dispose() {
      // No dejar promesas colgadas: al destruir, rechazar lo pendiente para que
      // la cola de transcripción avance y `busy` se libere.
      const disposedError = new Error('whisper worker disposed')
      for (const entry of pending.values()) entry.reject(disposedError)
      pending.clear()
      if (worker) {
        try {
          worker.terminate()
        } catch {
        logCaughtError('[catch] src/voice/lib/asr/whisperWasmTranscriber.js');
          // ignore
        }
        worker = null
      }
    },
  })
}
