/**
 * Transcriptor ÚNICO de escucha (§9): Whisper WASM on-device sobre el PCM.
 * Encapsula UN solo worker. La app lo inyecta (DI); nadie más transcribe.
 * Modelo y opciones desde `FLU_CONFIG.transcript.asr` (sin hardcode).
 */
import { getAsrConfig } from './voiceActivitySegmenter.js'
import { createWorkerPendingBridge } from '../workerPendingBridge.js'

/**
 * @param {{ workerFactory?: () => Worker, modelId?: string, dtype?: string }} [options]
 *   Fábrica inyectable (por defecto, el worker real de Whisper WASM) y override
 *   de modelo/dtype (para usar `tiny` en interim y `base` en final).
 */
export function createWhisperWasmTranscriber({ workerFactory, modelId, dtype } = {}) {
  const baseConfig = getAsrConfig()
  const config = {
    ...baseConfig,
    ...(modelId ? { modelId } : {}),
    ...(dtype ? { dtype } : {}),
  }

  // Esqueleto comun (P8.9): creacion perezosa + despacho por id + fail-all.
  const bridge = createWorkerPendingBridge({
    createWorker: () =>
      typeof workerFactory === 'function'
        ? workerFactory()
        : new Worker(new URL('../../workers/whisperAsr.worker.js', import.meta.url), { type: 'module' }),
    label: 'whisper',
    valueKey: 'result',
    failMessage: 'whisper worker error',
    // Al morir el worker: lo pendiente lo rechaza el puente; aqui se destruye el roto.
    onFatal: (_reason, api) => api.terminate(),
  })
  const pending = bridge.pending
  let seq = 0

  function request(type, payload = {}) {
    const active = bridge.ensure()
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
      bridge.dispose(new Error('whisper worker disposed'))
    },
  })
}
