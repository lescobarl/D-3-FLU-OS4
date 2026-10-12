/**
 * Diarización de conversación: UN solo resolver de hablante por embedding (512-D).
 *
 * `resolveConversationSpeaker` es el nombre canónico. `resolveProductionSpeakerAtBoundary`
 * y `resolveRoomNearestNeighbor` son ramas internas (config-gated), no funciones exportadas.
 * El Worker y el hilo principal consumen el mismo núcleo (speakerCore.js).
 */
import { FLU_CONFIG } from './fluConfig.js'
import { VOICE_DIARIZATION_DEFAULTS } from '../../core/config/sharedConfig'
import { compareCosineSignatures, normalizeEmbeddingVector, getFallbackSpeaker, hasVoiceMeasurement } from './speakerCore.js'
import { DEFAULT_SAMPLE_RATE } from './audioConstants.js'
import {
  foldSpeakerKey,
  isAutoSpeakerLabel,
  isRegisteredSpeakerLabel,
  normalizeSpeakerLabel,
  nextAvailableSpeakerLabel,
} from './speakerLabels.js'
import {
  SHORT_UTTERANCE_HISTORICAL_MATCH,
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
  sameVoiceFloor,
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

/**
 * ¿Hay respaldo biométrico para afirmar `label` sobre esta voz?
 *
 * Un nombre propio (persona registrada) NO se hereda por línea de tiempo: solo
 * se afirma si la voz coincide con su ancla por encima del umbral de registrado.
 * Si el ancla aún no existe, tampoco — no hay nada que respalde el nombre. Las
 * etiquetas automáticas («Hablante N») son agrupaciones de timbre, no
 * identidades, así que siempre pasan.
 */
function registeredIdentityBacked(vector, label, speakerClusters, registeredMatch) {
  if (!isRegisteredSpeakerLabel(label)) return true
  const cluster = findClusterByLabel(speakerClusters, label)
  if (!cluster?.signature?.length) return false
  return (
    compareCosineSignatures(
      normalizeEmbeddingVector(vector),
      normalizeEmbeddingVector(cluster.signature),
    ) >= registeredMatch
  )
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
  sampleRate = DEFAULT_SAMPLE_RATE,
  note,
}) {
  const normalized = normalizeEmbeddingVector(vector)
  // Sin MEDIDA no hay nada que comparar: un vector vacio o degenerado da coseno 0
  // con TODO, y tratarlo como "voz distinta" abria `production-forced-new-voice`
  // (medido 2026-10-08 en el log del dueno: Identity label="Hablante 3" reason=
  // production-forced-new-voice con lastSim nulo, con la MISMA voz). Mismo criterio y
  // mismo DUENO que el nucleo del worker: `hasVoiceMeasurement`.
  if (!hasVoiceMeasurement(normalized)) {
    const keep =
      String(lastSpeaker || getFallbackSpeaker(FLU_CONFIG)).trim() || getFallbackSpeaker(FLU_CONFIG)
    note?.({ reason: 'no-vector', speaker: keep, lastSim: 0, bestSim: 0 })
    return keep
  }
  const roomCfg = FLU_CONFIG.voiceIdentity?.capture?.roomCapture || {}
  const classroom = roomCfg.classroomMultiSpeaker === true
  const CONTINUITY = cosineThreshold(thresholds, 'cosineContinuityThreshold', VOICE_DIARIZATION_DEFAULTS.cosineContinuity)
  const NEW_VOICE = cosineThreshold(thresholds, 'cosineNewVoiceThreshold', VOICE_DIARIZATION_DEFAULTS.cosineNewVoice)
  // UN lector del piso "misma voz": sameVoiceFloor (dueno unico), no una copia inline.
  const REUSE = sameVoiceFloor(thresholds)
  // Banda MEDIDA de "voz DISTINTA" (clave cosineDistinctVoiceThreshold): por debajo NO hay
  // evidencia de ninguna voz.
  const DISTINCT_VOICE = cosineThreshold(thresholds, 'cosineDistinctVoiceThreshold', VOICE_DIARIZATION_DEFAULTS.cosineDistinctVoice)
  const REGISTERED_ANCHOR = cosineThreshold(
    thresholds,
    'cosineRegisteredMatchThreshold',
    VOICE_DIARIZATION_DEFAULTS.cosineRegisteredMatch,
  )
  const HISTORICAL = cosineThreshold(thresholds, 'shortUtteranceHistoricalMatch', SHORT_UTTERANCE_HISTORICAL_MATCH)
  const reuseRelax = Number(roomCfg.classroomReuseRelax)
  const REUSE_EFF = classroom ? REUSE - (Number.isFinite(reuseRelax) ? reuseRelax : VOICE_DIARIZATION_DEFAULTS.classroomReuseRelax) : REUSE
  const NEW_VOICE_EFF = classroom ? NEW_VOICE + (Number(roomCfg.classroomNewVoiceRelax) || VOICE_DIARIZATION_DEFAULTS.classroomNewVoiceRelax) : NEW_VOICE
  const SWITCH = classroom
    ? Number(roomCfg.classroomLastSpeakerSwitchMargin) || VOICE_DIARIZATION_DEFAULTS.classroomLastSpeakerSwitchMargin
    : Number(roomCfg.lastSpeakerSwitchMargin) || 0.1
  const multiMin = classroom
    ? Number(roomCfg.classroomMultiSpeakerRoomClusterMin) || 2
    : Number(roomCfg.multiSpeakerRoomClusterMin) || 3
  const softCap = Number(roomCfg.maxAutoSpeakersSoftCap) || 0
  const hardCap = Number(roomCfg.maxAutoSpeakersInRoom) || 0
  const primaryLabel = normalizeSpeakerLabel(sessionPrimary)

  /**
   * ¿Se puede AFIRMAR que esta voz es la de `label` cuando `label` es una
   * persona con NOMBRE PROPIO? Un nombre propio no es una pista temporal: solo
   * se afirma con coincidencia contra su ancla biométrica. Si el ancla aún no
   * existe, tampoco — no hay nada que respalde el nombre, así que el turno no
   * puede heredarlo por continuidad.
   */
  const registeredIdentityConfirmed = (label) =>
    registeredIdentityBacked(normalized, label, speakerClusters, REGISTERED_ANCHOR)

  const autoCount = speakerClusters.filter(
    (c) => isAutoSpeakerLabel(c?.label) && Array.isArray(c?.signature) && c.signature.length,
  ).length
  const soloNewVoiceFactor = Number(roomCfg.soloNewVoiceFactor) || VOICE_DIARIZATION_DEFAULTS.soloNewVoiceFactor
  const soloSession = autoCount === 1
  // HISTERESIS (medido 2026-10-07): con la sesion YA multi-locutor no se abre un
  // cluster nuevo si el mejor cluster existente esta a menos de `newVoiceHysteresis`
  // del umbral de voz nueva: se REIDENTIFICA en vez de inflar el indice (con 2
  // personas + TV la sesion acumulaba 5 clusters y las filas saltaban de etiqueta).
  const HYST = Number(roomCfg.newVoiceHysteresis) || VOICE_DIARIZATION_DEFAULTS.newVoiceHysteresis
  const multiSession = autoCount >= multiMin
  const NEW_VOICE_GATE = multiSession ? Math.max(VOICE_DIARIZATION_DEFAULTS.newVoiceGateFloor, NEW_VOICE_EFF - HYST) : NEW_VOICE_EFF
  const NEW_VOICE_OPEN_GATE = soloSession ? NEW_VOICE_GATE * soloNewVoiceFactor : NEW_VOICE_GATE

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
    // P9.64 + H8: la MISMA persona NO puede tener DOS clusters (ruta doble de DATOS: antes
    // solo se unificaba la etiqueta de la fila y quedaban vivos el cluster historico y el
    // primario -> dos duenos de la misma voz). Si el historico es la misma persona que el
    // primario (clave plegada), se FUSIONA: sobrevive el CANONICO y se RETIRA el OTRO.
    //
    // P9.74 (MEDIDO 2026-10-12, DOS ordenes): la version anterior elegia el cluster con
    // `findClusterByLabel(historical.label)`, que devuelve el ULTIMO con la clave plegada
    // (`speakerClusters.js::_buildClusterMap`). Con `[luis, Luis]` ese "cluster" ERA el primario
    // -> se le actualizaba la firma al duplicado y se borraba el PRIMARIO: sobrevivia "luis"
    // mientras la etiqueta devuelta era "Luis" (la divergencia que H8 queria matar); y con
    // `[Luis, luis]` no fusionaba nada (n=2). Ahora se elige por IDENTIDAD: primero el que debe
    // SOBREVIVIR (el canonico) y despues se retira el otro; el orden del array deja de importar.
    const mismoPrimario = Boolean(primaryLabel) && foldSpeakerKey(historical.label) === foldSpeakerKey(primaryLabel)
    const canonico = mismoPrimario ? primaryLabel : historical.label
    let canonIdx = speakerClusters.findIndex((c) => String(c?.label ?? '') === String(canonico))
    if (canonIdx < 0) {
      canonIdx = speakerClusters.findIndex((c) => foldSpeakerKey(c?.label) === foldSpeakerKey(canonico))
    }
    if (canonIdx >= 0) {
      const superviviente = speakerClusters[canonIdx]
      if (String(superviviente?.label ?? '') !== String(canonico)) superviviente.label = canonico
      updateClusterSignature(superviviente, normalized)
      if (mismoPrimario) {
        const duplicadoIdx = speakerClusters.findIndex(
          (c, i) => i !== canonIdx && foldSpeakerKey(c?.label) === foldSpeakerKey(historical.label),
        )
        if (duplicadoIdx >= 0) speakerClusters.splice(duplicadoIdx, 1)
      }
    } else {
      // El canonico no existe como cluster (solo como nombre en la sesion): el historico se
      // queda con el nombre canonico (una etiqueta, un dato).
      const historico = findClusterByLabel(speakerClusters, historical.label)
      if (historico) {
        historico.label = canonico
        updateClusterSignature(historico, normalized)
      }
    }
    note?.({
      reason: 'production-short-historical',
      speaker: canonico,
      clusterSimilarity: historical.similarity,
    })
    return canonico
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
          bestSim > primarySim + SWITCH * VOICE_DIARIZATION_DEFAULTS.primaryRematchSwitchFactor
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
      // El cluster se CREA: es el ANCLA que faltaba para poder AFIRMAR el nombre en los
      // turnos siguientes. Pero ESTE turno NO se rotula con el nombre: no hubo ninguna
      // coincidencia que lo afirme (regla del dueno, `registeredIdentityConfirmed`:
      // "si el ancla aun no existe, tampoco"). Antes devolvia `primaryLabel` y el nombre
      // aparecia en la PRIMERA intervencion SIN decir el comando (medido 2026-10-11:
      // `Match name="Luis" inClusters=0` + `row-update objetivo:"luis"` a los 7 s).
      ensureClusterForLabel(speakerClusters, primaryLabel, normalized, { learn: true })
      note?.({
        reason: 'production-primary-create-cluster',
        speaker: primaryLabel,
        lastSim,
        bestSim,
        bestLabel,
        anchorOnly: true,
      })
      return lastSpeaker || getFallbackSpeaker(FLU_CONFIG)
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
    // Etiquetar por continuidad NO es aprender su voz: el turno se rotula como
    // el anterior, pero la firma de ese clúster NO se mezcla con la voz entrante.
    ensureClusterForLabel(speakerClusters, lastSpeaker, normalized, { learn: false })
    note?.({ reason, speaker: lastSpeaker, clusterSimilarity: lastSim, bestSim, bestLabel, autoCount })
    return lastSpeaker
  }

  const shortAfterOtherVoice =
    primaryLabel &&
    lastSpeaker &&
    lastSpeaker !== primaryLabel &&
    isShortUtteranceContext({ utteranceText, voicedSampleCount, sampleRate, thresholds })

  if (lastSpeaker && lastSim >= CONTINUITY && !shortAfterOtherVoice && registeredIdentityConfirmed(lastSpeaker)) {
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
    if (preferHistorical && bestSim - lastSim >= SWITCH * VOICE_DIARIZATION_DEFAULTS.switchRelax) {
      return adoptCluster(bestLabel, 'production-historical-reidentify', bestSim)
    }
    if (lastSpeaker && lastSim >= NEW_VOICE_EFF && !shortAfterOtherVoice && registeredIdentityConfirmed(lastSpeaker)) {
      if (classroom && bestLabel && bestLabel !== lastSpeaker && bestSim >= REUSE_EFF && bestSim - lastSim >= SWITCH) {
        return adoptCluster(bestLabel, 'production-classroom-switch', bestSim)
      }
      // Un NOMBRE PROPIO con evidencia (bestSim >= REUSE_EFF) GANA a una etiqueta
      // GENERICA pegajosa: la misma voz no debe quedarse en "Hablante N" teniendo su
      // ancla (medido con relax 0: la diferencia con el sticky era < SWITCH y anclaba
      // al generico; regla del dueno: el nombre aplica sus turnos).
      if (bestLabel && isRegisteredSpeakerLabel(bestLabel) && !isRegisteredSpeakerLabel(lastSpeaker) && bestSim >= REUSE_EFF) {
        return adoptCluster(bestLabel, 'production-proper-name-over-generic', bestSim)
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

  // SIN EVIDENCIA MEDIDA NO HAY VOZ NUEVA (repro del dueno): un cluster de la MISMA voz, firma
  // nueva por debajo de la banda de reutilizacion contra ese cluster y lastSpeaker = esa voz ->
  // antes abria 'Hablante 2'. Por debajo de la banda MEDIDA de voz DISTINTA (clave
  // cosineDistinctVoiceThreshold) no hay evidencia de ninguna voz: se REUSA la etiqueta de ESA
  // voz. En/por encima de esa banda SI hay evidencia -> se abre (la mujer conserva su etiqueta:
  // speakerClusterAccumulation lo fija).
  // ACOTADO: el reuso solo vale para una etiqueta AUTOMATICA. Un NOMBRE propio no se
  // estampa sin coincidencia medida (si no, la voz distinta heredaria el nombre: medido en
  // speakerIdentitySession "una voz DISTINTA no hereda el nombre").
  // REUSO (bajo la banda de voz distinta): un vector que NO casa con ninguna voz
  // (bestSim < cosineDistinctVoice) reusa la etiqueta del anterior EN VEZ de abrir
  // otra. La contaminacion de la ventana (R1) empujaba a la voz distinta por debajo
  // de esa banda y HEREDABA la etiqueta del titular (log 2026-10-12: la mujer =
  // "Hablante 3"); con R1 la medida es limpia y esta rama no se dispara.
  if (lastSpeaker && isAutoSpeakerLabel(lastSpeaker) && lastSim < NEW_VOICE_OPEN_GATE && bestSim < NEW_VOICE_OPEN_GATE && bestSim < DISTINCT_VOICE) {
    note?.({
      reason: 'production-reuse-no-evidence',
      speaker: lastSpeaker,
      lastSim,
      bestSim,
      autoCount,
    })
    return anchorLastSpeaker('production-reuse-no-evidence')
  }

  if (lastSpeaker && lastSim < NEW_VOICE_OPEN_GATE && bestSim < NEW_VOICE_OPEN_GATE) {
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

  if (lastSpeaker && lastSim >= CONTINUITY && registeredIdentityConfirmed(lastSpeaker)) {
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
    if (!soloSession && bestSim < NEW_VOICE_OPEN_GATE && lastSim < NEW_VOICE_OPEN_GATE) {
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
    if (!soloSession && bestSim < NEW_VOICE_OPEN_GATE) {
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
    if (lastSpeaker && registeredIdentityConfirmed(lastSpeaker)) {
      return anchorLastSpeaker('production-solo-coalesce')
    }
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
  sampleRate = DEFAULT_SAMPLE_RATE,
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
  sampleRate = DEFAULT_SAMPLE_RATE,
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
  // UN dueno del dato `lastSim` en el diagnostico: se anota AQUI, antes de cualquier
  // rama, para que TODAS las vias (principal, limite, sala) expongan el campo canonico
  // que lee el instrumento `Identity`. Antes solo la via de limite lo escribia y las
  // otras lo dejaban bajo otros nombres -> la sonda salia ciega (cero en 39/39).
  note({ lastSim: resolveLastTurnSimilarity(vector, lastSpeaker, lastSignature, speakerClusters) })
  // PISO DE EVIDENCIA (via principal), con el MISMO dueno que el nucleo
  // (`hasVoiceMeasurement`): un vector VACIO o DEGENERADO no es "voz distinta", es
  // AUSENCIA de medida. Antes el piso solo vivia en la rama de limite, y la via
  // principal -la que corre precisamente cuando el vector esta vacio, porque la rama
  // de limite exige `vector.length`- abria una etiqueta NUEVA para una ventana SIN
  // VOZ (medido 2026-10-09: `[]` -> "Hablante 3" con la sesion en "Hablante 1").
  if (!hasVoiceMeasurement(vector)) {
    const keep =
      String(lastSpeaker || preferSpeaker || getFallbackSpeaker()).trim() || getFallbackSpeaker()
    note({ reason: 'no-vector', speaker: keep })
    return keep
  }
  const roomCfg = FLU_CONFIG.voiceIdentity?.capture?.roomCapture || {}
  const factors = FLU_CONFIG.voiceIdentity?.capture?.diarizationFactors || {}
  const pinRegistered = roomCfg.pinRegisteredSpeaker !== false
  const soloSticky = roomCfg.soloSpeakerSticky === true
  const strictCosine = roomCfg.strictCosineDiarization !== false
  const boundaryAllowsNew = roomCfg.turnBoundaryAllowNewCluster === true
  const allowNew = allowNewCluster && (!atTurnBoundary || boundaryAllowsNew)
  const preferIsRegistered = pinRegistered && isRegisteredSpeakerLabel(preferSpeaker)
  const boundaryRelax = Number(roomCfg.turnBoundaryMatchRelax) || 2.35
  const reabsorbMargin = Number(roomCfg.turnBoundaryClusterReabsorbMargin) || VOICE_DIARIZATION_DEFAULTS.turnBoundaryClusterReabsorbMargin
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
  const MATCH = cosineThreshold(thresholds, 'cosineMatchThreshold', VOICE_DIARIZATION_DEFAULTS.cosineMatch)
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
  const REGISTERED_MATCH = cosineThreshold(thresholds, 'cosineRegisteredMatchThreshold', VOICE_DIARIZATION_DEFAULTS.cosineRegisteredMatch)
  const CONTINUITY = cosineThreshold(thresholds, 'cosineContinuityThreshold', VOICE_DIARIZATION_DEFAULTS.cosineContinuity)
  const NEW_VOICE = cosineThreshold(thresholds, 'cosineNewVoiceThreshold', VOICE_DIARIZATION_DEFAULTS.cosineNewVoice)

  if (!voicedSampleCount || voicedSampleCount < minVoicedSamples) {
    note({ reason: 'insufficient-voiced', voicedSampleCount, minVoicedSamples, speaker: effectiveSticky })
    return effectiveSticky
  }

  if (preferIsRegistered && pinRegistered && preferSpeaker) {
    const pinnedCluster = findClusterByLabel(speakerClusters, preferSpeaker)
    if (pinnedCluster?.signature?.length) {
      const pinnedSimilarity = compareCosineSignatures(vector, pinnedCluster.signature)
      if (pinnedSimilarity >= REGISTERED_MATCH) {
        // La firma del cluster del registrado NO se actualiza aquí: es su ancla
        // de identidad. Actualizarla con la voz entrante (updateClusterSignature
        // da más peso al vector nuevo que al acumulado) dejaba que otra voz
        // —TV, otro hablante— la arrastrara hacia sí misma turno a turno hasta
        // que todo pasaba el umbral y la sala entera quedaba con un solo nombre.
        // La deriva natural del titular la absorbe la ruta normal (nearest
        // neighbour), que exige más evidencia que este atajo.
        note({ reason: 'registered-pinned-rematch', speaker: preferSpeaker, clusterSimilarity: pinnedSimilarity })
        return preferSpeaker
      }
      // La voz NO coincide con el perfil registrado: NO se fuerza el nombre;
      // se continúa para asignar el hablante real (evita "voz distinta → nombre
      // del participante", p. ej. la hija etiquetada como el titular).
      note({ reason: 'registered-pinned-mismatch', speaker: effectiveSticky, clusterSimilarity: pinnedSimilarity })
    }
    // Sin cluster del registrado todavía: NO se crea a ciegas con la voz que
    // suene en ese momento (si habla la TV primero, su cluster nacería con la
    // voz de la TV y ya arrastraría el nombre para siempre). Se cae a la ruta
    // normal, que antes de crear el cluster del primario comprueba que su voz
    // no encaje ya en un cluster existente.
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
    ? CONTINUITY * diarizationFactor(FLU_CONFIG, 'continuityBoundaryFactor', factors.continuityBoundaryFactor ?? VOICE_DIARIZATION_DEFAULTS.continuityBoundaryFactor)
    : CONTINUITY
  let newVoiceGate = atTurnBoundary
    ? NEW_VOICE * (thresholds.turnBoundaryNewVoiceFactor ?? diarizationFactor(FLU_CONFIG, 'newVoiceBoundaryFactor', factors.newVoiceBoundaryFactor ?? VOICE_DIARIZATION_DEFAULTS.newVoiceBoundaryFactor))
    : NEW_VOICE
  if (atTurnBoundary && autoClusterCount >= 1) {
    newVoiceGate *= Number(roomCfg.turnBoundaryNewVoiceMultiFactor) || VOICE_DIARIZATION_DEFAULTS.turnBoundaryNewVoiceMultiFactor
  }
  const minVoicedForNew = atTurnBoundary
    ? Math.floor(minVoicedSamplesForNew * (thresholds.turnBoundaryVoicedFactor ?? VOICE_DIARIZATION_DEFAULTS.turnBoundaryVoicedFactor))
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
  const lastTurnFactor = Number(roomCfg.turnBoundaryLastTurnFactor) || VOICE_DIARIZATION_DEFAULTS.turnBoundaryLastTurnFactor
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
    // Un solo nombre para "similitud con el ultimo turno" en el diagnostico: la sonda
    // (`Identity`) leia `lastTurnSimilarity` mientras la via PRINCIPAL escribia
    // `lastSim` -> ciego (medido: 39/39). El campo canonico es `lastSim`.
    lastSim: lastTurnSimilarity,
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
          // Mismo criterio que el pin de arriba: la firma del cluster del
          // registrado es su ancla y NO se mezcla con la voz entrante.
          note({ reason: 'room-pinned-rematch', speaker: preferSpeaker, clusterSimilarity: pinnedSimilarity })
          return preferSpeaker
        }
        // Voz que NO coincide con el perfil registrado: no se fuerza el nombre.
        note({ reason: 'room-pinned-mismatch', speaker: effectiveSticky, clusterSimilarity: pinnedSimilarity })
      }
      // Sin cluster del registrado todavía: no se crea a ciegas con la voz
      // entrante (mismo motivo que el pin de arriba).
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
        // Ancla del registrado: no se mezcla con la voz entrante (ver el pin principal).
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
    if (clusterSimilarity > stickySimilarity + diarizationFactor(FLU_CONFIG, 'stickyClusterReidentifyMargin', factors.stickyClusterReidentifyMargin ?? VOICE_DIARIZATION_DEFAULTS.stickyClusterReidentifyMargin)) {
      updateClusterSignature(clusterMatch, vector)
      return clusterMatch.label
    }
  }

  if (!atTurnBoundary) {
    const stickyCluster = findClusterByLabel(speakerClusters, effectiveSticky)
    if (stickyCluster && Array.isArray(stickyCluster.signature) && stickyCluster.signature.length) {
      const stickySimilarity = compareCosineSignatures(vector, stickyCluster.signature)
      if (stickySimilarity >= MATCH * diarizationFactor(FLU_CONFIG, 'stickyMatchFactor', factors.stickyMatchFactor ?? VOICE_DIARIZATION_DEFAULTS.stickyMatchFactor)
        && registeredIdentityBacked(vector, effectiveSticky, speakerClusters, REGISTERED_MATCH)) {
        updateClusterSignature(stickyCluster, vector)
        return effectiveSticky
      }
    }
  }

  if (lastSpeaker && lastSpeaker !== effectiveSticky && !atTurnBoundary) {
    const lastCluster = findClusterByLabel(speakerClusters, lastSpeaker)
    if (lastCluster && Array.isArray(lastCluster.signature) && lastCluster.signature.length) {
      const lastClusterSimilarity = compareCosineSignatures(vector, lastCluster.signature)
      if (lastClusterSimilarity >= MATCH * diarizationFactor(FLU_CONFIG, 'lastClusterMatchFactor', factors.lastClusterMatchFactor ?? VOICE_DIARIZATION_DEFAULTS.lastClusterMatchFactor)
        && registeredIdentityBacked(vector, lastSpeaker, speakerClusters, REGISTERED_MATCH)) {
        updateClusterSignature(lastCluster, vector)
        return lastSpeaker
      }
    }
  }

  const lastSimilarity =
    lastSpeaker && Array.isArray(lastSignature) && lastSignature.length
      ? compareCosineSignatures(vector, lastSignature)
      : 0

  if (
    lastSpeaker &&
    lastSimilarity >= continuityGate &&
    !atTurnBoundary &&
    registeredIdentityBacked(vector, lastSpeaker, speakerClusters, REGISTERED_MATCH)
  ) {
    if (allowNew) {
      ensureClusterForLabel(speakerClusters, lastSpeaker, vector, { learn: false })
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
    if (stickyCluster?.signature?.length
      && registeredIdentityBacked(vector, effectiveSticky, speakerClusters, REGISTERED_MATCH)) {
      updateClusterSignature(stickyCluster, vector)
      return effectiveSticky
    }
    if (clusterMatch) {
      updateClusterSignature(clusterMatch, vector)
      return clusterMatch.label || effectiveSticky
    }
    if (registeredIdentityBacked(vector, effectiveSticky, speakerClusters, REGISTERED_MATCH)) {
      return effectiveSticky
    }
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
      ? newVoiceGate * diarizationFactor(FLU_CONFIG, 'strictNewVoiceAtCapFactor', factors.strictNewVoiceAtCapFactor ?? VOICE_DIARIZATION_DEFAULTS.strictNewVoiceAtCapFactor)
      : newVoiceGate
  if (roomCfg.stickySpeaker && softCap > 0 && autoSpeakerCount >= softCap) {
    strictNewVoice *= diarizationFactor(FLU_CONFIG, 'strictNewVoiceStickySoftCapFactor', factors.strictNewVoiceStickySoftCapFactor ?? VOICE_DIARIZATION_DEFAULTS.strictNewVoiceStickySoftCapFactor)
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
        // Ancla del registrado: no se mezcla con la voz entrante (ver el pin principal).
        return preferSpeaker
      }
    }
  }

  /**
   * Fallback de etiqueta: NUNCA devuelve un nombre propio sin respaldo
   * biométrico. Si el «sticky» es una persona registrada y esta voz no coincide
   * con su ancla, se devuelve la agrupación de timbre (etiqueta automática) o se
   * abre una nueva; heredar el nombre por línea de tiempo es justo lo que
   * mezclaba a la sala entera bajo un solo participante.
   */
  const stickyFallback = () => {
    if (registeredIdentityBacked(vector, effectiveSticky, speakerClusters, REGISTERED_MATCH)) {
      return effectiveSticky
    }
    if (clusterMatch && isAutoSpeakerLabel(clusterMatch.label)) return clusterMatch.label
    const anyAuto = speakerClusters.find((c) => isAutoSpeakerLabel(c?.label))
    if (anyAuto) return anyAuto.label
    if (allowNew || allowNewDespiteBoundary) {
      const label = nextSessionSpeakerLabel(speakerClusters, reservedLabels, maxAutoSpeakers)
      speakerClusters.push({ label, signature: [...vector], signatureHistory: [[...vector]] })
      note({ reason: 'unbacked-registered-sticky', speaker: label })
      return label
    }
    return getFallbackSpeaker()
  }

  if (canCreateNewSpeaker) {
    if (!allowNew && !allowNewDespiteBoundary) {
      return stickyFallback()
    }
    const label = nextSessionSpeakerLabel(speakerClusters, reservedLabels, maxAutoSpeakers)
    speakerClusters.push({ label, signature: [...vector], signatureHistory: [[...vector]] })
    note({ reason: 'new-cluster', speaker: label, clusterSimilarity, lastSim: lastSimilarity })
    return label
  }

  if (clusterMatch) {
    updateClusterSignature(clusterMatch, vector)
    const matched = clusterMatch.label || effectiveSticky
    if (
      registeredIdentityBacked(vector, matched, speakerClusters, REGISTERED_MATCH) &&
      (allowNew || allowNewDespiteBoundary || foldSpeakerKey(matched) === foldSpeakerKey(effectiveSticky))
    ) {
      return matched
    }
    return stickyFallback()
  }

  if (allowNew || allowNewDespiteBoundary) {
    ensureClusterForLabel(speakerClusters, effectiveSticky, vector, { learn: false })
  }
  return stickyFallback()
}

/**
 * DUENO UNICO de "la etiqueta se AFIRMO con una COINCIDENCIA medida" (evidencia).
 *
 * "HAY clusters" NO es evidencia: el relleno tardio usaba
 * `Boolean(workingClusters.length)` y con eso REESCRIBIA filas ajenas (medido en el log
 * del dueno 2026-10-11: `row-update {turnId:2, actual:"Hablante 1", objetivo:"luis"}` y
 * `{turnId:35, actual:"Hablante 3", objetivo:"Hablante 2"}`). Evidencia = el vector del
 * turno se COMPARO contra su ancla/cluster y la comparacion paso. Las razones de
 * CONTINUIDAD (`production-last-*`) y las que no comparan (crear cluster, voz nueva,
 * sin vector) NO son evidencia de identidad.
 *
 * El vocabulario se produce AQUI (`note({reason})`): la lista vive con el.
 * @param {string} reason
 * @returns {boolean}
 */
const RAZONES_CON_COINCIDENCIA_MEDIDA = new Set([
  'production-cluster-match',
  'production-primary-rematch',
  'production-short-primary',
  'production-short-historical',
  'production-historical-reidentify',
  'production-reidentify',
  'production-reidentify-marginal',
  'production-classroom-switch',
  'production-cluster-continuity',
  'production-known-other',
  'production-cap-reidentify',
  'production-cap-nearest',
  'production-grey-zone-cluster-agreement',
  'registered-pinned-rematch',
])

export function isMeasuredIdentityMatch(reason = '') {
  return RAZONES_CON_COINCIDENCIA_MEDIDA.has(String(reason || ''))
}
