/**
 * Núcleo puro de diarización por embedding (512-D WavLM-SV).
 *
 * Única fuente de verdad de: normalización L2, similitud coseno, id de hablante
 * y asignación estricta por coseno. Sin store/React (importable en Web Worker y
 * en hilo principal). Los textos configurables («Hablante N») viven en FLU_CONFIG.
 */
import { FLU_CONFIG } from './fluConfig.js'
import { stripDiacriticsLower } from '../../lib/textUtils';

/** Etiqueta de hablante por defecto (config-driven; nunca un literal fuera de config). */
export function getFallbackSpeaker(config = FLU_CONFIG) {
  const label = config?.voiceIdentity?.labels?.fallbackSpeaker
  return String(label || '').trim() || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
}

/** Umbral del bloque conversationSpeakerThresholds (config-driven; sin literal quemado). */
function thresholdFromConfig(key, fallback, config = FLU_CONFIG) {
  const t = config?.voiceIdentity?.capture?.conversationSpeakerThresholds || {}
  const v = Number(t[key])
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : fallback
}

/** Factor de roomCapture (config-driven; sin literal quemado). */
function roomFactorFromConfig(key, fallback, config = FLU_CONFIG) {
  const v = Number(config?.voiceIdentity?.capture?.roomCapture?.[key])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/** Etiqueta automática «Hablante N» desde la plantilla de config. */
export function autoSpeakerLabel(index = 1, config = FLU_CONFIG) {
  const template =
    config?.voiceIdentity?.labels?.template || FLU_CONFIG.voiceIdentity.labels.template
  return String(template).replace(/\{n\}/g, String(index))
}

/** Normalización L2 (única): vector de magnitud 1. */
export function normalizeEmbeddingVector(vector = []) {
  if (!Array.isArray(vector) || !vector.length) return []
  const out = vector.map((value) => Number(value || 0))
  let norm = 0
  for (let index = 0; index < out.length; index += 1) {
    norm += out[index] * out[index]
  }
  norm = Math.sqrt(norm) || 1
  return out.map((value) => value / norm)
}

/** Similitud coseno pura [0, 1] entre embeddings; 1 = misma identidad de voz. */
export function compareCosineSignatures(sig1 = [], sig2 = []) {
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

/** Id estable a partir de la etiqueta de hablante («Hablante 3» → speaker_3). */
export function labelToSpeakerIdSimple(label = '') {
  const text = String(label || '').trim()
  const match = text.match(/^Hablante\s+(\d+)$/i)
  if (match) return `speaker_${match[1]}`
  const slug = stripDiacriticsLower(text)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug ? `speaker_name_${slug}` : 'speaker_1'
}

/** Siguiente etiqueta automática libre (sin colisión con clusters ni reservadas). */
export function nextAutoSpeakerLabel(clusters = [], reserved = [], config = FLU_CONFIG) {
  const known = new Set()
  for (const cluster of clusters) {
    const label = String(cluster?.label || '').trim()
    if (label) known.add(label.toLowerCase())
  }
  for (const label of reserved) {
    const cleaned = String(label || '').trim()
    if (cleaned) known.add(cleaned.toLowerCase())
  }
  for (let index = 1; index <= 32; index += 1) {
    const candidate = autoSpeakerLabel(index, config)
    if (!known.has(candidate.toLowerCase())) return candidate
  }
  return autoSpeakerLabel(clusters.length + 1, config)
}

function clusterBestSimilarity(normalized, clusters = []) {
  let bestLabel = ''
  let bestSim = -1
  for (const cluster of clusters) {
    const sig = cluster?.signature
    if (!Array.isArray(sig) || !sig.length) continue
    const sim = compareCosineSignatures(normalized, normalizeEmbeddingVector(sig))
    if (sim > bestSim) {
      bestSim = sim
      bestLabel = String(cluster?.label || '').trim()
    }
    if (Array.isArray(cluster?.signatureHistory)) {
      for (const entry of cluster.signatureHistory) {
        if (!Array.isArray(entry) || !entry.length) continue
        const histSim = compareCosineSignatures(normalized, normalizeEmbeddingVector(entry))
        if (histSim > bestSim) {
          bestSim = histSim
          bestLabel = String(cluster?.label || '').trim()
        }
      }
    }
  }
  return { bestLabel, bestSim }
}

/**
 * Asignación estricta por coseno L2 (512-D): compartida entre Worker y pruebas.
 * Voces por debajo del umbral de cluster → nuevo Hablante N; sin grey-zone perezoso.
 * @returns {{ speakerName: string, speakerId: string, similarity: number, reason: string }}
 */
export function assignSpeaker(
  rawVector,
  {
    clusters = [],
    matchThreshold,
    reservedLabels = [],
    preferLabel = '',
    lastSpeaker = '',
    lastSignature = null,
    continuityThreshold,
    newVoiceThreshold,
    matchThresholdCluster,
    soloNewVoiceFactor,
    config = FLU_CONFIG,
  } = {},
) {
  const normalized = normalizeEmbeddingVector(rawVector)
  if (!normalized.length) {
    const fallback =
      String(lastSpeaker || getFallbackSpeaker(config)).trim() || getFallbackSpeaker(config)
    return {
      speakerName: fallback,
      speakerId: labelToSpeakerIdSimple(fallback),
      similarity: 0,
      reason: 'empty-vector',
    }
  }

  const floor = Number(matchThreshold) > 0 && Number(matchThreshold) <= 1
    ? Number(matchThreshold)
    : thresholdFromConfig('cosineMatchThreshold', 0.85, config)
  const continuity = Number(continuityThreshold) > 0
    ? Number(continuityThreshold)
    : thresholdFromConfig('cosineContinuityThreshold', 0.74, config)
  const newVoice = Number(newVoiceThreshold) > 0
    ? Number(newVoiceThreshold)
    : thresholdFromConfig('cosineNewVoiceThreshold', 0.68, config)
  const clusterMatch = Number(matchThresholdCluster) > 0
    ? Number(matchThresholdCluster)
    : thresholdFromConfig('productionClusterReuseThreshold', 0.76, config)
  const autoClusters = clusters.filter(
    (c) =>
      /^Hablante\s+\d+$/i.test(String(c?.label || '').trim()) &&
      Array.isArray(c?.signature) &&
      c.signature.length,
  )
  const soloSession = autoClusters.length === 1
  const soloNewVoice =
    Number(soloNewVoiceFactor) > 0 && Number(soloNewVoiceFactor) <= 1
      ? Number(soloNewVoiceFactor)
      : roomFactorFromConfig('soloNewVoiceFactor', 0.82, config)
  const newVoiceOpen = soloSession ? newVoice * soloNewVoice : newVoice

  const { bestLabel, bestSim } = clusterBestSimilarity(normalized, clusters)

  const lastNorm = Array.isArray(lastSignature) && lastSignature.length
    ? normalizeEmbeddingVector(lastSignature)
    : []
  const lastSim =
    lastSpeaker && lastNorm.length
      ? compareCosineSignatures(normalized, lastNorm)
      : -1

  const prefer = String(preferLabel || '').trim()
  if (prefer) {
    const preferCluster = clusters.find(
      (c) => String(c?.label || '').trim().toLowerCase() === prefer.toLowerCase(),
    )
    if (preferCluster?.signature?.length) {
      const preferSim = compareCosineSignatures(
        normalized,
        normalizeEmbeddingVector(preferCluster.signature),
      )
      if (preferSim >= floor) {
        return {
          speakerName: prefer,
          speakerId: labelToSpeakerIdSimple(prefer),
          similarity: preferSim,
          reason: 'prefer-cluster-match',
        }
      }
    }
  }

  if (bestLabel && bestSim >= clusterMatch) {
    return {
      speakerName: bestLabel,
      speakerId: labelToSpeakerIdSimple(bestLabel),
      similarity: bestSim,
      reason: bestLabel === lastSpeaker ? 'cluster-cosine-match' : 'cluster-reidentify',
    }
  }

  if (lastSpeaker && lastSim >= 0 && lastSim < newVoiceOpen && bestSim < newVoiceOpen) {
    const newLabel = nextAutoSpeakerLabel(clusters, reservedLabels, config)
    return {
      speakerName: newLabel,
      speakerId: labelToSpeakerIdSimple(newLabel),
      similarity: bestSim,
      reason: 'forced-new-voice-below-threshold',
    }
  }

  if (lastSpeaker && lastSim >= continuity) {
    return {
      speakerName: lastSpeaker,
      speakerId: labelToSpeakerIdSimple(lastSpeaker),
      similarity: lastSim,
      reason: 'last-continuity',
    }
  }

  if (lastSpeaker && bestLabel === lastSpeaker && bestSim >= newVoice) {
    return {
      speakerName: lastSpeaker,
      speakerId: labelToSpeakerIdSimple(lastSpeaker),
      similarity: bestSim,
      reason: 'cluster-continuity',
    }
  }

  if (lastSpeaker && lastSim >= 0 && lastSim < newVoiceOpen) {
    const newLabel = nextAutoSpeakerLabel(clusters, reservedLabels, config)
    return {
      speakerName: newLabel,
      speakerId: labelToSpeakerIdSimple(newLabel),
      similarity: bestSim,
      reason: 'new-voice-below-threshold',
    }
  }

  if (lastSpeaker && lastSim >= newVoice && lastSim < continuity) {
    if (bestLabel === lastSpeaker && bestSim >= newVoice) {
      return {
        speakerName: lastSpeaker,
        speakerId: labelToSpeakerIdSimple(lastSpeaker),
        similarity: Math.max(lastSim, bestSim),
        reason: 'grey-zone-cluster-agreement',
      }
    }
    if (bestSim < newVoice && !soloSession) {
      const newLabel = nextAutoSpeakerLabel(clusters, reservedLabels, config)
      return {
        speakerName: newLabel,
        speakerId: labelToSpeakerIdSimple(newLabel),
        similarity: bestSim,
        reason: 'forced-new-voice-grey-zone',
      }
    }
  }

  if (soloSession) {
    const coalesceLabel =
      String(lastSpeaker || bestLabel || '').trim() || getFallbackSpeaker(config)
    return {
      speakerName: coalesceLabel,
      speakerId: labelToSpeakerIdSimple(coalesceLabel),
      similarity: lastSim >= 0 ? lastSim : bestSim,
      reason: 'solo-coalesce',
    }
  }

  const newLabel = nextAutoSpeakerLabel(clusters, reservedLabels, config)
  return {
    speakerName: newLabel,
    speakerId: labelToSpeakerIdSimple(newLabel),
    similarity: bestSim,
    reason: bestSim < newVoice ? 'new-voice-below-threshold' : 'first-voice-cluster',
  }
}
