/**
 * Web Worker: WavLM-SV (Transformers.js) + coseno 512-D.
 * Diarización estricta: sin atajos optimistas; voz distinta → nuevo Hablante N.
 */
import { AutoModel, AutoProcessor, env } from '@huggingface/transformers'
import { FLU_CONFIG } from '../lib/fluConfig.js'
import {
  assignSpeaker,
  compareCosineSignatures,
  getFallbackSpeaker,
  labelToSpeakerId,
  normalizeEmbeddingVector as normalizeVector,
} from '../lib/speakerCore.js'
import { downsampleTo16k, tensorToEmbeddingVector } from '../lib/embeddingFrames.js'
import { samplesFromTransfer, createWorkerReply } from '../lib/workerBridge.js'

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

    if (type === 'embedAndMatch') {
      const vector = await embedAudio(payload)
      const matchThreshold =
        Number(payload.roomRematchFloor) > 0 && Number(payload.roomRematchFloor) <= 1
          ? Number(payload.roomRematchFloor)
          : Number(payload.matchThreshold) > 0 && Number(payload.matchThreshold) <= 1
            ? Number(payload.matchThreshold)
            : DEFAULT_MATCH_THRESHOLD

      if (!vector.length) {
        const fallbackLabel =
          String(payload.fallbackSpeaker || getFallbackSpeaker()).trim() || getFallbackSpeaker()
        reply(true, {
          vector: [],
          speakerId: labelToSpeakerId(fallbackLabel),
          speakerName: fallbackLabel,
          similarity: 0,
          reason: 'no-vector',
        })
        return
      }

      const assignment = assignSpeaker(vector, {
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
