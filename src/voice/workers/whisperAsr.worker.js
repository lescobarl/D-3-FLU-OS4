/**
 * Web Worker: Whisper WASM (Transformers.js) — transcriptor ÚNICO (§9).
 * On-device, offline. Recibe audio PCM 16 kHz y devuelve texto.
 * Modelo y opciones vienen de `FLU_CONFIG.transcript.asr` (sin hardcode).
 */
import { pipeline, env } from '@huggingface/transformers'
import { FLU_CONFIG } from '../lib/fluConfig.js'
import { samplesFromTransfer, createWorkerReply } from '../lib/workerBridge.js'
import { logCaughtError } from '../../lib/caughtError';

env.allowLocalModels = false
env.allowRemoteModels = true
env.useBrowserCache = true

let asrPromise = null

function getAsrConfig() {
  return FLU_CONFIG.transcript?.asr || {}
}

async function ensurePipeline(payload = {}) {
  if (!asrPromise) {
    const cfg = getAsrConfig()
    const modelId = payload.modelId || cfg.modelId
    const dtype = payload.dtype || cfg.dtype || 'q8'
    asrPromise = pipeline('automatic-speech-recognition', modelId, { dtype })
  }
  return asrPromise
}

self.onmessage = async (event) => {
  const { id, type, payload = {} } = event.data || {}
  const reply = createWorkerReply(id)

  try {
    if (type === 'preload') {
      await ensurePipeline(payload)
      reply(true, { ready: true, modelId: payload.modelId || getAsrConfig().modelId })
      return
    }

    if (type === 'transcribe') {
      const asr = await ensurePipeline(payload)
      const audio = samplesFromTransfer(payload)
      if (!audio.length) {
        reply(true, { text: '' })
        return
      }
      const cfg = getAsrConfig()
      const output = await asr(audio, {
        language: payload.language || cfg.language,
        task: 'transcribe',
        return_timestamps: false,
        initial_prompt: payload.initialPrompt || cfg.initialPrompt,
        // Antialucinación: sin condicionar en texto previo y sin repetir n-gramas
        // (evita bucles tipo "...de la parte de la parte de la parte...").
        condition_on_previous_text: false,
        no_repeat_ngram_size: 3,
      })
      reply(true, { text: String(output?.text || '').trim() })
      return
    }

    reply(false, null, new Error(`unknown worker message type: ${type}`))
  } catch (error) {
        logCaughtError('[catch] src/voice/workers/whisperAsr.worker.js', error);
    reply(false, null, error)
  }
}
