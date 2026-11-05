/**
 * Cliente Web Worker: zero-copy (Transferable) + drop policy (solo el audio más reciente).
 */
import { getEmbeddingConfig } from './embeddingConfig.js'
import { REQUEST_TIMEOUT_DEFAULTS } from '../../core/config/sharedConfig.ts'
import { computeSpeakerEmbedding } from './speakerEmbeddingCore.js'
import { DEFAULT_SAMPLE_RATE } from './audioConstants.js'
import { createWorkerPendingBridge } from './workerPendingBridge.js'
import { voiceProbe } from './voiceProbe.ts'

let seq = 0
const workerRequestMs = REQUEST_TIMEOUT_DEFAULTS.WORKER_MS
const EMBED_TYPES = new Set(['embed'])

let embedInFlight = false
let embedPending = null
// SONDA (2026-10-16): una sola linea `embedModel` por sesion con el dtype que el
// WORKER confirmo haber cargado (fp32/q8). Cierra la duda "la config dice fp32 pero
// el worker cacheo q8". No es traza masiva: se emite UNA vez.
let embedModelLogged = false
function logEmbedModel(modelId, dtype) {
  if (embedModelLogged || typeof window === 'undefined') return
  embedModelLogged = true
  voiceProbe('embedModel', { modelId: modelId || '', dtype: dtype || '' })
}

import { isWorkerRuntime } from '../../lib/workerRuntime.ts'

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
  if (type === 'embed') {
    const vector = await computeSpeakerEmbedding(samples, payload.sampleRate, cfg)
    return { vector, dim: vector.length, fallback: true }
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
  logEmbedModel(payload.modelId, result?.dtype)
  return Array.isArray(result?.vector) ? result.vector : []
}

export function preloadVoiceIdWorker() {
  const cfg = getEmbeddingConfig()
  return post('preload', {
    modelId: cfg.modelId || '',
    quantized: cfg.quantized !== false,
  }).then((res) => {
    logEmbedModel(res?.modelId || cfg.modelId || '', res?.dtype)
    return res
  })
}

export async function embedAudioForDiarization(samples, sampleRate = DEFAULT_SAMPLE_RATE) {
  return embedAudioInternal(samples, sampleRate)
}
