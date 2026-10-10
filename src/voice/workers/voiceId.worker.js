/**
 * Web Worker: WavLM-SV (Transformers.js) + coseno 512-D.
 * Diarización estricta: sin atajos optimistas; voz distinta → nuevo Hablante N.
 */
import { AutoModel, AutoProcessor, env } from '@huggingface/transformers'
import {
  compareCosineSignatures,
  normalizeEmbeddingVector as normalizeVector,
} from '../lib/speakerCore.js'
import { downsampleTo16k, tensorToEmbeddingVector } from '../lib/embeddingFrames.js'
import { samplesFromTransfer, createWorkerReply } from '../lib/workerBridge.js'
import { logCaughtError } from '../../lib/caughtError';
import {
  getEmbeddingConfig,
  getMinSamples,
  getModelId,
  getTargetSampleRate,
} from '../lib/embeddingConfig.js'


env.allowLocalModels = false
env.allowRemoteModels = true
env.useBrowserCache = true

let modelBundlePromise = null

async function ensureModel(modelId = getModelId(), quantized = true) {
  if (!modelBundlePromise) {
    const dtype = quantized === false ? 'fp32' : 'q8'
    modelBundlePromise = Promise.all([
      AutoProcessor.from_pretrained(modelId),
      AutoModel.from_pretrained(modelId, { dtype }),
    ]).then(([processor, model]) => ({ processor, model, modelId }))
  }
  return modelBundlePromise
}

async function embedAudio(payload = {}) {
  const frame = samplesFromTransfer(payload)
  if (!frame.length) return []
  const cfg = getEmbeddingConfig()
  const targetSampleRate = getTargetSampleRate(cfg)
  const sampleRate = payload.sampleRate || targetSampleRate
  const downsampled = downsampleTo16k(frame, sampleRate, targetSampleRate)
  if (downsampled.length < getMinSamples(cfg)) return []

  const { processor, model } = await ensureModel(payload.modelId || getModelId(cfg), payload.quantized !== false)
  const inputs = await processor(downsampled)
  const output = await model(inputs)
  const raw = tensorToEmbeddingVector(output)
  return raw.length ? normalizeVector(raw) : []
}

self.onmessage = async (event) => {
  const { id, type, payload = {} } = event.data || {}
  const reply = createWorkerReply(id)

  try {
    if (type === 'preload') {
      const cfg = getEmbeddingConfig()
      await ensureModel(payload.modelId || getModelId(cfg), payload.quantized !== false)
      reply(true, { ready: true, modelId: payload.modelId || getModelId(cfg) })
      return
    }

    if (type === 'embed') {
      const vector = await embedAudio(payload)
      reply(true, { vector, dim: vector.length })
      return
    }

    if (type === 'compare') {
      const similarity = compareCosineSignatures(payload.a || [], payload.b || [])
      reply(true, { similarity })
      return
    }

    reply(false, null, new Error(`unknown worker message type: ${type}`))
  } catch (error) {
        logCaughtError('[catch] src/voice/workers/voiceId.worker.js', error);
    reply(false, null, error)
  }
}
