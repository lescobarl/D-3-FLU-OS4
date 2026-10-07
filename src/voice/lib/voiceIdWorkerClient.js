/**
 * Cliente Web Worker: zero-copy (Transferable) + drop policy (solo el audio más reciente).
 */
import { FLU_CONFIG } from './fluConfig.js'
import { getEmbeddingConfig } from './embeddingConfig.js'
import { ROOM_REMATCH_STRICT } from './speakerClusters.js'
import { REQUEST_TIMEOUT_DEFAULTS } from '../../core/config/sharedConfig'
import { labelToSpeakerId } from './conversationRow.js'
import { resolveSpeakerIdentityFromVector } from './voiceIdentityResolve.js'
import { computeSpeakerEmbedding } from './speakerEmbeddingCore.js'
import { logCaughtError } from '../../lib/caughtError';
import { relayLog } from '../../lib/clientLogRelay';
import { DEFAULT_SAMPLE_RATE } from './audioConstants.js'
import { createWorkerPendingBridge } from './workerPendingBridge.js'
import { scheduleIdle } from './idleSchedule.js'

let seq = 0
const workerRequestMs = REQUEST_TIMEOUT_DEFAULTS.WORKER_MS
const EMBED_TYPES = new Set(['embed', 'embedAndMatch'])

let embedInFlight = false
let embedPending = null

import { isWorkerRuntime } from '../../lib/workerRuntime'

// El dueno de la pregunta es src/lib/workerRuntime.ts (antes habia una copia aqui
// con la guarda extra de `window`, que solo cambia fuera del hilo principal).

// Esqueleto comun (P8.9): creacion perezosa + despacho por id + fail-all.
// voiceId NO termina el worker al fallar (solo limpia su estado de embedding),
// por eso su onFatal no llama a terminate: el puente deja esa politica al cliente.
const bridge = createWorkerPendingBridge({
  createWorker: () =>
    new Worker(new URL('../workers/voiceId.worker.js', import.meta.url), { type: 'module' }),
  canRun: isWorkerRuntime,
  label: 'voiceId',
  valueKey: 'result',
  failMessage: 'voiceId worker failed',
  onFatal: () => {
    embedInFlight = false
    embedPending = null
  },
})

/**
 * Búfer transferible para el worker.
 *
 * SEGURIDAD (E0): `postMessage(payload, [buffer])` DESACOPLA el ArrayBuffer del
 * hilo emisor (`.length`/`.byteLength` -> 0). Un búfer que NO es nuestro no se
 * puede transferir: el MISMO `audioSnapshot` lo comparten EN PARALELO la firma
 * (`computeTurnSignature`) y la diarización (`resolveSpeaker`), así que el
 * transfer de la firma dejaba el snapshot a 0 y la diarización NO veía audio
 * (medido: `SpeakerTrace vecLen=4 snap=0` y `dim=512 empty=false snap=0`; todo
 * caía a "Hablante 1"). Por defecto se COPIA y se transfiere la copia, que sí
 * es nuestra. `transferOwnership` existe para un llamador que ceda la propiedad
 * a propósito (hoy: ninguno).
 */
export function prepareTransferableAudio(samples, { transferOwnership = false } = {}) {
  const src = samples instanceof Float32Array ? samples : new Float32Array(samples || [])
  if (!src.length) {
    return { audioBuffer: null, byteOffset: 0, sampleCount: 0, transfer: [] }
  }
  const owned =
    transferOwnership && src.byteOffset === 0 && src.byteLength === src.buffer.byteLength
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

function scheduleIdleAsync(fn, timeoutMs) {
  return new Promise((resolve, reject) => {
    scheduleIdle(() => {
      try {
        resolve(fn())
      } catch (error) {
        reject(error)
      }
    }, timeoutMs)
  })
}

function trimClustersForWorker(clusters = [], max = 6) {
  return clusters.slice(0, max).map((c) => ({
    speakerId: c.speakerId,
    label: c.label,
    signature: Array.isArray(c.signature) ? c.signature.slice(0, 512) : [],
  }))
}

function postImmediate(type, payload = {}, transfer = []) {
  const w = bridge.ensure()
  if (!w) {
    if (typeof window !== 'undefined') {
      return Promise.reject(new Error('voiceId worker unavailable'))
    }
    return runMainThreadFallback(type, payload)
  }
  const id = `vid-${Date.now()}-${(seq += 1)}`
  return new Promise((resolve, reject) => {
    const entry = { resolve, reject, type }
    bridge.pending.set(id, entry)
    const timer = setTimeout(() => {
      if (!bridge.pending.has(id)) return
      bridge.pending.delete(id)
      reject(new Error(`voiceId worker timeout (${type})`))
    }, workerRequestMs)
    entry.timer = timer
    w.postMessage({ id, type, payload }, transfer)
  })
}

function rejectEmbedPending(reason = 'dropped-stale') {
  if (!embedPending) return
  const dropped = embedPending
  embedPending = null
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
    const speakerName = payload.fallbackSpeaker || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
    return {
      vector,
      speakerId: labelToSpeakerId(speakerName),
      speakerName,
      similarity: 0,
      fallback: true,
    }
  }
  if (type === 'compare') {
    const { compareCosineSignatures } = await import('./voiceIdentity.js')
    return { similarity: compareCosineSignatures(payload.a, payload.b), fallback: true }
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

async function embedAudioInternal(samples, sampleRate = DEFAULT_SAMPLE_RATE) {
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
  return scheduleIdleAsync(
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

export async function resolveSpeakerFromAudio(samples, sampleRate = DEFAULT_SAMPLE_RATE, matchPayload = {}) {
  const { audioBuffer, byteOffset, sampleCount, transfer } = prepareTransferableAudio(samples)
  const cfg = FLU_CONFIG.voiceIdentity?.capture?.conversationSpeakerThresholds || {}
  const fallbackName = matchPayload.fallbackSpeaker || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker

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
    preferSpeaker: matchPayload.sessionPrimary || matchPayload.preferSpeaker || '',
    lastSignature: Array.isArray(matchPayload.lastSignature)
      ? matchPayload.lastSignature.slice(0, 512)
      : null,
    fallbackSpeaker: fallbackName,
    roomRematchFloor:
      Number(cfg.roomRematchThreshold) > 0 ? Number(cfg.roomRematchThreshold) : ROOM_REMATCH_STRICT,
    soloNewVoiceFactor:
      Number(FLU_CONFIG.voiceIdentity?.capture?.roomCapture?.soloNewVoiceFactor) || 0.82,
  }

  let vector = []
  try {
    const raw = await post('embedAndMatch', payload, transfer).catch((error) => {
      if (typeof window !== 'undefined') throw error
      return runMainThreadFallback('embedAndMatch', {
        ...payload,
        samples: samplesFromPayload(payload),
      })
    })
    vector = Array.isArray(raw?.vector) ? raw.vector : []
    if (typeof window !== 'undefined') {
      relayLog(
        'LOG',
        'Match',
        `reason=${raw?.reason || ''} sim=${Number(raw?.similarity ?? 0).toFixed(3)} name="${raw?.speakerName || ''}" inClusters=${payload.clusters?.length ?? 0} last="${payload.lastSpeaker || ''}" clusterMatch=${Number(cfg.productionClusterReuseThreshold) || '-'} newVoice=${Number(cfg.cosineNewVoiceThreshold) || '-'}`,
      )
    }
  } catch (error) {
        logCaughtError('[catch] src/voice/lib/voiceIdWorkerClient.js', error);
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

export async function embedAudioForDiarization(samples, sampleRate = DEFAULT_SAMPLE_RATE) {
  return embedAudioInternal(samples, sampleRate)
}
