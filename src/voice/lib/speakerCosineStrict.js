/**
 * Asignación estricta por coseno L2 (512-D): compartida entre Worker y pruebas automatizadas.
 * Voces por debajo del umbral de cluster → nuevo Hablante N; sin colapsar en grey-zone perezoso.
 */

export function normalizeSignatureVector(vector = []) {
  if (!Array.isArray(vector) || !vector.length) return []
  let norm = 0
  for (let i = 0; i < vector.length; i += 1) {
    const v = Number(vector[i] || 0)
    norm += v * v
  }
  norm = Math.sqrt(norm) || 1
  return vector.map((v) => Number(v || 0) / norm)
}

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

export function labelToSpeakerIdStrict(label = '') {
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

export function nextAutoSpeakerLabelStrict(clusters = [], reserved = []) {
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
    const candidate = `Hablante ${index}`
    if (!known.has(candidate.toLowerCase())) return candidate
  }
  return `Hablante ${clusters.length + 1}`
}

function clusterBestSimilarity(normalized, clusters = []) {
  let bestLabel = ''
  let bestSim = -1
  for (const cluster of clusters) {
    const sig = cluster?.signature
    if (!Array.isArray(sig) || !sig.length) continue
    const sim = compareCosineSignatures(normalized, normalizeSignatureVector(sig))
    if (sim > bestSim) {
      bestSim = sim
      bestLabel = String(cluster?.label || '').trim()
    }
    if (Array.isArray(cluster?.signatureHistory)) {
      for (const entry of cluster.signatureHistory) {
        if (!Array.isArray(entry) || !entry.length) continue
        const histSim = compareCosineSignatures(normalized, normalizeSignatureVector(entry))
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
 * @returns {{ speakerName: string, speakerId: string, similarity: number, reason: string }}
 */
export function assignSpeakerStrictCosine(rawVector, {
  clusters = [],
  matchThreshold = 0.85,
  reservedLabels = [],
  preferLabel = '',
  lastSpeaker = '',
  lastSignature = null,
  continuityThreshold = 0.74,
  newVoiceThreshold = 0.68,
  matchThresholdCluster = 0.76,
  soloNewVoiceFactor = 0.82,
} = {}) {
  const normalized = normalizeSignatureVector(rawVector)
  if (!normalized.length) {
    const fallback = String(lastSpeaker || 'Hablante 1').trim() || 'Hablante 1'
    return {
      speakerName: fallback,
      speakerId: labelToSpeakerIdStrict(fallback),
      similarity: 0,
      reason: 'empty-vector',
    }
  }

  const floor = Number(matchThreshold) > 0 && Number(matchThreshold) <= 1
    ? Number(matchThreshold)
    : 0.85
  const continuity = Number(continuityThreshold) > 0 ? Number(continuityThreshold) : 0.74
  const newVoice = Number(newVoiceThreshold) > 0 ? Number(newVoiceThreshold) : 0.68
  const clusterMatch = Number(matchThresholdCluster) > 0 ? Number(matchThresholdCluster) : 0.76
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
      : 0.82
  const newVoiceOpen = soloSession ? newVoice * soloNewVoice : newVoice

  const { bestLabel, bestSim } = clusterBestSimilarity(normalized, clusters)

  const lastNorm = Array.isArray(lastSignature) && lastSignature.length
    ? normalizeSignatureVector(lastSignature)
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
        normalizeSignatureVector(preferCluster.signature),
      )
      if (preferSim >= floor) {
        return {
          speakerName: prefer,
          speakerId: labelToSpeakerIdStrict(prefer),
          similarity: preferSim,
          reason: 'prefer-cluster-match',
        }
      }
    }
  }

  if (bestLabel && bestSim >= clusterMatch) {
    return {
      speakerName: bestLabel,
      speakerId: labelToSpeakerIdStrict(bestLabel),
      similarity: bestSim,
      reason: bestLabel === lastSpeaker ? 'cluster-cosine-match' : 'cluster-reidentify',
    }
  }

  if (lastSpeaker && lastSim >= 0 && lastSim < newVoiceOpen && bestSim < newVoiceOpen) {
    const newLabel = nextAutoSpeakerLabelStrict(clusters, reservedLabels)
    return {
      speakerName: newLabel,
      speakerId: labelToSpeakerIdStrict(newLabel),
      similarity: bestSim,
      reason: 'forced-new-voice-below-threshold',
    }
  }

  if (lastSpeaker && lastSim >= continuity) {
    return {
      speakerName: lastSpeaker,
      speakerId: labelToSpeakerIdStrict(lastSpeaker),
      similarity: lastSim,
      reason: 'last-continuity',
    }
  }

  if (lastSpeaker && bestLabel === lastSpeaker && bestSim >= newVoice) {
    return {
      speakerName: lastSpeaker,
      speakerId: labelToSpeakerIdStrict(lastSpeaker),
      similarity: bestSim,
      reason: 'cluster-continuity',
    }
  }

  if (lastSpeaker && lastSim >= 0 && lastSim < newVoiceOpen) {
    const newLabel = nextAutoSpeakerLabelStrict(clusters, reservedLabels)
    return {
      speakerName: newLabel,
      speakerId: labelToSpeakerIdStrict(newLabel),
      similarity: bestSim,
      reason: 'new-voice-below-threshold',
    }
  }

  if (lastSpeaker && lastSim >= newVoice && lastSim < continuity) {
    if (bestLabel === lastSpeaker && bestSim >= newVoice) {
      return {
        speakerName: lastSpeaker,
        speakerId: labelToSpeakerIdStrict(lastSpeaker),
        similarity: Math.max(lastSim, bestSim),
        reason: 'grey-zone-cluster-agreement',
      }
    }
    if (bestSim < newVoice && !soloSession) {
      const newLabel = nextAutoSpeakerLabelStrict(clusters, reservedLabels)
      return {
        speakerName: newLabel,
        speakerId: labelToSpeakerIdStrict(newLabel),
        similarity: bestSim,
        reason: 'forced-new-voice-grey-zone',
      }
    }
  }

  if (soloSession) {
    const coalesceLabel = String(lastSpeaker || bestLabel || '').trim() || 'Hablante 1'
    return {
      speakerName: coalesceLabel,
      speakerId: labelToSpeakerIdStrict(coalesceLabel),
      similarity: lastSim >= 0 ? lastSim : bestSim,
      reason: 'solo-coalesce',
    }
  }

  const newLabel = nextAutoSpeakerLabelStrict(clusters, reservedLabels)
  return {
    speakerName: newLabel,
    speakerId: labelToSpeakerIdStrict(newLabel),
    similarity: bestSim,
    reason: bestSim < newVoice ? 'new-voice-below-threshold' : 'first-voice-cluster',
  }
}
