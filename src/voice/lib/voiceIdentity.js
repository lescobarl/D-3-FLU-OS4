import {
  blendEmbeddingVectors,
  normalizeEmbeddingVector,
  normalizeSpaces,
  stripDiacritics,
} from './audioMath.js'
import { FLU_CONFIG } from './fluConfig.js'
import { getPassiveBufferMs } from './micCapture.js'

export function getVoiceIdentityConfig(config = FLU_CONFIG) {
  return config.voiceIdentity || FLU_CONFIG.voiceIdentity
}

function foldSpeakerKey(label = '') {
  return stripDiacritics(normalizeSpaces(label)).toLowerCase()
}

export function parseSpeakerIndex(label = '') {
  const match = String(label || '').match(/^Hablante\s+(\d+)$/i)
  return match ? Number(match[1]) : null
}

export function isAutoSpeakerLabel(label = '') {
  return /^Hablante\s+\d+$/i.test(String(label || '').trim())
}

/** Nombre propio registrado (no «Hablante N»). */
export function isRegisteredSpeakerLabel(label = '') {
  const text = String(label || '').trim()
  return Boolean(text) && !isAutoSpeakerLabel(text)
}

/** Corrige etiquetas corruptas «Hablante 1 / Hablante 2 / …» → un solo hablante. */
export function normalizeSpeakerLabel(label = '') {
  const text = normalizeSpaces(label)
  if (!text) return ''
  const lower = text.toLowerCase()
  if (lower === 'true' || lower === 'false' || lower === 'null' || lower === 'undefined') return ''
  if (!text.includes('/')) return text

  const parts = text
    .split('/')
    .map((part) => normalizeSpaces(part))
    .filter(Boolean)
  const hablantes = parts.filter((part) => isAutoSpeakerLabel(part))
  if (hablantes.length) return hablantes[hablantes.length - 1]
  return parts[parts.length - 1] || text
}

export function expandSessionSpeakerNames(label = '') {
  const text = normalizeSpaces(label)
  if (!text) return []
  if (!text.includes('/')) return [text]
  return text
    .split('/')
    .map((part) => normalizeSpaces(part))
    .filter(Boolean)
}

/** Primer índice libre (Hablante 1, 2, …) sin saltos por clusters fantasma. */
export function nextAvailableSpeakerLabel(clusters = [], extraLabels = [], { maxSpeakers = 0 } = {}) {
  const known = new Set()
  for (const cluster of clusters) {
    const label = String(cluster?.label || '').trim()
    if (label) known.add(foldSpeakerKey(label))
  }
  for (const label of extraLabels) {
    const cleaned = String(label || '').trim()
    if (cleaned) known.add(foldSpeakerKey(cleaned))
  }
  const limit = maxSpeakers > 0 ? maxSpeakers : 9999
  for (let index = 1; index <= limit; index += 1) {
    const candidate = `Hablante ${index}`
    if (!known.has(foldSpeakerKey(candidate))) return candidate
  }
  return `Hablante ${limit}`
}

/** Quita clusters Hablante N que nunca aparecieron en el log ni son activos. */
export function pruneGhostSpeakerClusters(
  clusters = [],
  committedLabels = [],
  { keepLabels = [] } = {},
) {
  const keep = new Set(
    [...committedLabels, ...keepLabels]
      .map((label) => foldSpeakerKey(label))
      .filter(Boolean),
  )
  return clusters.filter((cluster) => {
    const label = String(cluster?.label || '').trim()
    if (!label) return false
    if (!isAutoSpeakerLabel(label)) return true
    return keep.has(foldSpeakerKey(label))
  })
}

export function sortSessionSpeakers(speakers = []) {
  const numbered = []
  const custom = []
  for (const name of speakers) {
    const index = parseSpeakerIndex(name)
    if (index !== null) numbered.push({ name, index })
    else custom.push(name)
  }
  numbered.sort((a, b) => a.index - b.index)
  custom.sort((a, b) => String(a).localeCompare(String(b), 'es'))
  return [...numbered.map((entry) => entry.name), ...custom]
}

export function formatSpeakerLabel(label = '', confidence = 'medium', config = getVoiceIdentityConfig()) {
  const suffix = config.confidence?.display?.[confidence] ?? ''
  const normalized = normalizeSpeakerLabel(normalizeSpaces(label))
  if (!normalized) return config.labels?.fallbackSpeaker || 'Hablante 1'
  return suffix ? `${normalized} ${suffix}` : normalized
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

/**
 * Similitud coseno L2 explícita entre embeddings (512-D u otra dimensión).
 * dot / (sqrt(norm1) * sqrt(norm2)); norm2 acumula sig2[i]² (nunca sig1*sig2).
 */
export function compareAudioSignatures(sig1 = [], sig2 = []) {
  if (!Array.isArray(sig1) || !Array.isArray(sig2) || !sig1.length || !sig2.length) {
    return 0
  }
  const dim = Math.min(sig1.length, sig2.length)
  let dot = 0
  let norm1 = 0
  let norm2 = 0
  for (let i = 0; i < dim; i += 1) {
    const a = Number(sig1[i] || 0)
    const b = Number(sig2[i] || 0)
    dot += a * b
    norm1 += a * a
    norm2 += b * b
  }
  const denom = Math.sqrt(norm1) * Math.sqrt(norm2)
  if (!denom || !Number.isFinite(denom)) return 0
  const similarity = dot / denom
  if (!Number.isFinite(similarity)) return 0
  return Math.max(0, Math.min(1, similarity))
}

function cosineThreshold(thresholds = {}, key, fallback) {
  const value = Number(thresholds?.[key])
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : fallback
}

/** Re-identificación estricta: solo match si coseno L2-normalizado ≥ este valor. */
export const ROOM_REMATCH_STRICT = 0.85
export const SHORT_UTTERANCE_HISTORICAL_MATCH = 0.70
export const SHORT_UTTERANCE_IMMEDIATE_CONTINUITY = 0.72

/** Vectores 512-D: L2 obligatorio antes del producto punto (coseno). */
export function normalizeSignatureForCosine(vector = []) {
  return normalizeEmbeddingVector(vector)
}
const ROOM_REMATCH_FLOOR = ROOM_REMATCH_STRICT
const ROOM_REMATCH_CEILING = ROOM_REMATCH_STRICT

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
export function resolveRoomRematchThreshold({
  thresholds = {},
} = {}) {
  const configured = cosineThreshold(thresholds, 'roomRematchThreshold', ROOM_REMATCH_STRICT)
  return Math.max(ROOM_REMATCH_STRICT, configured)
}

/** Emparejamiento permitido solo si similitud ≥ umbral room-rematch. */
export function passesRoomRematchStrict(similarity, thresholds = {}) {
  const floor = resolveRoomRematchThreshold({ thresholds })
  return Number.isFinite(similarity) && similarity >= floor
}

/** Diarización solo con clusters de la sesión actual (sin perfiles guardados). */
export function matchSessionSpeaker(signatureVector, speakerClusters = [], thresholds = {}) {
  const vector = normalizeEmbeddingVector(signatureVector)
  const matchThreshold = cosineThreshold(thresholds, 'cosineMatchThreshold', 0.76)

  let clusterMatch = null
  let clusterSimilarity = -1

  speakerClusters.forEach((cluster) => {
    if (!Array.isArray(cluster?.signature)) return
    const similarity = compareAudioSignatures(vector, cluster.signature)
    if (similarity > clusterSimilarity) {
      clusterSimilarity = similarity
      clusterMatch = cluster
    }
  })

  if (clusterMatch && clusterSimilarity >= matchThreshold) {
    updateClusterSignature(clusterMatch, vector)
    return clusterMatch.label || 'Hablante 1'
  }

  const label = nextAvailableSpeakerLabel(speakerClusters)
  speakerClusters.push({ label, signature: [...vector], signatureHistory: [[...vector]] })
  return label
}

export function resolveSessionSpeaker({
  signatureVector,
  speakerClusters = [],
  lastSpeaker = '',
  lastSignature = null,
}) {
  const vector = Array.isArray(signatureVector) ? signatureVector : [0, 0, 0, 0]

  const continuityThreshold = cosineThreshold({}, 'cosineContinuityThreshold', 0.74)
  if (
    lastSpeaker &&
    Array.isArray(lastSignature) &&
    lastSignature.length &&
    compareAudioSignatures(vector, lastSignature) >= continuityThreshold
  ) {
    return lastSpeaker
  }

  return matchSessionSpeaker(vector, speakerClusters)
}

function nextSessionSpeakerLabel(speakerClusters = [], extraLabels = [], maxAutoSpeakers = 0) {
  return nextAvailableSpeakerLabel(speakerClusters, extraLabels, { maxSpeakers: maxAutoSpeakers })
}

function updateClusterSignature(cluster, vector) {
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

function findClusterByLabel(speakerClusters, label = '') {
  const normalized = String(label || '').trim()
  if (!normalized) return null
  const map = _buildClusterMap(speakerClusters)
  return map.get(normalized) || null
}

function ensureClusterForLabel(speakerClusters, label, vector) {
  const existing = findClusterByLabel(speakerClusters, label)
  if (existing) {
    updateClusterSignature(existing, vector)
    return existing
  }
  const cluster = { label, signature: [...vector], signatureHistory: [[...vector]] }
  speakerClusters.push(cluster)
  return cluster
}

function findNearestCluster(vector, speakerClusters = []) {
  let nearestCluster = null
  let nearestSimilarity = -1
  const probe = normalizeEmbeddingVector(vector)
  speakerClusters.forEach((cluster) => {
    if (!Array.isArray(cluster?.signature) || !cluster.signature.length) return
    const similarity = compareAudioSignatures(probe, cluster.signature)
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
      const similarity = compareAudioSignatures(probe, signature)
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
  const probe = normalizeSignatureForCosine(vector)
  if (!probe.length) return null

  if (Array.isArray(lastSignature) && lastSignature.length) {
    const similarity = compareAudioSignatures(probe, normalizeSignatureForCosine(lastSignature))
    if (similarity >= floor) {
      return { speaker, similarity, reason: 'room-immediate-short-continuity' }
    }
  }

  return null
}

/** Similitud turno-a-turno; ignora lastSignature si la dimensión no coincide con el embedding actual. */
function resolveLastTurnSimilarity(normalized, lastSpeaker, lastSignature, speakerClusters) {
  if (Array.isArray(lastSignature) && lastSignature.length) {
    const lastNorm = normalizeSignatureForCosine(lastSignature)
    if (lastNorm.length === normalized.length) {
      return compareAudioSignatures(normalized, lastNorm)
    }
  }
  if (!lastSpeaker) return 0
  const cluster = findClusterByLabel(speakerClusters, lastSpeaker)
  if (!Array.isArray(cluster?.signature) || !cluster.signature.length) return 0
  return compareAudioSignatures(normalized, normalizeSignatureForCosine(cluster.signature))
}

/** Nearest Neighbor en commit de sala: reutiliza clúster más cercano o abre uno nuevo. */
function resolveProductionSpeakerAtBoundary({
  vector,
  speakerClusters,
  thresholds,
  reservedLabels,
  maxAutoSpeakers,
  lastSpeaker = '',
  lastSignature = null,
  sessionPrimary = '',
  preferSpeaker = '',
  utteranceText = '',
  voicedSampleCount = 0,
  sampleRate = 48000,
  note,
}) {
  const normalized = normalizeSignatureForCosine(vector)
  const roomCfg = FLU_CONFIG.voiceIdentity?.capture?.roomCapture || {}
  const classroom = roomCfg.classroomMultiSpeaker === true
  const CONTINUITY = cosineThreshold(thresholds, 'cosineContinuityThreshold', 0.74)
  const NEW_VOICE = cosineThreshold(thresholds, 'cosineNewVoiceThreshold', 0.68)
  const REUSE = cosineThreshold(thresholds, 'productionClusterReuseThreshold', 0.74)
  const HISTORICAL = cosineThreshold(thresholds, 'shortUtteranceHistoricalMatch', 0.7)
  const REUSE_EFF = classroom ? REUSE - (Number(roomCfg.classroomReuseRelax) || 0.03) : REUSE
  const NEW_VOICE_EFF = classroom ? NEW_VOICE + (Number(roomCfg.classroomNewVoiceRelax) || 0.04) : NEW_VOICE
  const SWITCH = classroom
    ? Number(roomCfg.classroomLastSpeakerSwitchMargin) || 0.06
    : Number(roomCfg.lastSpeakerSwitchMargin) || 0.1
  const multiMin = classroom
    ? Number(roomCfg.classroomMultiSpeakerRoomClusterMin) || 2
    : Number(roomCfg.multiSpeakerRoomClusterMin) || 3
  const softCap = Number(roomCfg.maxAutoSpeakersSoftCap) || 0
  const hardCap = Number(roomCfg.maxAutoSpeakersInRoom) || 0
  const primaryLabel = normalizeSpeakerLabel(sessionPrimary)

  const autoCount = speakerClusters.filter(
    (c) => isAutoSpeakerLabel(c?.label) && Array.isArray(c?.signature) && c.signature.length,
  ).length
  const soloNewVoiceFactor = Number(roomCfg.soloNewVoiceFactor) || 0.82
  const soloSession = autoCount === 1
  const NEW_VOICE_OPEN = soloSession ? NEW_VOICE_EFF * soloNewVoiceFactor : NEW_VOICE_EFF

  const historical = findShortUtteranceHistoricalMatch({
    vector: normalized,
    speakerClusters,
    thresholds,
    utteranceText,
    voicedSampleCount,
    sampleRate,
    preferSpeaker: primaryLabel || preferSpeaker,
    lastSpeaker,
    effectiveSticky: primaryLabel || lastSpeaker,
  })
  if (historical?.label) {
    const cluster = findClusterByLabel(speakerClusters, historical.label)
    if (cluster) updateClusterSignature(cluster, normalized)
    note?.({
      reason: 'production-short-historical',
      speaker: historical.label,
      clusterSimilarity: historical.similarity,
    })
    return historical.label
  }

  const lastSim = resolveLastTurnSimilarity(normalized, lastSpeaker, lastSignature, speakerClusters)

  let bestLabel = ''
  let bestSim = -1
  for (const cluster of speakerClusters) {
    if (!Array.isArray(cluster?.signature) || !cluster.signature.length) continue
    const sim = compareAudioSignatures(normalized, normalizeSignatureForCosine(cluster.signature))
    if (sim > bestSim) {
      bestSim = sim
      bestLabel = String(cluster?.label || '').trim()
    }
  }

  if (primaryLabel) {
    const primaryCluster = findClusterByLabel(speakerClusters, primaryLabel)
    if (primaryCluster?.signature?.length) {
      const primarySim = compareAudioSignatures(
        normalized,
        normalizeSignatureForCosine(primaryCluster.signature),
      )
      if (
        primarySim >= REUSE_EFF &&
        primarySim >= bestSim - SWITCH &&
        (primarySim > lastSim + SWITCH || primaryLabel === lastSpeaker || !lastSpeaker)
      ) {
        const skipPrimaryRematch =
          classroom &&
          autoCount >= (Number(roomCfg.classroomPrimaryRematchMaxClusters) || 1) &&
          bestLabel &&
          bestLabel !== primaryLabel &&
          bestSim >= REUSE_EFF &&
          bestSim > primarySim + SWITCH * 0.5
        if (!skipPrimaryRematch) {
          const cluster = findClusterByLabel(speakerClusters, primaryLabel)
          if (cluster) updateClusterSignature(cluster, normalized)
          note?.({
            reason: 'production-primary-rematch',
            speaker: primaryLabel,
            clusterSimilarity: primarySim,
            lastSim,
            bestSim,
            bestLabel,
          })
          return primaryLabel
        }
      }
    }
  }

  // Fase E: si el participante primario (Juan/Luis) aún no tiene cluster (primer turno)
  // y la voz NO encaja fuertemente con un cluster auto existente ni con el último
  // hablante, crear su cluster y etiquetar el turno con su nombre. Config-gated
  // (roomCapture.sessionPrimaryCreateCluster) para no introducir regresiones.
  if (
    primaryLabel &&
    roomCfg.sessionPrimaryCreateCluster === true &&
    !findClusterByLabel(speakerClusters, primaryLabel)?.signature?.length
  ) {
    const strongAutoMatch = bestLabel && bestSim >= REUSE_EFF
    const strongLastMatch = lastSpeaker && lastSim >= REUSE_EFF
    if (!strongAutoMatch && !strongLastMatch) {
      speakerClusters.push({
        label: primaryLabel,
        signature: [...normalized],
        signatureHistory: [[...normalized]],
      })
      note?.({
        reason: 'production-primary-create-cluster',
        speaker: primaryLabel,
        lastSim,
        bestSim,
        bestLabel,
      })
      return primaryLabel
    }
  }

  if (
    primaryLabel &&
    lastSpeaker &&
    lastSpeaker !== primaryLabel &&
    isShortUtteranceContext({ utteranceText, voicedSampleCount, sampleRate, thresholds })
  ) {
    const primaryCluster = findClusterByLabel(speakerClusters, primaryLabel)
    if (primaryCluster?.signature?.length) {
      const primarySim = compareAudioSignatures(
        normalized,
        normalizeSignatureForCosine(primaryCluster.signature),
      )
      if (primarySim >= REUSE_EFF && primarySim >= bestSim - SWITCH && primarySim > lastSim) {
        const cluster = findClusterByLabel(speakerClusters, primaryLabel)
        if (cluster) updateClusterSignature(cluster, normalized)
        note?.({
          reason: 'production-short-primary',
          speaker: primaryLabel,
          clusterSimilarity: primarySim,
          lastSim,
          bestSim,
        })
        return primaryLabel
      }
    }
  }

  const atCap = hardCap > 0 && autoCount >= hardCap
  const nearCap = softCap > 0 && autoCount >= softCap

  const adoptCluster = (label, reason, sim) => {
    const cluster = findClusterByLabel(speakerClusters, label)
    if (cluster) updateClusterSignature(cluster, normalized)
    note?.({ reason, speaker: label, clusterSimilarity: sim, lastSim, bestSim, autoCount })
    return label
  }

  const anchorLastSpeaker = (reason) => {
    ensureClusterForLabel(speakerClusters, lastSpeaker, normalized)
    note?.({ reason, speaker: lastSpeaker, clusterSimilarity: lastSim, bestSim, bestLabel, autoCount })
    return lastSpeaker
  }

  const shortAfterOtherVoice =
    primaryLabel &&
    lastSpeaker &&
    lastSpeaker !== primaryLabel &&
    isShortUtteranceContext({ utteranceText, voicedSampleCount, sampleRate, thresholds })

  if (lastSpeaker && lastSim >= CONTINUITY && !shortAfterOtherVoice) {
    if (!bestLabel || bestLabel === lastSpeaker || bestSim < REUSE_EFF || bestSim - lastSim < SWITCH) {
      return anchorLastSpeaker('production-last-continuity')
    }
  }

  if (bestLabel && bestSim >= REUSE_EFF) {
    if (bestLabel === lastSpeaker || !lastSpeaker) {
      return adoptCluster(
        bestLabel,
        bestLabel === lastSpeaker ? 'production-cluster-match' : 'production-reidentify',
        bestSim,
      )
    }
    if (bestSim - lastSim >= SWITCH) {
      return adoptCluster(bestLabel, 'production-reidentify', bestSim)
    }
    const preferHistorical =
      roomCfg.preferHistoricalClusterInMultiSpeakerRoom !== false &&
      autoCount >= multiMin &&
      bestLabel &&
      bestLabel !== lastSpeaker &&
      bestSim >= REUSE_EFF &&
      bestSim > lastSim
    if (preferHistorical && bestSim - lastSim >= SWITCH * 0.45) {
      return adoptCluster(bestLabel, 'production-historical-reidentify', bestSim)
    }
    if (lastSpeaker && lastSim >= NEW_VOICE_EFF && !shortAfterOtherVoice) {
      if (
        classroom &&
        bestLabel &&
        bestLabel !== lastSpeaker &&
        bestSim >= REUSE_EFF &&
        bestSim - lastSim >= SWITCH
      ) {
        return adoptCluster(bestLabel, 'production-classroom-switch', bestSim)
      }
      return anchorLastSpeaker('production-last-speaker-anchored')
    }
    return adoptCluster(bestLabel, 'production-reidentify-marginal', bestSim)
  }

  if (shortAfterOtherVoice && primaryLabel) {
    const primaryCluster = findClusterByLabel(speakerClusters, primaryLabel)
    if (primaryCluster?.signature?.length) {
      const primarySim = compareAudioSignatures(
        normalized,
        normalizeSignatureForCosine(primaryCluster.signature),
      )
      if (primarySim >= REUSE_EFF && primarySim >= bestSim - SWITCH && primarySim > lastSim) {
        return adoptCluster(primaryLabel, 'production-short-primary-fallback', primarySim)
      }
    }
  }

  if (lastSpeaker && lastSim < NEW_VOICE_OPEN && bestSim < NEW_VOICE_OPEN) {
    const label = nextSessionSpeakerLabel(speakerClusters, reservedLabels, maxAutoSpeakers || hardCap || 0)
    speakerClusters.push({
      label,
      signature: [...normalized],
      signatureHistory: [[...normalized]],
    })
    note?.({
      reason: 'production-forced-new-voice',
      speaker: label,
      lastSim,
      bestSim,
      autoCount,
    })
    return label
  }

  if (lastSpeaker && lastSim >= CONTINUITY) {
    return anchorLastSpeaker('production-last-continuity-late')
  }

  if (lastSpeaker && bestLabel === lastSpeaker && bestSim >= REUSE_EFF) {
    return adoptCluster(lastSpeaker, 'production-cluster-continuity', bestSim)
  }

  if (bestLabel && bestLabel !== lastSpeaker && bestSim >= NEW_VOICE_EFF) {
    if (lastSpeaker && lastSim >= NEW_VOICE_EFF && bestSim - lastSim < SWITCH) {
      return anchorLastSpeaker('production-last-speaker-blocks-other')
    }
    return adoptCluster(bestLabel, 'production-known-other', bestSim)
  }

  if ((atCap || nearCap) && bestLabel && bestSim >= HISTORICAL) {
    return adoptCluster(bestLabel, 'production-cap-reidentify', bestSim)
  }

  if (lastSpeaker && lastSim >= NEW_VOICE_EFF && lastSim < CONTINUITY) {
    if (bestLabel === lastSpeaker && bestSim >= REUSE_EFF) {
      return adoptCluster(lastSpeaker, 'production-grey-zone-cluster-agreement', Math.max(lastSim, bestSim))
    }
    if (!soloSession && bestSim < REUSE_EFF && lastSim < REUSE_EFF) {
      const label = nextSessionSpeakerLabel(speakerClusters, reservedLabels, maxAutoSpeakers || hardCap || 0)
      speakerClusters.push({
        label,
        signature: [...normalized],
        signatureHistory: [[...normalized]],
      })
      note?.({
        reason: 'production-forced-new-voice-grey-zone',
        speaker: label,
        lastSim,
        bestSim,
        autoCount,
      })
      return label
    }
    if (!soloSession && bestSim < NEW_VOICE_EFF) {
      const label = nextSessionSpeakerLabel(speakerClusters, reservedLabels, maxAutoSpeakers || hardCap || 0)
      speakerClusters.push({
        label,
        signature: [...normalized],
        signatureHistory: [[...normalized]],
      })
      note?.({
        reason: 'production-forced-new-voice-grey-zone',
        speaker: label,
        lastSim,
        bestSim,
        autoCount,
      })
      return label
    }
  }

  if (atCap && bestLabel) {
    return adoptCluster(bestLabel, 'production-cap-nearest', bestSim)
  }

  if (!speakerClusters.some((c) => Array.isArray(c?.signature) && c.signature.length)) {
    const label = 'Hablante 1'
    speakerClusters.push({
      label,
      signature: [...normalized],
      signatureHistory: [[...normalized]],
    })
    note?.({ reason: 'production-first-cluster', speaker: label })
    return label
  }

  if (soloSession) {
    if (lastSpeaker) return anchorLastSpeaker('production-solo-coalesce')
    if (bestLabel) return adoptCluster(bestLabel, 'production-solo-coalesce', bestSim)
  }

  const label = nextSessionSpeakerLabel(speakerClusters, reservedLabels, maxAutoSpeakers || hardCap || 0)
  speakerClusters.push({
    label,
    signature: [...normalized],
    signatureHistory: [[...normalized]],
  })
  note?.({ reason: 'production-new-voice', speaker: label, lastSim, bestSim, autoCount })
  return label
}

function resolveRoomNearestNeighbor({
  vector,
  speakerClusters,
  thresholds,
  reservedLabels,
  maxAutoSpeakers,
  effectiveSticky,
  utteranceText = '',
  voicedSampleCount = 0,
  sampleRate = 48000,
  preferSpeaker = '',
  lastSpeaker = '',
  lastSignature = null,
  note,
}) {
  if (!speakerClusters.some((cluster) => Array.isArray(cluster?.signature) && cluster.signature.length)) {
    const label = 'Hablante 1'
    const normalized = normalizeSignatureForCosine(vector)
    speakerClusters.push({ label, signature: [...normalized], signatureHistory: [[...normalized]] })
    note({ reason: 'room-first-cluster', speaker: label })
    return label
  }

  const requiredForRematch = resolveRoomRematchThreshold({ thresholds })
  const normalized = normalizeSignatureForCosine(vector)
  const { nearestCluster, nearestSimilarity } = findNearestCluster(normalized, speakerClusters)
  const strictCosine =
    FLU_CONFIG.voiceIdentity?.capture?.roomCapture?.strictCosineDiarization !== false

  const immediate = strictCosine
    ? null
    : resolveImmediateShortSpeakerContinuity({
      vector: normalized,
      utteranceText,
      lastSpeaker,
      lastSignature,
      thresholds,
    })
  if (immediate?.speaker) {
    const cluster = findClusterByLabel(speakerClusters, immediate.speaker)
    if (cluster) {
      updateClusterSignature(cluster, normalized)
      note({
        reason: immediate.reason,
        speaker: immediate.speaker,
        clusterSimilarity: immediate.similarity,
        cosineThreshold: cosineThreshold(
          thresholds,
          'shortUtteranceImmediateContinuity',
          SHORT_UTTERANCE_IMMEDIATE_CONTINUITY,
        ),
        embeddingDim: normalized.length,
      })
      return immediate.speaker
    }
    ensureClusterForLabel(speakerClusters, immediate.speaker, normalized)
    note({
      reason: immediate.reason,
      speaker: immediate.speaker,
      clusterSimilarity: immediate.similarity,
      embeddingDim: normalized.length,
    })
    return immediate.speaker
  }

  if (nearestCluster && nearestSimilarity >= requiredForRematch) {
    updateClusterSignature(nearestCluster, normalized)
    const label = nearestCluster.label || effectiveSticky
    note({
      reason: 'room-nn-rematch',
      speaker: label,
      clusterSimilarity: nearestSimilarity,
      cosineThreshold: requiredForRematch,
      embeddingDim: normalized.length,
    })
    return label
  }

  const historical = findShortUtteranceHistoricalMatch({
    vector: normalized,
    speakerClusters,
    thresholds,
    utteranceText,
    voicedSampleCount,
    sampleRate,
    preferSpeaker,
    lastSpeaker,
    effectiveSticky,
    sameCaptureSource: true,
  })
  if (historical?.label) {
    const cluster = findClusterByLabel(speakerClusters, historical.label)
    if (cluster) {
      updateClusterSignature(cluster, normalized)
      note({
        reason: 'room-short-historical-unify',
        speaker: historical.label,
        clusterSimilarity: historical.similarity,
        cosineThreshold: cosineThreshold(
          thresholds,
          'shortUtteranceHistoricalMatch',
          SHORT_UTTERANCE_HISTORICAL_MATCH,
        ),
        embeddingDim: normalized.length,
      })
      return historical.label
    }
  }

  const label = nextSessionSpeakerLabel(speakerClusters, reservedLabels, maxAutoSpeakers)
  speakerClusters.push({
    label,
    signature: [...normalized],
    signatureHistory: [[...normalized]],
  })
  note({
    reason: 'room-nn-new-person',
    speaker: label,
    clusterSimilarity: nearestSimilarity,
    cosineThreshold: requiredForRematch,
    embeddingDim: normalized.length,
  })
  return label
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
    const similarity = compareAudioSignatures(anchor.signature, cluster.signature)
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
    const similarity = compareAudioSignatures(vector, cluster.signature)
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
function isVoiceDistinctFromSticky(
  vector,
  stickyLabel,
  speakerClusters,
  matchGate,
  newVoiceGate,
  { distinctFactor = 1 } = {},
) {
  const stickyCluster = findClusterByLabel(speakerClusters, stickyLabel)
  if (!stickyCluster?.signature?.length) return false
  const stickySimilarity = compareAudioSignatures(vector, stickyCluster.signature)
  const gate = newVoiceGate * distinctFactor
  if (stickySimilarity < gate) return true
  let bestOther = -1
  speakerClusters.forEach((cluster) => {
    if (!Array.isArray(cluster?.signature) || !cluster.signature.length) return
    if (foldSpeakerKey(cluster.label) === foldSpeakerKey(stickyLabel)) return
    const similarity = compareAudioSignatures(vector, cluster.signature)
    if (similarity > bestOther) bestOther = similarity
  })
  return bestOther >= matchGate && bestOther > stickySimilarity + 0.02
}

/**
 * Diarización en conversación: prioriza el hablante actual; solo crea otro con voz muy distinta.
 */
export function resolveConversationSpeaker({
  signatureVector,
  speakerClusters = [],
  lastSpeaker = '',
  lastSignature = null,
  voicedSampleCount = 0,
  minVoicedSamples = 12000,
  minVoicedSamplesForNew = 24000,
  preferSpeaker = '',
  thresholds = {},
  utteranceText = '',
  sampleRate = 48000,
  maxAutoSpeakers = 0,
  atTurnBoundary = false,
  allowNewCluster = true,
  reservedLabels = [],
  sessionPrimary = '',
  diagnosis = null,
} = {}) {
  const note = (patch) => {
    if (diagnosis && typeof diagnosis === 'object') Object.assign(diagnosis, patch)
  }
  const vector = normalizeSignatureForCosine(signatureVector)
  const roomCfg = FLU_CONFIG.voiceIdentity?.capture?.roomCapture || {}
  const pinRegistered = roomCfg.pinRegisteredSpeaker !== false
  const soloSticky = roomCfg.soloSpeakerSticky === true
  const strictCosine = roomCfg.strictCosineDiarization !== false
  const boundaryAllowsNew = roomCfg.turnBoundaryAllowNewCluster === true
  const allowNew = allowNewCluster && (!atTurnBoundary || boundaryAllowsNew)
  const preferIsRegistered = pinRegistered && isRegisteredSpeakerLabel(preferSpeaker)
  const boundaryRelax = Number(roomCfg.turnBoundaryMatchRelax) || 2.35
  const reabsorbMargin = Number(roomCfg.turnBoundaryClusterReabsorbMargin) || 0.035
  const autoClusterCount = speakerClusters.filter(
    (cluster) =>
      isAutoSpeakerLabel(cluster?.label) &&
      Array.isArray(cluster?.signature) &&
      cluster.signature.length,
  ).length
  const boundaryRelaxEffective =
    atTurnBoundary && autoClusterCount >= 2
      ? Number(roomCfg.turnBoundaryMatchRelaxMulti) || 1.12
      : boundaryRelax
  const sticky = atTurnBoundary
    ? preferIsRegistered || soloSticky
      ? lastSpeaker || preferSpeaker
      : ''
    : preferSpeaker || lastSpeaker || 'Hablante 1'
  const effectiveSticky = sticky || lastSpeaker || preferSpeaker || 'Hablante 1'
  const MATCH = cosineThreshold(thresholds, 'cosineMatchThreshold', 0.76)
  const ROOM_REMATCH = resolveRoomRematchThreshold({
    thresholds,
    utteranceText,
    voicedSampleCount,
    sampleRate,
    clusterCount: autoClusterCount,
  })
  const shortUtterance = isShortUtteranceContext({
    utteranceText,
    voicedSampleCount,
    sampleRate,
    thresholds,
  })
  const REGISTERED_MATCH = cosineThreshold(thresholds, 'cosineRegisteredMatchThreshold', 0.72)
  const CONTINUITY = cosineThreshold(thresholds, 'cosineContinuityThreshold', 0.74)
  const NEW_VOICE = cosineThreshold(thresholds, 'cosineNewVoiceThreshold', 0.68)

  if (!voicedSampleCount || voicedSampleCount < minVoicedSamples) {
    note({ reason: 'insufficient-voiced', voicedSampleCount, minVoicedSamples, speaker: effectiveSticky })
    return effectiveSticky
  }

  if (preferIsRegistered && pinRegistered && preferSpeaker) {
    const pinnedCluster = findClusterByLabel(speakerClusters, preferSpeaker)
    if (pinnedCluster?.signature?.length) {
      const pinnedSimilarity = compareAudioSignatures(vector, pinnedCluster.signature)
      if (pinnedSimilarity >= REGISTERED_MATCH) {
        updateClusterSignature(pinnedCluster, vector)
        note({ reason: 'registered-pinned-rematch', speaker: preferSpeaker, clusterSimilarity: pinnedSimilarity })
        return preferSpeaker
      }
    }
    ensureClusterForLabel(speakerClusters, preferSpeaker, vector)
    note({ reason: 'registered-pinned-cluster', speaker: preferSpeaker })
    return preferSpeaker
  }

  if ((strictCosine || !soloSticky) && atTurnBoundary && vector.length) {
    return resolveProductionSpeakerAtBoundary({
      vector,
      speakerClusters,
      thresholds,
      reservedLabels,
      maxAutoSpeakers,
      lastSpeaker,
      lastSignature,
      sessionPrimary: normalizeSpeakerLabel(sessionPrimary) || '',
      preferSpeaker,
      utteranceText,
      voicedSampleCount,
      sampleRate,
      note,
    })
  }

  let clusterMatch = null
  let clusterSimilarity = -1

  speakerClusters.forEach((cluster) => {
    if (!Array.isArray(cluster?.signature) || !cluster.signature.length) return
    const similarity = compareAudioSignatures(vector, cluster.signature)
    if (similarity > clusterSimilarity) {
      clusterSimilarity = similarity
      clusterMatch = cluster
    }
  })
  const continuityGate = atTurnBoundary ? CONTINUITY * 0.82 : CONTINUITY
  let newVoiceGate = atTurnBoundary
    ? NEW_VOICE * (thresholds.turnBoundaryNewVoiceFactor ?? 0.88)
    : NEW_VOICE
  if (atTurnBoundary && autoClusterCount >= 1) {
    newVoiceGate *= Number(roomCfg.turnBoundaryNewVoiceMultiFactor) || 0.72
  }
  const minVoicedForNew = atTurnBoundary
    ? Math.floor(minVoicedSamplesForNew * (thresholds.turnBoundaryVoicedFactor ?? 0.55))
    : minVoicedSamplesForNew
  const boundaryDistinctFactor = Number(roomCfg.turnBoundaryDistinctFactor) || 1.18
  const distinctFromSticky =
    soloSticky &&
    isVoiceDistinctFromSticky(vector, effectiveSticky, speakerClusters, MATCH, newVoiceGate, {
      distinctFactor: atTurnBoundary ? boundaryDistinctFactor : 1,
    })
  const lastTurnSimilarity =
    Array.isArray(lastSignature) && lastSignature.length
      ? compareAudioSignatures(vector, lastSignature)
      : 0
  const lastTurnFactor = Number(roomCfg.turnBoundaryLastTurnFactor) || 0.48
  const distinctFromLastTurn =
    atTurnBoundary &&
    soloSticky &&
    autoClusterCount >= 1 &&
    lastTurnSimilarity < NEW_VOICE * lastTurnFactor
  /** Solo timbre vs sticky; el drift turno-a-turno no abre H5/H6 en la misma persona. */
  const voiceDistinct = distinctFromSticky
  note({
    preferSpeaker,
    effectiveSticky,
    lastSpeaker,
    atTurnBoundary,
    allowNewCluster,
    distinctFromSticky,
    distinctFromLastTurn,
    voiceDistinct,
    lastTurnSimilarity,
    boundaryRelaxEffective,
    autoClusterCount,
    embeddingDim: vector.length,
    shortUtterance,
    roomRematchThreshold: ROOM_REMATCH,
  })

  /**
   * Commit de turno en sala: NN único (sin gates legacy).
   * Commit de sala: NN por similitud coseno entre embeddings ECAPA.
   */
  if (soloSticky && atTurnBoundary) {
    if (preferIsRegistered) {
      const pinnedCluster = findClusterByLabel(speakerClusters, preferSpeaker)
      if (pinnedCluster?.signature?.length) {
        const pinnedSimilarity = compareAudioSignatures(vector, pinnedCluster.signature)
        if (pinnedSimilarity >= REGISTERED_MATCH) {
          updateClusterSignature(pinnedCluster, vector)
          note({ reason: 'room-pinned-rematch', speaker: preferSpeaker, clusterSimilarity: pinnedSimilarity })
          return preferSpeaker
        }
      }
      ensureClusterForLabel(speakerClusters, preferSpeaker, vector)
      note({ reason: 'room-pinned-cluster', speaker: preferSpeaker })
      return preferSpeaker
    }

    const strictRematch = resolveRoomRematchThreshold({ thresholds })
    if (
      lastSpeaker &&
      Array.isArray(lastSignature) &&
      lastSignature.length &&
      compareAudioSignatures(vector, lastSignature) >= strictRematch
    ) {
      ensureClusterForLabel(speakerClusters, lastSpeaker, vector)
      note({
        reason: 'room-last-turn-rematch',
        speaker: lastSpeaker,
        clusterSimilarity: compareAudioSignatures(vector, lastSignature),
        cosineThreshold: strictRematch,
      })
      return lastSpeaker
    }

    return resolveRoomNearestNeighbor({
      vector,
      speakerClusters,
      thresholds,
      reservedLabels,
      maxAutoSpeakers,
      effectiveSticky,
      utteranceText,
      voicedSampleCount,
      sampleRate,
      preferSpeaker,
      lastSpeaker,
      lastSignature,
      note,
    })
  }

  const allowNewDespiteBoundary =
    allowNewCluster || (soloSticky && atTurnBoundary && voiceDistinct)

  if (preferIsRegistered) {
    const pinnedCluster = findClusterByLabel(speakerClusters, preferSpeaker)
    if (pinnedCluster?.signature?.length) {
      const pinnedSimilarity = compareAudioSignatures(vector, pinnedCluster.signature)
      if (pinnedSimilarity >= REGISTERED_MATCH) {
        updateClusterSignature(pinnedCluster, vector)
        return preferSpeaker
      }
    }
  }

  const clusterMatchThreshold = atTurnBoundary && soloSticky ? ROOM_REMATCH : MATCH
  if (clusterMatch && clusterSimilarity >= clusterMatchThreshold) {
    const matched = clusterMatch.label || effectiveSticky
    const stickyClusterForCompare = findClusterByLabel(speakerClusters, effectiveSticky)
    const stickySimilarityForCompare = stickyClusterForCompare?.signature?.length
      ? compareAudioSignatures(vector, stickyClusterForCompare.signature)
      : 0
    const rejectReabsorb =
      atTurnBoundary &&
      soloSticky &&
      voiceDistinct &&
      isAutoSpeakerLabel(matched) &&
      foldSpeakerKey(matched) === foldSpeakerKey(effectiveSticky) &&
      (distinctFromSticky ||
        clusterSimilarity - reabsorbMargin <= stickySimilarityForCompare)
    if (rejectReabsorb) {
      clusterMatch = null
      clusterSimilarity = -1
      note({
        reason: distinctFromLastTurn ? 'reject-reabsorb-last-turn' : 'reject-weak-old-cluster',
        matched,
        clusterSimilarity,
        stickySimilarityForCompare,
      })
    } else {
      updateClusterSignature(clusterMatch, vector)
    }
    if (clusterMatch && clusterSimilarity >= clusterMatchThreshold) {
      if (allowNew || allowNewDespiteBoundary) {
        if (
          atTurnBoundary &&
          soloSticky &&
          !voiceDistinct &&
          matched !== effectiveSticky &&
          isAutoSpeakerLabel(matched) &&
          isAutoSpeakerLabel(effectiveSticky)
        ) {
          const stickyCluster = findClusterByLabel(speakerClusters, effectiveSticky)
          const stickySimilarity = stickyCluster
            ? compareAudioSignatures(vector, stickyCluster.signature)
            : 0
          const relaxedMatch = MATCH / Math.max(1, boundaryRelaxEffective)
          if (stickySimilarity >= relaxedMatch) {
            updateClusterSignature(stickyCluster, vector)
            note({ reason: 'boundary-keep-sticky-over-match', speaker: effectiveSticky })
            return effectiveSticky
          }
        }
        note({ reason: 'cluster-match', speaker: matched, clusterSimilarity })
        return matched
      }
      if (foldSpeakerKey(matched) === foldSpeakerKey(effectiveSticky)) {
        return effectiveSticky
      }
      const stickyCluster = findClusterByLabel(speakerClusters, effectiveSticky)
      if (stickyCluster) {
        updateClusterSignature(stickyCluster, vector)
      }
      return effectiveSticky
    }
  }

  if (
    !atTurnBoundary &&
    clusterMatch &&
    clusterMatch.label &&
    clusterMatch.label !== effectiveSticky
  ) {
    const stickyCluster = findClusterByLabel(speakerClusters, effectiveSticky)
    const stickySimilarity = stickyCluster
      ? compareAudioSignatures(vector, stickyCluster.signature)
      : 0
    if (clusterSimilarity > stickySimilarity + 0.025) {
      updateClusterSignature(clusterMatch, vector)
      return clusterMatch.label
    }
  }

  if (!atTurnBoundary) {
    const stickyCluster = findClusterByLabel(speakerClusters, effectiveSticky)
    if (stickyCluster && Array.isArray(stickyCluster.signature) && stickyCluster.signature.length) {
      const stickySimilarity = compareAudioSignatures(vector, stickyCluster.signature)
      if (stickySimilarity >= MATCH * 0.92) {
        updateClusterSignature(stickyCluster, vector)
        return effectiveSticky
      }
    }
  }

  if (lastSpeaker && lastSpeaker !== effectiveSticky && !atTurnBoundary) {
    const lastCluster = findClusterByLabel(speakerClusters, lastSpeaker)
    if (lastCluster && Array.isArray(lastCluster.signature) && lastCluster.signature.length) {
      const lastClusterSimilarity = compareAudioSignatures(vector, lastCluster.signature)
      if (lastClusterSimilarity >= MATCH * 0.95) {
        updateClusterSignature(lastCluster, vector)
        return lastSpeaker
      }
    }
  }

  const lastSimilarity =
    lastSpeaker && Array.isArray(lastSignature) && lastSignature.length
      ? compareAudioSignatures(vector, lastSignature)
      : 0

  if (lastSpeaker && lastSimilarity >= continuityGate && !atTurnBoundary) {
    if (allowNew) {
      ensureClusterForLabel(speakerClusters, lastSpeaker, vector)
    }
    return lastSpeaker
  }

  const autoSpeakerCountEarly = speakerClusters.filter((cluster) =>
    isAutoSpeakerLabel(cluster?.label),
  ).length
  const maxAutoInRoom = Number(roomCfg.maxAutoSpeakersInRoom) || 0
  if (
    maxAutoInRoom > 0 &&
    autoSpeakerCountEarly >= maxAutoInRoom &&
    !voiceDistinct
  ) {
    const stickyCluster = findClusterByLabel(speakerClusters, effectiveSticky)
    if (stickyCluster?.signature?.length) {
      updateClusterSignature(stickyCluster, vector)
      return effectiveSticky
    }
    if (clusterMatch) {
      updateClusterSignature(clusterMatch, vector)
      return clusterMatch.label || effectiveSticky
    }
    return effectiveSticky
  }

  if (!speakerClusters.some((cluster) => Array.isArray(cluster?.signature) && cluster.signature.length)) {
    // Si el hablante preferido es un participante registrado (por nombre),
    // creamos/anudamos el cluster a esa ID para no forzar `Hablante 1` al inicio.
    const label = preferIsRegistered ? effectiveSticky : 'Hablante 1'
    speakerClusters.push({ label, signature: [...vector], signatureHistory: [[...vector]] })
    return label
  }

  const autoSpeakerCount = speakerClusters.filter((cluster) =>
    isAutoSpeakerLabel(cluster?.label),
  ).length

  const softCap = Number(roomCfg.maxAutoSpeakersSoftCap) || 0
  let strictNewVoice =
    maxAutoSpeakers > 0 && autoSpeakerCount >= maxAutoSpeakers ? newVoiceGate * 0.88 : newVoiceGate
  if (roomCfg.stickySpeaker && softCap > 0 && autoSpeakerCount >= softCap) {
    strictNewVoice *= 0.82
  }
  const canCreateNewSpeaker =
    voicedSampleCount >= minVoicedForNew &&
    clusterSimilarity < strictNewVoice &&
    (distinctFromSticky || lastSimilarity < strictNewVoice)

  if (preferIsRegistered && canCreateNewSpeaker) {
    const pinnedCluster = findClusterByLabel(speakerClusters, preferSpeaker)
    if (pinnedCluster?.signature?.length) {
      const pinnedSimilarity = compareAudioSignatures(vector, pinnedCluster.signature)
      if (pinnedSimilarity >= REGISTERED_MATCH) {
        updateClusterSignature(pinnedCluster, vector)
        return preferSpeaker
      }
    }
  }

  if (canCreateNewSpeaker) {
    if (!allowNew && !allowNewDespiteBoundary) {
      return effectiveSticky
    }
    const label = nextSessionSpeakerLabel(speakerClusters, reservedLabels, maxAutoSpeakers)
    speakerClusters.push({ label, signature: [...vector], signatureHistory: [[...vector]] })
    note({ reason: 'new-cluster', speaker: label, clusterSimilarity, lastSimilarity })
    return label
  }

  if (clusterMatch) {
    updateClusterSignature(clusterMatch, vector)
    const matched = clusterMatch.label || effectiveSticky
    if (allowNew || allowNewDespiteBoundary || foldSpeakerKey(matched) === foldSpeakerKey(effectiveSticky)) {
      return matched
    }
    const stickyCluster = findClusterByLabel(speakerClusters, effectiveSticky)
    if (stickyCluster) {
      updateClusterSignature(stickyCluster, vector)
    }
    return effectiveSticky
  }

  if (allowNew || allowNewDespiteBoundary) {
    ensureClusterForLabel(speakerClusters, effectiveSticky, vector)
  }
  return effectiveSticky
}
