/**
 * Diarización de conversación: UN solo resolver de hablante por embedding (512-D).
 *
 * `resolveConversationSpeaker` es el nombre canónico. `resolveProductionSpeakerAtBoundary`
 * y `resolveRoomNearestNeighbor` son ramas internas (config-gated), no funciones exportadas.
 * El Worker y el hilo principal consumen el mismo núcleo (speakerCore.js).
 */
import { FLU_CONFIG } from './fluConfig.js'
import { compareCosineSignatures, normalizeEmbeddingVector, getFallbackSpeaker } from './speakerCore.js'
import {
  foldSpeakerKey,
  isAutoSpeakerLabel,
  isRegisteredSpeakerLabel,
  normalizeSpeakerLabel,
  nextAvailableSpeakerLabel,
} from './speakerLabels.js'
import {
  SHORT_UTTERANCE_IMMEDIATE_CONTINUITY,
  cosineThreshold,
  ensureClusterForLabel,
  findClusterByLabel,
  findNearestCluster,
  findShortUtteranceHistoricalMatch,
  isShortUtteranceContext,
  isVoiceDistinctFromSticky,
  resolveImmediateShortSpeakerContinuity,
  resolveRoomRematchThreshold,
  updateClusterSignature,
} from './speakerClusters.js'

function nextSessionSpeakerLabel(speakerClusters = [], extraLabels = [], maxAutoSpeakers = 0) {
  return nextAvailableSpeakerLabel(speakerClusters, extraLabels, { maxSpeakers: maxAutoSpeakers })
}

function diarizationFactor(config = FLU_CONFIG, key, fallback) {
  const value = Number(config?.voiceIdentity?.capture?.diarizationFactors?.[key])
  return Number.isFinite(value) ? value : fallback
}

/** Similitud turno-a-turno; ignora lastSignature si la dimensión no coincide con el embedding actual. */
function resolveLastTurnSimilarity(normalized, lastSpeaker, lastSignature, speakerClusters) {
  if (Array.isArray(lastSignature) && lastSignature.length) {
    const lastNorm = normalizeEmbeddingVector(lastSignature)
    if (lastNorm.length === normalized.length) {
      return compareCosineSignatures(normalized, lastNorm)
    }
  }
  if (!lastSpeaker) return 0
  const cluster = findClusterByLabel(speakerClusters, lastSpeaker)
  if (!Array.isArray(cluster?.signature) || !cluster.signature.length) return 0
  return compareCosineSignatures(normalized, normalizeEmbeddingVector(cluster.signature))
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
  const normalized = normalizeEmbeddingVector(vector)
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
    const sim = compareCosineSignatures(normalized, normalizeEmbeddingVector(cluster.signature))
    if (sim > bestSim) {
      bestSim = sim
      bestLabel = String(cluster?.label || '').trim()
    }
  }

  if (primaryLabel) {
    const primaryCluster = findClusterByLabel(speakerClusters, primaryLabel)
    if (primaryCluster?.signature?.length) {
      const primarySim = compareCosineSignatures(
        normalized,
        normalizeEmbeddingVector(primaryCluster.signature),
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
      const primarySim = compareCosineSignatures(
        normalized,
        normalizeEmbeddingVector(primaryCluster.signature),
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
      const primarySim = compareCosineSignatures(
        normalized,
        normalizeEmbeddingVector(primaryCluster.signature),
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
    const label = getFallbackSpeaker()
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
    const label = getFallbackSpeaker()
    const normalized = normalizeEmbeddingVector(vector)
    speakerClusters.push({ label, signature: [...normalized], signatureHistory: [[...normalized]] })
    note({ reason: 'room-first-cluster', speaker: label })
    return label
  }

  const requiredForRematch = resolveRoomRematchThreshold({ thresholds })
  const normalized = normalizeEmbeddingVector(vector)
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
          0.7,
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

/**
 * Diarización en conversación: prioriza el hablante actual; solo crea otro con voz muy distinta.
 * Único resolver de hablante por embedding (nombre canónico).
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
  const vector = normalizeEmbeddingVector(signatureVector)
  const roomCfg = FLU_CONFIG.voiceIdentity?.capture?.roomCapture || {}
  const factors = FLU_CONFIG.voiceIdentity?.capture?.diarizationFactors || {}
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
    : preferSpeaker || lastSpeaker || getFallbackSpeaker()
  const effectiveSticky = sticky || lastSpeaker || preferSpeaker || getFallbackSpeaker()
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
      const pinnedSimilarity = compareCosineSignatures(vector, pinnedCluster.signature)
      if (pinnedSimilarity >= REGISTERED_MATCH) {
        updateClusterSignature(pinnedCluster, vector)
        note({ reason: 'registered-pinned-rematch', speaker: preferSpeaker, clusterSimilarity: pinnedSimilarity })
        return preferSpeaker
      }
      // La voz NO coincide con el perfil registrado: NO se fuerza el nombre;
      // se continúa para asignar el hablante real (evita "voz distinta → nombre
      // del participante", p. ej. la hija etiquetada como el titular).
      note({ reason: 'registered-pinned-mismatch', speaker: effectiveSticky, clusterSimilarity: pinnedSimilarity })
    } else {
      ensureClusterForLabel(speakerClusters, preferSpeaker, vector)
      note({ reason: 'registered-pinned-cluster', speaker: preferSpeaker })
      return preferSpeaker
    }
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
    const similarity = compareCosineSignatures(vector, cluster.signature)
    if (similarity > clusterSimilarity) {
      clusterSimilarity = similarity
      clusterMatch = cluster
    }
  })
  const continuityGate = atTurnBoundary
    ? CONTINUITY * diarizationFactor(FLU_CONFIG, 'continuityBoundaryFactor', factors.continuityBoundaryFactor ?? 0.82)
    : CONTINUITY
  let newVoiceGate = atTurnBoundary
    ? NEW_VOICE * (thresholds.turnBoundaryNewVoiceFactor ?? diarizationFactor(FLU_CONFIG, 'newVoiceBoundaryFactor', factors.newVoiceBoundaryFactor ?? 0.88))
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
      ? compareCosineSignatures(vector, lastSignature)
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
        const pinnedSimilarity = compareCosineSignatures(vector, pinnedCluster.signature)
        if (pinnedSimilarity >= REGISTERED_MATCH) {
          updateClusterSignature(pinnedCluster, vector)
          note({ reason: 'room-pinned-rematch', speaker: preferSpeaker, clusterSimilarity: pinnedSimilarity })
          return preferSpeaker
        }
        // Voz que NO coincide con el perfil registrado: no se fuerza el nombre.
        note({ reason: 'room-pinned-mismatch', speaker: effectiveSticky, clusterSimilarity: pinnedSimilarity })
      } else {
        ensureClusterForLabel(speakerClusters, preferSpeaker, vector)
        note({ reason: 'room-pinned-cluster', speaker: preferSpeaker })
        return preferSpeaker
      }
    }

    const strictRematch = resolveRoomRematchThreshold({ thresholds })
    if (
      lastSpeaker &&
      Array.isArray(lastSignature) &&
      lastSignature.length &&
      compareCosineSignatures(vector, lastSignature) >= strictRematch
    ) {
      ensureClusterForLabel(speakerClusters, lastSpeaker, vector)
      note({
        reason: 'room-last-turn-rematch',
        speaker: lastSpeaker,
        clusterSimilarity: compareCosineSignatures(vector, lastSignature),
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
      const pinnedSimilarity = compareCosineSignatures(vector, pinnedCluster.signature)
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
      ? compareCosineSignatures(vector, stickyClusterForCompare.signature)
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
            ? compareCosineSignatures(vector, stickyCluster.signature)
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
      ? compareCosineSignatures(vector, stickyCluster.signature)
      : 0
    if (clusterSimilarity > stickySimilarity + diarizationFactor(FLU_CONFIG, 'stickyClusterReidentifyMargin', factors.stickyClusterReidentifyMargin ?? 0.025)) {
      updateClusterSignature(clusterMatch, vector)
      return clusterMatch.label
    }
  }

  if (!atTurnBoundary) {
    const stickyCluster = findClusterByLabel(speakerClusters, effectiveSticky)
    if (stickyCluster && Array.isArray(stickyCluster.signature) && stickyCluster.signature.length) {
      const stickySimilarity = compareCosineSignatures(vector, stickyCluster.signature)
      if (stickySimilarity >= MATCH * diarizationFactor(FLU_CONFIG, 'stickyMatchFactor', factors.stickyMatchFactor ?? 0.92)) {
        updateClusterSignature(stickyCluster, vector)
        return effectiveSticky
      }
    }
  }

  if (lastSpeaker && lastSpeaker !== effectiveSticky && !atTurnBoundary) {
    const lastCluster = findClusterByLabel(speakerClusters, lastSpeaker)
    if (lastCluster && Array.isArray(lastCluster.signature) && lastCluster.signature.length) {
      const lastClusterSimilarity = compareCosineSignatures(vector, lastCluster.signature)
      if (lastClusterSimilarity >= MATCH * diarizationFactor(FLU_CONFIG, 'lastClusterMatchFactor', factors.lastClusterMatchFactor ?? 0.95)) {
        updateClusterSignature(lastCluster, vector)
        return lastSpeaker
      }
    }
  }

  const lastSimilarity =
    lastSpeaker && Array.isArray(lastSignature) && lastSignature.length
      ? compareCosineSignatures(vector, lastSignature)
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
    // creamos/anudamos el cluster a esa ID para no forzar la etiqueta genérica al inicio.
    const label = preferIsRegistered ? effectiveSticky : getFallbackSpeaker()
    speakerClusters.push({ label, signature: [...vector], signatureHistory: [[...vector]] })
    return label
  }

  const autoSpeakerCount = speakerClusters.filter((cluster) =>
    isAutoSpeakerLabel(cluster?.label),
  ).length

  const softCap = Number(roomCfg.maxAutoSpeakersSoftCap) || 0
  let strictNewVoice =
    maxAutoSpeakers > 0 && autoSpeakerCount >= maxAutoSpeakers
      ? newVoiceGate * diarizationFactor(FLU_CONFIG, 'strictNewVoiceAtCapFactor', factors.strictNewVoiceAtCapFactor ?? 0.88)
      : newVoiceGate
  if (roomCfg.stickySpeaker && softCap > 0 && autoSpeakerCount >= softCap) {
    strictNewVoice *= diarizationFactor(FLU_CONFIG, 'strictNewVoiceStickySoftCapFactor', factors.strictNewVoiceStickySoftCapFactor ?? 0.82)
  }
  const canCreateNewSpeaker =
    voicedSampleCount >= minVoicedForNew &&
    clusterSimilarity < strictNewVoice &&
    (distinctFromSticky || lastSimilarity < strictNewVoice)

  if (preferIsRegistered && canCreateNewSpeaker) {
    const pinnedCluster = findClusterByLabel(speakerClusters, preferSpeaker)
    if (pinnedCluster?.signature?.length) {
      const pinnedSimilarity = compareCosineSignatures(vector, pinnedCluster.signature)
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
