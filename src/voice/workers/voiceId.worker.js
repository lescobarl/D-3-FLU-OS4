/**
 * Web Worker: WavLM-SV (Transformers.js) + coseno 512-D.
 * Diarización estricta: sin atajos optimistas; voz distinta → nuevo Hablante N.
 */
import { AutoModel, AutoProcessor, env } from '@huggingface/transformers'
import { FLU_CONFIG } from '../lib/fluConfig.js'
import {
  assignSpeakerStrictCosine,
  compareCosineSignatures,
  normalizeSignatureVector,
} from '../lib/speakerCosineStrict.js'

const DEFAULT_MATCH_THRESHOLD = 0.85

env.allowLocalModels = false
env.allowRemoteModels = true
env.useBrowserCache = true

let modelBundlePromise = null

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

function downsampleTo16k(samples, sampleRate, targetRate) {
  if (!samples?.length) return new Float32Array(0)
  const safeTargetRate = Number(targetRate) > 0 ? Number(targetRate) : 16000
  if (sampleRate <= safeTargetRate) {
    return samples instanceof Float32Array ? samples : new Float32Array(samples)
  }
  const ratio = sampleRate / safeTargetRate
  const length = Math.max(1, Math.floor(samples.length / ratio))
  const result = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    result[index] = samples[Math.min(samples.length - 1, Math.floor(index * ratio))]
  }
  return result
}

function tensorToEmbeddingVector(output) {
  const tensor = output?.embeddings ?? output?.logits
  if (!tensor?.data) return []
  return Array.from(tensor.data)
}

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

/** Coseno L2 explícito entre embeddings normalizados. */
function compareAudioSignatures(sig1 = [], sig2 = []) {
  return compareCosineSignatures(sig1, sig2)
}

function normalizeVector(vector = []) {
  return normalizeSignatureVector(vector)
}

function samplesFromTransfer(payload = {}) {
  const { audioBuffer, samples, byteOffset = 0, sampleCount } = payload
  if (audioBuffer instanceof ArrayBuffer) {
    const count =
      Number.isFinite(sampleCount) && sampleCount > 0
        ? sampleCount
        : Math.floor((audioBuffer.byteLength - byteOffset) / 4)
    return count > 0 ? new Float32Array(audioBuffer, byteOffset, count) : new Float32Array(0)
  }
  if (samples instanceof ArrayBuffer) {
    const count =
      Number.isFinite(sampleCount) && sampleCount > 0
        ? sampleCount
        : Math.floor(samples.byteLength / 4)
    return count > 0 ? new Float32Array(samples, byteOffset, count) : new Float32Array(0)
  }
  if (samples instanceof Float32Array) return samples
  if (Array.isArray(samples)) return new Float32Array(samples)
  return new Float32Array(0)
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

function labelToSpeakerId(label = '') {
  const text = String(label || '').trim()
  const match = text.match(/^Hablante\s+(\d+)$/i)
  if (match) return `speaker_${match[1]}`
  const slug = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug ? `speaker_name_${slug}` : 'speaker_1'
}

function assignSpeakerStrict(vector, options = {}) {
  const assignment = assignSpeakerStrictCosine(vector, options)
  return {
    ...assignment,
    speakerId: labelToSpeakerId(assignment.speakerName),
  }
}

self.onmessage = async (event) => {
  const { id, type, payload = {} } = event.data || {}
  const reply = (ok, result, error) => {
    self.postMessage({ id, ok, result, error: error ? String(error?.message || error) : '' })
  }

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
      const similarity = compareAudioSignatures(payload.a || [], payload.b || [])
      reply(true, { similarity })
      return
    }

    if (type === 'embedAndMatch') {
      const vector = await embedAudio(payload)
      const matchThreshold =
        Number(payload.roomRematchFloor) > 0 && Number(payload.roomRematchFloor) <= 1
          ? Number(payload.roomRematchFloor)
          : Number(payload.matchThreshold) > 0 && Number(payload.matchThreshold) <= 1
            ? Number(payload.matchThreshold)
            : DEFAULT_MATCH_THRESHOLD

      if (!vector.length) {
        const fallbackLabel = String(payload.fallbackSpeaker || 'Hablante 1').trim() || 'Hablante 1'
        reply(true, {
          vector: [],
          speakerId: labelToSpeakerId(fallbackLabel),
          speakerName: fallbackLabel,
          similarity: 0,
          reason: 'no-vector',
        })
        return
      }

      const assignment = assignSpeakerStrict(vector, {
        clusters: payload.clusters || [],
        matchThreshold,
        reservedLabels: payload.reservedLabels || [],
        preferLabel: payload.preferSpeaker || payload.lastSpeaker || '',
        lastSpeaker: payload.lastSpeaker || '',
        lastSignature: payload.lastSignature || null,
        continuityThreshold: payload.continuityThreshold ?? 0.74,
        newVoiceThreshold: payload.newVoiceThreshold ?? 0.68,
        matchThresholdCluster: payload.matchThresholdCluster ?? 0.76,
        soloNewVoiceFactor: payload.soloNewVoiceFactor ?? 0.82,
      })

      reply(true, {
        vector,
        speakerId: assignment.speakerId,
        speakerName: assignment.speakerName,
        similarity: assignment.similarity,
        reason: assignment.reason,
      })
      return
    }

    reply(false, null, new Error(`unknown worker message type: ${type}`))
  } catch (error) {
    reply(false, null, error)
  }
}
