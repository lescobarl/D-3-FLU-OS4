/**
 * Núcleo de embedding (solo Node / fallback sin Worker).
 * El navegador usa voiceId.worker.js vía voiceIdWorkerClient.
 */
import { AutoModel, AutoProcessor, env } from '@huggingface/transformers'
import { FLU_CONFIG } from './fluConfig.js'
import { downsampleTo16k, tensorToEmbeddingVector } from './embeddingFrames.js'

let modelBundlePromise = null
let preloadError = null

env.allowLocalModels = false
env.allowRemoteModels = true
if (typeof window !== 'undefined') {
  env.useBrowserCache = true
}

function getEmbeddingConfig() {
  return FLU_CONFIG.voiceIdentity?.capture?.embedding || {}
}

function getModelId(cfg = getEmbeddingConfig()) {
  return cfg.modelId
}

function getTargetSampleRate(cfg = getEmbeddingConfig()) {
  const rate = Number(cfg.targetSampleRate)
  return Number.isFinite(rate) && rate > 0 ? rate : 16000
}

function getMinSamples(cfg = getEmbeddingConfig()) {
  const ratio = Number(cfg.minSampleRatio)
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 0.35
  return Math.floor(getTargetSampleRate(cfg) * safeRatio)
}

function normalizeVector(vector = []) {
  if (!vector.length) return []
  let norm = 0
  for (let i = 0; i < vector.length; i += 1) {
    norm += vector[i] * vector[i]
  }
  norm = Math.sqrt(norm) || 1
  return vector.map((v) => Number(v || 0) / norm)
}

async function createModelBundle(cfg) {
  const modelId = getModelId(cfg)
  const dtype = cfg.quantized === false ? 'fp32' : 'q8'
  const [processor, model] = await Promise.all([
    AutoProcessor.from_pretrained(modelId),
    AutoModel.from_pretrained(modelId, { dtype }),
  ])
  return { processor, model, modelId }
}

export function preloadSpeakerEmbeddingModel() {
  if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
    return import('./voiceIdWorkerClient.js').then((m) => m.preloadVoiceIdWorker())
  }
  if (preloadError) return Promise.reject(preloadError)
  if (modelBundlePromise) return modelBundlePromise

  modelBundlePromise = createModelBundle(getEmbeddingConfig()).catch((error) => {
    modelBundlePromise = null
    preloadError = error
    throw error
  })
  return modelBundlePromise
}

export function getSpeakerEmbeddingModelStatus() {
  const cfg = getEmbeddingConfig()
  const modelId = getModelId(cfg)
  if (preloadError) {
    return { state: 'error', modelId, error: preloadError.message }
  }
  if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
    return { state: 'worker', modelId, dim: 512, backend: 'wavlm-sv-worker' }
  }
  if (modelBundlePromise) {
    return { state: 'loading-or-ready', modelId, dim: 512, backend: 'wavlm-sv' }
  }
  return { state: 'idle', modelId, dim: 512, backend: 'wavlm-sv' }
}

export async function computeSpeakerEmbedding(samples = [], sampleRate = 48000, cfg = getEmbeddingConfig()) {
  if (!samples?.length) return []

  if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
    const { embedAudioForDiarization } = await import('./voiceIdWorkerClient.js')
    return embedAudioForDiarization(samples, sampleRate)
  }

  let frame = samples instanceof Float32Array ? samples : new Float32Array(samples)
  const targetSampleRate = getTargetSampleRate(cfg)
  frame = downsampleTo16k(frame, sampleRate || targetSampleRate, targetSampleRate)
  if (frame.length < getMinSamples(cfg)) return []

  const { processor, model } = await preloadSpeakerEmbeddingModel().then(() =>
    modelBundlePromise || createModelBundle(cfg),
  )
  const inputs = await processor(frame)
  const output = await model(inputs)
  const vector = tensorToEmbeddingVector(output)
  return vector.length ? normalizeVector(vector) : []
}
