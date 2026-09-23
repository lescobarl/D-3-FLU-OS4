/**
 * Clusters de hablante + ventana de audio para firma (512-D): actualización,
 * búsqueda por vecino más cercano, match histórico de frase corta y fusión.
 * Única fuente de estas operaciones; el resolver (speakerDiarization.js) las consume.
 */
import { blendEmbeddingVectors, normalizeSpaces } from './audioMath.js'
import { compareCosineSignatures, normalizeEmbeddingVector } from './speakerCore.js'
import { foldSpeakerKey, getVoiceIdentityConfig } from './speakerLabels.js'
import { getPassiveBufferMs } from './micCapture.js'

export const ROOM_REMATCH_STRICT = 0.85
export const SHORT_UTTERANCE_HISTORICAL_MATCH = 0.7
export const SHORT_UTTERANCE_IMMEDIATE_CONTINUITY = 0.72

/** Umbral coseno validado en (0, 1]; fuera de rango usa el fallback. */
export function cosineThreshold(thresholds = {}, key, fallback) {
  const value = Number(thresholds?.[key])
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : fallback
}

/** Solo las últimas N ms de chunks — evita copiar/analizar todo el buffer en cada commit. */
export function flattenChunksTail(chunks = [], maxSamples = 0) {
  if (!chunks.length || maxSamples <= 0) return new Float32Array(0)

  const tailChunks = []
  let total = 0
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    tailChunks.unshift(chunks[index])
    total += chunks[index]?.length || 0
    if (total >= maxSamples) break
  }

  if (!tailChunks.length) return new Float32Array(0)

  const length = tailChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Float32Array(length)
  let offset = 0
  tailChunks.forEach((chunk) => {
    result.set(chunk, offset)
    offset += chunk.length
  })

  if (total > maxSamples) {
    return result.subarray(result.length - maxSamples)
  }
  return result
}

/** Ventana de audio del turno actual (desde último cierre) con fallback a cola fija. */
export function flattenChunksWindow(
  chunks = [],
  { totalSamples = 0, sinceSample = 0, maxSamples = 0, minSamples = 0 } = {},
) {
  const flat = flattenChunksTail(chunks, Number.POSITIVE_INFINITY)
  if (!flat.length) return new Float32Array(0)

  const bufferLen = flat.length
  const turnSpan = Math.max(0, totalSamples - sinceSample)
  let windowLen = turnSpan > 0 ? Math.min(turnSpan, bufferLen) : bufferLen
  if (maxSamples > 0) windowLen = Math.min(windowLen, maxSamples)
  if (minSamples > 0 && windowLen < minSamples) {
    windowLen = Math.min(Math.max(windowLen, minSamples), bufferLen)
  }

  return flat.subarray(Math.max(0, flat.length - windowLen))
}

export function trimAudioChunkBuffer(
  chunksRef,
  sampleRate,
  maxMs,
  totalSamplesRef,
  config = getVoiceIdentityConfig(),
  { minRetainMs = 0 } = {},
) {
  const limitMs = Number.isFinite(maxMs) ? maxMs : getPassiveBufferMs(config)
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000
  const minRetainSamples =
    Number.isFinite(minRetainMs) && minRetainMs > 0
      ? Math.floor(rate * (minRetainMs / 1000))
      : 0
  const maxSamples = Math.max(minRetainSamples + 4096, Math.floor(rate * (limitMs / 1000)))
  let total = totalSamplesRef?.current
  if (!Number.isFinite(total)) {
    total = chunksRef.current.reduce((sum, chunk) => sum + chunk.length, 0)
    if (totalSamplesRef) totalSamplesRef.current = total
  }

  while (total > maxSamples && chunksRef.current.length > 0) {
    const removed = chunksRef.current.shift()
    total -= removed?.length || 0
  }

  if (minRetainSamples > 0 && total < minRetainSamples && chunksRef.current.length === 0) {
    if (totalSamplesRef) totalSamplesRef.current = total
    return
  }

  if (totalSamplesRef) totalSamplesRef.current = total
}

function countUtteranceWords(text = '') {
  return normalizeSpaces(text)
    .split(/\s+/)
    .filter(Boolean).length
}

/** Frase corta o buffer breve: embeddings 512-D fluctúan más. */
export function isShortUtteranceContext({
  utteranceText = '',
  voicedSampleCount = 0,
  sampleRate = 48000,
  thresholds = {},
} = {}) {
  const maxWords = Number(thresholds.shortUtteranceMaxWords)
  const maxMs = Number(thresholds.shortUtteranceMaxMs)
  const wordCap = Number.isFinite(maxWords) && maxWords > 0 ? maxWords : 3
  const msCap = Number.isFinite(maxMs) && maxMs > 0 ? maxMs : 1500
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000
  const words = countUtteranceWords(utteranceText)
  const durationMs = voicedSampleCount > 0 ? (voicedSampleCount / rate) * 1000 : 0
  if (words > 0 && words < wordCap) return true
  /** Audio breve solo cuenta si hay transcripción (evita relajar por cola de 1s sin frase). */
  if (words > 0 && durationMs > 0 && durationMs < msCap) return true
  return false
}

/**
 * Umbral room-rematch estricto (0.85): similitud coseno < umbral → room-new-person.
 */
export function resolveRoomRematchThreshold({ thresholds = {} } = {}) {
  const configured = cosineThreshold(thresholds, 'roomRematchThreshold', ROOM_REMATCH_STRICT)
  return Math.max(ROOM_REMATCH_STRICT, configured)
}

/** Emparejamiento permitido solo si similitud ≥ umbral room-rematch. */
export function passesRoomRematchStrict(similarity, thresholds = {}) {
  const floor = resolveRoomRematchThreshold({ thresholds })
  return Number.isFinite(similarity) && similarity >= floor
}

export function updateClusterSignature(cluster, vector) {
  const next = normalizeEmbeddingVector(vector)
  if (!next.length) return

  const stableHistory = Array.isArray(cluster?.signatureHistory)
    ? cluster.signatureHistory
      .filter((entry) => Array.isArray(entry) && entry.length)
      .map((entry) => normalizeEmbeddingVector(entry))
      .slice(-3)
    : []

  let base = Array.isArray(cluster?.signature) && cluster.signature.length
    ? normalizeEmbeddingVector(cluster.signature)
    : next

  if (stableHistory.length) {
    base = stableHistory.reduce(
      (acc, entry) => blendEmbeddingVectors(acc, entry, 0.5),
      stableHistory[0],
    )
  }

  cluster.signature = blendEmbeddingVectors(base, next, 0.4)
  cluster.signatureHistory = [...stableHistory, [...next]].slice(-3)
}

const _clusterMapCache = new WeakMap()

function _buildClusterMap(speakerClusters) {
  const cached = _clusterMapCache.get(speakerClusters)
  if (cached && cached.length === speakerClusters.length) return cached.map
  const map = new Map()
  for (let i = 0; i < speakerClusters.length; i++) {
    const cluster = speakerClusters[i]
    if (cluster && cluster.label != null) {
      map.set(String(cluster.label).trim(), cluster)
    }
  }
  _clusterMapCache.set(speakerClusters, { map, length: speakerClusters.length })
  return map
}

export function findClusterByLabel(speakerClusters, label = '') {
  const normalized = String(label || '').trim()
  if (!normalized) return null
  const map = _buildClusterMap(speakerClusters)
  return map.get(normalized) || null
}

export function ensureClusterForLabel(speakerClusters, label, vector) {
  const existing = findClusterByLabel(speakerClusters, label)
  if (existing) {
    updateClusterSignature(existing, vector)
    return existing
  }
  const cluster = { label, signature: [...vector], signatureHistory: [[...vector]] }
  speakerClusters.push(cluster)
  return cluster
}

export function findNearestCluster(vector, speakerClusters = []) {
  let nearestCluster = null
  let nearestSimilarity = -1
  const probe = normalizeEmbeddingVector(vector)
  speakerClusters.forEach((cluster) => {
    if (!Array.isArray(cluster?.signature) || !cluster.signature.length) return
    const similarity = compareCosineSignatures(probe, cluster.signature)
    if (similarity > nearestSimilarity) {
      nearestSimilarity = similarity
      nearestCluster = cluster
    }
  })
  return { nearestCluster, nearestSimilarity }
}

/**
 * Embedding corto/inestable: busca en firma + signatureHistory con tolerancia dinámica (≥0.70).
 * Unifica ID existente en lugar de abrir Hablante 7/8 en frases rápidas («hola hola»).
 */
export function findShortUtteranceHistoricalMatch({
  vector,
  speakerClusters = [],
  thresholds = {},
  utteranceText = '',
  voicedSampleCount = 0,
  sampleRate = 48000,
  preferSpeaker = '',
  lastSpeaker = '',
  effectiveSticky = '',
  sameCaptureSource = true,
} = {}) {
  if (!sameCaptureSource) return null
  if (
    !isShortUtteranceContext({
      utteranceText,
      voicedSampleCount,
      sampleRate,
      thresholds,
    })
  ) {
    return null
  }

  const floor = cosineThreshold(
    thresholds,
    'shortUtteranceHistoricalMatch',
    SHORT_UTTERANCE_HISTORICAL_MATCH,
  )
  const probe = normalizeEmbeddingVector(vector)
  if (!probe.length) return null

  const preferred = new Set(
    [preferSpeaker, lastSpeaker, effectiveSticky]
      .map((label) => String(label || '').trim())
      .filter(Boolean),
  )

  let best = { label: null, similarity: -1, preferred: false }

  for (const cluster of speakerClusters) {
    const label = String(cluster?.label || '').trim()
    if (!label) continue
    const signatures = []
    if (Array.isArray(cluster.signature) && cluster.signature.length) {
      signatures.push(cluster.signature)
    }
    if (Array.isArray(cluster.signatureHistory)) {
      for (const entry of cluster.signatureHistory) {
        if (Array.isArray(entry) && entry.length) signatures.push(entry)
      }
    }
    for (const signature of signatures) {
      const similarity = compareCosineSignatures(probe, signature)
      if (similarity < floor) continue
      const isPreferred = preferred.has(label)
      if (
        similarity > best.similarity + 0.001 ||
        (Math.abs(similarity - best.similarity) <= 0.001 && isPreferred && !best.preferred)
      ) {
        best = { label, similarity, preferred: isPreferred }
      }
    }
  }

  if (!best.label || best.similarity < floor) return null
  return best
}

/**
 * Enunciado muy corto (<4 palabras): si coseno L2 con el locutor inmediato anterior ≥ 0.72,
 * conservar su ID (no abrir Hablante 5/7).
 */
export function resolveImmediateShortSpeakerContinuity({
  vector,
  utteranceText = '',
  lastSpeaker = '',
  lastSignature = null,
  thresholds = {},
} = {}) {
  const maxWords = Number(thresholds.shortUtteranceImmediateMaxWords)
  const wordCap = Number.isFinite(maxWords) && maxWords > 0 ? maxWords : 4
  const words = countUtteranceWords(utteranceText)
  if (words >= wordCap) return null

  const speaker = String(lastSpeaker || '').trim()
  if (!speaker) return null

  const floor = Math.max(
    cosineThreshold(
      thresholds,
      'shortUtteranceImmediateContinuity',
      SHORT_UTTERANCE_IMMEDIATE_CONTINUITY,
    ),
    resolveRoomRematchThreshold({ thresholds }),
  )
  const probe = normalizeEmbeddingVector(vector)
  if (!probe.length) return null

  if (Array.isArray(lastSignature) && lastSignature.length) {
    const similarity = compareCosineSignatures(probe, normalizeEmbeddingVector(lastSignature))
    if (similarity >= floor) {
      return { speaker, similarity, reason: 'room-immediate-short-continuity' }
    }
  }

  return null
}

/** Etiquetas de clusters con firma similar a la ancla (misma persona re-clusterizada). */
export function findLabelsWithSharedVoice(
  speakerClusters = [],
  anchorLabel = '',
  matchThreshold = 0.78,
) {
  const anchor = findClusterByLabel(speakerClusters, anchorLabel)
  if (!anchor?.signature?.length) {
    const label = String(anchorLabel || '').trim()
    return label ? [label] : []
  }
  const out = new Set([String(anchorLabel || '').trim()])
  for (const cluster of speakerClusters) {
    const label = String(cluster?.label || '').trim()
    if (!label || !cluster?.signature?.length) continue
    const similarity = compareCosineSignatures(anchor.signature, cluster.signature)
    if (similarity >= matchThreshold) out.add(label)
  }
  return [...out].filter(Boolean)
}

/** Filas del log cuya firma de cluster coincide con la voz del registro. */
export function findSpeakerLabelsMatchingSignature(
  speakerClusters = [],
  signatureVector = [],
  labels = [],
  matchThreshold = 0.78,
) {
  const vector = normalizeEmbeddingVector(signatureVector)
  if (!vector.length) return []
  const out = new Set()
  for (const label of labels) {
    const cluster = findClusterByLabel(speakerClusters, label)
    if (!cluster?.signature?.length) continue
    const similarity = compareCosineSignatures(vector, cluster.signature)
    if (similarity >= matchThreshold) out.add(String(label || '').trim())
  }
  return [...out].filter(Boolean)
}

/** Fusiona cluster origen en destino (registro / renombrar participante). */
export function mergeSpeakerClustersOnRename(speakerClusters = [], fromLabel = '', toLabel = '') {
  const from = String(fromLabel || '').trim()
  const to = String(toLabel || '').trim()
  if (!from || !to || foldSpeakerKey(from) === foldSpeakerKey(to)) {
    return speakerClusters
  }
  const source = findClusterByLabel(speakerClusters, from)
  const target = findClusterByLabel(speakerClusters, to)
  if (!source) return speakerClusters
  if (!target) {
    source.label = to
    return speakerClusters.filter(
      (cluster) => foldSpeakerKey(cluster?.label) !== foldSpeakerKey(from),
    )
  }
  updateClusterSignature(target, source.signature)
  return speakerClusters.filter(
    (cluster) => foldSpeakerKey(cluster?.label) !== foldSpeakerKey(from),
  )
}

/** ¿Timbre claramente distinto del sticky (otra persona en sala)? */
export function isVoiceDistinctFromSticky(
  vector,
  stickyLabel,
  speakerClusters,
  matchGate,
  newVoiceGate,
  { distinctFactor = 1 } = {},
) {
  const stickyCluster = findClusterByLabel(speakerClusters, stickyLabel)
  if (!stickyCluster?.signature?.length) return false
  const stickySimilarity = compareCosineSignatures(vector, stickyCluster.signature)
  const gate = newVoiceGate * distinctFactor
  if (stickySimilarity < gate) return true
  let bestOther = -1
  speakerClusters.forEach((cluster) => {
    if (!Array.isArray(cluster?.signature) || !cluster.signature.length) return
    if (foldSpeakerKey(cluster.label) === foldSpeakerKey(stickyLabel)) return
    const similarity = compareCosineSignatures(vector, cluster.signature)
    if (similarity > bestOther) bestOther = similarity
  })
  return bestOther >= matchGate && bestOther > stickySimilarity + 0.02
}
