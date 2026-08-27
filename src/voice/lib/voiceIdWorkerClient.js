/**
 * Cliente Web Worker: zero-copy (Transferable) + drop policy (solo el audio más reciente).
 */
import { FLU_CONFIG } from './fluConfig.js'
import { labelToSpeakerId } from './conversationRow.js'
import { resolveSpeakerIdentityFromVector } from './voiceIdentityResolve.js'
import { computeSpeakerEmbedding } from './speakerEmbeddingCore.js'

let worker = null
let seq = 0
const pending = new Map()
const WORKER_REQUEST_TIMEOUT_MS = 45000
const EMBED_TYPES = new Set(['embed', 'embedAndMatch'])

let embedInFlight = false
let embedPending = null
let embedDroppedCount = 0

function isWorkerRuntime() {
  return typeof Worker !== 'undefined' && typeof window !== 'undefined'
}

function getEmbeddingConfig() {
  return FLU_CONFIG.voiceIdentity?.capture?.embedding || {}
}

/** Búfer transferible: propiedad pasa al worker (zero-copy). */
export function prepareTransferableAudio(samples) {
  const src = samples instanceof Float32Array ? samples : new Float32Array(samples || [])
  if (!src.length) {
    return { audioBuffer: null, byteOffset: 0, sampleCount: 0, transfer: [] }
  }
  const owned =
    src.byteOffset === 0 && src.byteLength === src.buffer.byteLength
      ? src
      : new Float32Array(src)
  const audioBuffer = owned.buffer
  return {
    audioBuffer,
    byteOffset: owned.byteOffset,
    sampleCount: owned.length,
    transfer: [audioBuffer],
  }
}

function scheduleIdle(fn, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const run = () => {
      try {
        resolve(fn())
      } catch (error) {
        reject(error)
      }
    }
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: timeoutMs })
    } else {
      setTimeout(run, 0)
    }
  })
}

function trimClustersForWorker(clusters = [], max = 6) {
  return clusters.slice(0, max).map((c) => ({
    speakerId: c.speakerId,
    label: c.label,
    signature: Array.isArray(c.signature) ? c.signature.slice(0, 512) : [],
  }))
}

function ensureWorker() {
  if (!isWorkerRuntime()) return null
  if (worker) return worker

  worker = new Worker(new URL('../workers/voiceId.worker.js', import.meta.url), {
    type: 'module',
  })

  worker.onmessage = (event) => {
    const { id, ok, result, error } = event.data || {}
    const entry = pending.get(id)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    pending.delete(id)
    if (ok) entry.resolve(result)
    else entry.reject(new Error(error || 'voiceId worker failed'))
  }

  worker.onerror = (event) => {
    for (const [, entry] of pending) {
      if (entry.timer) clearTimeout(entry.timer)
      entry.reject(new Error(event?.message || 'voiceId worker error'))
    }
    pending.clear()
    embedInFlight = false
    embedPending = null
  }

  return worker
}

function postImmediate(type, payload = {}, transfer = []) {
  const w = ensureWorker()
  if (!w) {
    if (typeof window !== 'undefined') {
      return Promise.reject(new Error('voiceId worker unavailable'))
    }
    return runMainThreadFallback(type, payload)
  }
  const id = `vid-${Date.now()}-${(seq += 1)}`
  return new Promise((resolve, reject) => {
    const entry = { resolve, reject, type }
    pending.set(id, entry)
    const timer = setTimeout(() => {
      if (!pending.has(id)) return
      pending.delete(id)
      reject(new Error(`voiceId worker timeout (${type})`))
    }, WORKER_REQUEST_TIMEOUT_MS)
    entry.timer = timer
    w.postMessage({ id, type, payload }, transfer)
  })
}

function rejectEmbedPending(reason = 'dropped-stale') {
  if (!embedPending) return
  const dropped = embedPending
  embedPending = null
  embedDroppedCount += 1
  dropped.reject(new Error(reason))
}

function drainEmbedQueue() {
  if (embedInFlight || !embedPending) return
  const job = embedPending
  embedPending = null
  embedInFlight = true

  const { type, payload, transfer, resolve, reject } = job
  postImmediate(type, payload, transfer)
    .then(resolve, reject)
    .finally(() => {
      embedInFlight = false
      drainEmbedQueue()
    })
}

function postEmbed(type, payload, transfer) {
  return new Promise((resolve, reject) => {
    if (embedPending) {
      rejectEmbedPending('dropped-stale')
    }
    embedPending = { type, payload, transfer, resolve, reject, enqueuedAt: Date.now() }
    drainEmbedQueue()
  })
}

function post(type, payload = {}, transfer = []) {
  if (EMBED_TYPES.has(type)) {
    return postEmbed(type, payload, transfer)
  }
  return postImmediate(type, payload, transfer)
}

async function runMainThreadFallback(type, payload) {
  const cfg = getEmbeddingConfig()
  const samples = samplesFromPayload(payload)
  if (type === 'preload') {
    return { ready: true, modelId: cfg.modelId, fallback: true }
  }
  if (type === 'embed' || type === 'embedAndMatch') {
    const vector = await computeSpeakerEmbedding(samples, payload.sampleRate, cfg)
    if (type === 'embed') {
      return { vector, dim: vector.length, fallback: true }
    }
    const speakerName = payload.fallbackSpeaker || 'Hablante 1'
    return {
      vector,
      speakerId: labelToSpeakerId(speakerName),
      speakerName,
      similarity: 0,
      fallback: true,
    }
  }
  if (type === 'compare') {
    const { compareAudioSignatures } = await import('./voiceIdentity.js')
    return { similarity: compareAudioSignatures(payload.a, payload.b), fallback: true }
  }
  throw new Error(`voiceId fallback unsupported: ${type}`)
}

function samplesFromPayload(payload = {}) {
  const { audioBuffer, byteOffset = 0, sampleCount } = payload
  if (audioBuffer instanceof ArrayBuffer) {
    const count =
      sampleCount > 0 ? sampleCount : Math.floor((audioBuffer.byteLength - byteOffset) / 4)
    return count > 0 ? new Float32Array(audioBuffer, byteOffset, count) : new Float32Array(0)
  }
  if (payload.samples instanceof Float32Array) return payload.samples
  if (Array.isArray(payload.samples)) return new Float32Array(payload.samples)
  return new Float32Array(0)
}

async function embedAudioInternal(samples, sampleRate = 48000) {
  const { audioBuffer, byteOffset, sampleCount, transfer } = prepareTransferableAudio(samples)
  if (!sampleCount) return []
  const payload = {
    audioBuffer,
    byteOffset,
    sampleCount,
    sampleRate,
    ...getEmbeddingConfig(),
  }
  const result = await post('embed', payload, transfer).catch((error) => {
    if (typeof window !== 'undefined') throw error
    return runMainThreadFallback('embed', { ...payload, samples: samplesFromPayload(payload) })
  })
  return Array.isArray(result?.vector) ? result.vector : []
}

function resolveIdentityIdle(vector, matchPayload, sampleRate, sourceLength) {
  return scheduleIdle(
    () =>
      resolveSpeakerIdentityFromVector(vector, {
        speakerClusters: matchPayload.speakerClusters || [],
        lastSpeaker: matchPayload.lastSpeaker,
        lastSignature: matchPayload.lastSignature,
        fallbackSpeaker: matchPayload.fallbackSpeaker,
        utteranceText: matchPayload.utteranceText || '',
        sampleRate,
        voicedSampleCount: sourceLength,
        atTurnBoundary: matchPayload.atTurnBoundary !== false,
        allowNewCluster: Boolean(matchPayload.allowNewCluster),
        preferSpeaker: matchPayload.preferSpeaker || '',
        reservedLabels: matchPayload.reservedLabels || [],
        sessionPrimary: matchPayload.sessionPrimary || '',
      }),
    3000,
  )
}

export async function resolveSpeakerFromAudio(samples, sampleRate = 48000, matchPayload = {}) {
  const { audioBuffer, byteOffset, sampleCount, transfer } = prepareTransferableAudio(samples)
  const cfg = FLU_CONFIG.voiceIdentity?.capture?.conversationSpeakerThresholds || {}
  const fallbackName = matchPayload.fallbackSpeaker || 'Hablante 1'

  if (!sampleCount) {
    return {
      speakerId: labelToSpeakerId(fallbackName),
      speakerName: fallbackName,
      workingClusters: matchPayload.speakerClusters || [],
      signatureVector: [],
      reason: 'no-audio',
    }
  }

  const payload = {
    audioBuffer,
    byteOffset,
    sampleCount,
    sampleRate,
    ...getEmbeddingConfig(),
    clusters: trimClustersForWorker(matchPayload.speakerClusters || []),
    lastSpeaker: matchPayload.lastSpeaker || '',
    lastSignature: Array.isArray(matchPayload.lastSignature)
      ? matchPayload.lastSignature.slice(0, 512)
      : null,
    fallbackSpeaker: fallbackName,
    roomRematchFloor:
      Number(cfg.roomRematchThreshold) > 0 ? Number(cfg.roomRematchThreshold) : 0.85,
    soloNewVoiceFactor:
      Number(FLU_CONFIG.voiceIdentity?.capture?.roomCapture?.soloNewVoiceFactor) || 0.82,
  }

  let vector = []
  let workerHint = null
  try {
    const raw = await post('embedAndMatch', payload, transfer).catch((error) => {
      if (typeof window !== 'undefined') throw error
      return runMainThreadFallback('embedAndMatch', {
        ...payload,
        samples: samplesFromPayload(payload),
      })
    })
    vector = Array.isArray(raw?.vector) ? raw.vector : []
    if (raw?.speakerId && raw?.speakerName && raw?.reason && raw.reason !== 'no-vector') {
      workerHint = {
        speakerId: raw.speakerId,
        speakerName: raw.speakerName,
        reason: raw.reason,
      }
    }
  } catch (error) {
    if (String(error?.message || error).includes('dropped-stale')) {
      return {
        speakerId: labelToSpeakerId(fallbackName),
        speakerName: fallbackName,
        workingClusters: matchPayload.speakerClusters || [],
        signatureVector: [],
        reason: 'dropped-stale',
      }
    }
    return {
      speakerId: labelToSpeakerId(fallbackName),
      speakerName: fallbackName,
      workingClusters: matchPayload.speakerClusters || [],
      signatureVector: [],
      reason: 'worker-fail',
      error: String(error?.message || error),
    }
  }

  if (!vector.length) {
    return {
      speakerId: labelToSpeakerId(fallbackName),
      speakerName: fallbackName,
      workingClusters: matchPayload.speakerClusters || [],
      signatureVector: [],
      reason: 'no-vector',
    }
  }

  if (
    workerHint &&
    (workerHint.reason === 'last-signature' || workerHint.reason === 'cluster-nearest')
  ) {
    const identity = await resolveIdentityIdle(vector, matchPayload, sampleRate, sampleCount)
    const sameLabel =
      String(identity.speakerName || '').trim() === String(workerHint.speakerName || '').trim()
    if (sameLabel) {
      return {
        speakerId: workerHint.speakerId,
        speakerName: workerHint.speakerName,
        workingClusters: identity.workingClusters,
        signatureVector: vector,
        reason: workerHint.reason,
      }
    }
  }

  const identity = await resolveIdentityIdle(vector, matchPayload, sampleRate, sampleCount)
  return {
    speakerId: identity.speakerId,
    speakerName: identity.speakerName,
    workingClusters: identity.workingClusters,
    signatureVector: identity.signatureVector?.length ? identity.signatureVector : vector,
    reason: 'resolved-idle',
  }
}

export function preloadVoiceIdWorker() {
  const cfg = getEmbeddingConfig()
  return post('preload', {
    modelId: cfg.modelId || '',
    quantized: cfg.quantized !== false,
  })
}

export async function embedAudioForDiarization(samples, sampleRate = 48000) {
  return embedAudioInternal(samples, sampleRate)
}

export function getVoiceIdWorkerStats() {
  return {
    embedInFlight,
    embedPending: Boolean(embedPending),
    embedDroppedCount,
    pendingRequests: pending.size,
  }
}

export function terminateVoiceIdWorker() {
  if (worker) {
    worker.terminate()
    worker = null
  }
  pending.clear()
  embedInFlight = false
  rejectEmbedPending('worker-terminated')
}
