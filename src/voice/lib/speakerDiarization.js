/**
 * Diarización de conversación: UN solo resolver de hablante por embedding (512-D).
 *
 * `resolveConversationSpeaker` es el nombre canónico. `resolveProductionSpeakerAtBoundary`
 * y `resolveRoomNearestNeighbor` son ramas internas (config-gated), no funciones exportadas.
 * El Worker y el hilo principal consumen el mismo núcleo (speakerCore.js).
 */
import { FLU_CONFIG } from './fluConfig.js'
import { VOICE_DIARIZATION_DEFAULTS } from '../../core/config/sharedConfig.ts'
import { compareCosineSignatures, normalizeEmbeddingVector, getFallbackSpeaker, hasVoiceMeasurement } from './speakerCore.js'
import { DEFAULT_SAMPLE_RATE } from './audioConstants.js'
import {
  anonymousSpeakerLabel,
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
  verifiedAnchorFloor,
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

/**
 * DUENO UNICO del piso de identidad de `label` (AMBAS vias de diarizacion).
 *
 * Un cluster sembrado desde un ANCLA VERIFICADA de la base (`anchorVerified`)
 * usa el piso verificado: la MISMA voz del titular mide 0,629–0,714 contra su
 * ancla (sesion 18f3888c) y el piso general (0,76) lo excluia de su propia base
 * en la PRIMERA intervencion (defecto 4 del dueno 2026-10-19). Cualquier otra
 * identidad registrada usa el piso registrado general. Antes esta funcion solo
 * vivia en la via de limite y la via de conversacion exigia el piso general a
 * TODOS por igual: dos criterios para la misma pregunta (ruta doble de pisos).
 *
 * @param {Array} speakerClusters Clusters de la sesion.
 * @param {object} thresholds Umbrales de config de la sesion.
 * @param {string} label Etiqueta cuya identidad se pretende afirmar.
 * @returns {number} Piso coseno que debe superar la voz para afirmar `label`.
 */
function floorForRegisteredLabel(speakerClusters, thresholds, label) {
  const cluster = findClusterByLabel(speakerClusters, label)
  return cluster?.anchorVerified === true
    ? verifiedAnchorFloor(thresholds)
    : cosineThreshold(thresholds, 'cosineRegisteredMatchThreshold', VOICE_DIARIZATION_DEFAULTS.cosineRegisteredMatch)
}

/**
 * DUENO UNICO de "se puede AFIRMAR este nombre en ESTE turno".
 *
 * Un NOMBRE PROPIO exige DOS cosas: ventana SOSTENIDA (fuera de la regla corta
 * de <4 palabras / <1.5 s) y coincidencia MEDIDA contra su ancla (piso de
 * identidad registrada, `registeredVoiceFloor`). Las etiquetas automaticas
 * («Hablante N») son
 * agrupaciones de timbre, no identidades de persona: pasan siempre.
 *
 * @param {string} label Etiqueta que se pretende afirmar.
 * @param {{ backed?: boolean, shortWindow?: boolean }} [evidence]
 * @returns {boolean}
 */
function canAssertSpeakerName(label, { backed = false, shortWindow = false } = {}) {
  return !isRegisteredSpeakerLabel(label) || (!shortWindow && backed)
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
    // SIN MEDIDA no hay identidad: el respaldo NUNCA es un nombre propio (mandato
    // 2026-10-18 — el nombre del onboarding se estampaba en la primera voz).
    const keep = anonymousSpeakerLabel(lastSpeaker)
    note?.({ reason: 'no-vector', speaker: keep, lastSim: 0, bestSim: 0 })
    return keep
  }
  const roomCfg = FLU_CONFIG.voiceIdentity?.capture?.roomCapture || {}
  const classroom = roomCfg.classroomMultiSpeaker === true
  const CONTINUITY = cosineThreshold(thresholds, 'cosineContinuityThreshold', VOICE_DIARIZATION_DEFAULTS.cosineContinuity)
  const NEW_VOICE = cosineThreshold(thresholds, 'cosineNewVoiceThreshold', VOICE_DIARIZATION_DEFAULTS.cosineNewVoice)
  // UN lector del piso "misma voz": sameVoiceFloor (dueno unico), no una copia inline.
  const REUSE = sameVoiceFloor(thresholds)
  // ANCLA VERIFICADA (base de participantes): piso propio, con UN solo lector
  // (`verifiedAnchorFloor`, el mismo que usa `resolveVoiceIdentity`). MEDIDO 2026-10-19
  // (sesion 18f3888c): MISMA voz contra su ancla 0,629–0,714; voz DISTINTA 0,29–0,58. Con
  // el piso registrado general (0,76) la MISMA persona no confirma y su fila cae a
  // «Hablante N».
  const VERIFIED_ANCHOR = verifiedAnchorFloor(thresholds)
  const verifiedMarginRaw = Number(thresholds?.verifiedAnchorMargin)
  const VERIFIED_MARGIN = Number.isFinite(verifiedMarginRaw)
    ? verifiedMarginRaw
    : VOICE_DIARIZATION_DEFAULTS.verifiedAnchorMargin
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
  /**
   * PISO de identidad de `label`: dueno unico a nivel modulo
   * (`floorForRegisteredLabel`), compartido con la via de conversacion.
   */
  const registeredFloorFor = (label) =>
    floorForRegisteredLabel(speakerClusters, thresholds, label)

  const registeredIdentityConfirmed = (label) =>
    registeredIdentityBacked(normalized, label, speakerClusters, registeredFloorFor(label))

  // VENTANA CORTA (<4 palabras / <1.5 s): su embedding no es evidencia SOSTENIDA.
  // Se calcula UNA vez y lo consumen todas las ramas (mandato 2026-10-18).
  const shortWindow = isShortUtteranceContext({ utteranceText, voicedSampleCount, sampleRate, thresholds })

  /**
   * CONSUMIDOR del dueno unico (`canAssertSpeakerName`) con la ventana de ESTE turno.
   */
  const canAssertName = (label, backed) =>
    canAssertSpeakerName(label, { backed, shortWindow })

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
      // La rama historica SOLO existe en ventana CORTA: su vector NO es evidencia
      // sostenida y NO se aprende (contaminaba el cluster con cada frase suelta).
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
    const label = String(cluster?.label || '').trim()
    const sim = compareCosineSignatures(normalized, normalizeEmbeddingVector(cluster.signature))
    // Un NOMBRE PROPIO solo COMPITE si se puede AFIRMAR en este turno: ventana
    // sostenida + identificacion registrada. El piso es el de SU fuente: un ancla
    // VERIFICADA de la base usa `verifiedAnchorFloor` (medido 0,629–0,714 con la MISMA
    // voz); el resto, el piso registrado general. La banda de "misma voz"
    // (`sameVoiceFloor`) es agrupacion de timbre, no identidad: la mujer medida contra
    // "Luis" dentro de esa banda quedaba renombrada por la via generica.
    if (!canAssertName(label, sim >= registeredFloorFor(label))) continue
    if (sim > bestSim) {
      bestSim = sim
      bestLabel = label
    }
  }

  /**
   * MEJOR ANCLA VERIFICADA de la base para ESTA voz. Un cluster ANONIMO no compite por el
   * nombre: la identidad con nombre verificada manda aunque su coseno sea menor que el del
   * cluster que agrupo el timbre (medido 2026-10-19: 0,629 al ancla de Luis vs 0,745 al
   * cluster anonimo de SU MISMA voz). Entre DOS anclas verificadas SI compite el nombre:
   * la mejor solo adopta si saca `verifiedAnchorMargin` a la segunda.
   */
  let verifiedLabel = ''
  let verifiedSim = -1
  let verifiedRunnerUp = -1
  for (const cluster of speakerClusters) {
    if (cluster?.anchorVerified !== true) continue
    if (!Array.isArray(cluster?.signature) || !cluster.signature.length) continue
    const label = String(cluster?.label || '').trim()
    if (!label) continue
    const sim = compareCosineSignatures(normalized, normalizeEmbeddingVector(cluster.signature))
    if (sim > verifiedSim) {
      verifiedRunnerUp = verifiedSim
      verifiedSim = sim
      verifiedLabel = label
    } else if (sim > verifiedRunnerUp) {
      verifiedRunnerUp = sim
    }
  }
  const verifiedAnchorMatch =
    Boolean(verifiedLabel) &&
    verifiedSim >= VERIFIED_ANCHOR &&
    (verifiedRunnerUp < VERIFIED_ANCHOR || verifiedSim - verifiedRunnerUp >= VERIFIED_MARGIN)

  if (primaryLabel) {
    const primaryCluster = findClusterByLabel(speakerClusters, primaryLabel)
    if (primaryCluster?.signature?.length) {
      const primarySim = compareCosineSignatures(
        normalized,
        normalizeEmbeddingVector(primaryCluster.signature),
      )
      // El primario es un NOMBRE PROPIO: el piso de reutilizacion (`sameVoiceFloor`)
      // NO lo afirma; exige identificacion registrada y ventana sostenida (`canAssertName`).
      // El nombre del onboarding deja de estamparse en la primera voz que suene.
      const primaryFloor = isRegisteredSpeakerLabel(primaryLabel) ? registeredFloorFor(primaryLabel) : REUSE_EFF
      if (
        primarySim >= primaryFloor &&
        primarySim >= bestSim - SWITCH &&
        (primarySim > lastSim + SWITCH || primaryLabel === lastSpeaker || !lastSpeaker) &&
        canAssertName(primaryLabel, primarySim >= registeredFloorFor(primaryLabel))
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

  // SE RETIRO `production-primary-create-cluster` (mandato 2026-10-18): creaba el
  // ANCLA del participante activo con la PRIMERA voz que sonara (la TV en su
  // validacion). Esa voz quedaba bendecida como "Luis" para siempre y todos sus
  // turnos posteriores casaban el ancla al 0.9: el nombre del onboarding se
  // convertia en el default de un desconocido. Un nombre solo entra por su DATO
  // ("ok flu soy Luis", `registerSpeakerIdentity`) o por medida registrada.
  //
  // SE RETIRARON tambien `production-short-primary` y `production-short-primary-fallback`
  // (mandato 2026-10-18): estampaban el NOMBRE del primario desde una ventana de pocas
  // palabras, donde la medida de la hija contra "Luis" cae dentro de la banda de "misma
  // voz" y aun asi nombraba. Un nombre exige ventana SOSTENIDA y coincidencia registrada
  // (`canAssertName`), y la voz desconocida debe recibir su «Hablante N» aunque el
  // primario de la sesion tenga nombre.

  const atCap = hardCap > 0 && autoCount >= hardCap
  const nearCap = softCap > 0 && autoCount >= softCap

  const adoptCluster = (label, reason, sim) => {
    const cluster = findClusterByLabel(speakerClusters, label)
    // VENTANA CORTA: su vector NO es evidencia sostenida y NO se aprende (una frase
    // de 1.1 s contaminaba la firma del cluster con la voz de al lado).
    if (cluster && !shortWindow) updateClusterSignature(cluster, normalized)
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
    shortWindow

  // ANCLA VERIFICADA DE LA BASE (identidad REAL del dueno): ventana SOSTENIDA + match a SU
  // piso. Gana a un cluster anonimo pegajoso: la misma voz no se queda en «Hablante N»
  // teniendo su ancla medida y verificada (defecto medido 2026-10-19, sesion 18f3888c: la
  // voz del dueno quedo «Hablante 2» toda la sesion con su ancla en la base). Una ventana
  // corta no afirma nombres (`canAssertSpeakerName`).
  if (verifiedAnchorMatch && !shortWindow) {
    return adoptCluster(verifiedLabel, 'production-verified-anchor', verifiedSim)
  }

  if (lastSpeaker && lastSim >= CONTINUITY && !shortAfterOtherVoice && canAssertName(lastSpeaker, registeredIdentityConfirmed(lastSpeaker))) {
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
    if (lastSpeaker && lastSim >= NEW_VOICE_EFF && !shortAfterOtherVoice && canAssertName(lastSpeaker, registeredIdentityConfirmed(lastSpeaker))) {
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

  // `production-short-primary-fallback` se RETIRO (mandato 2026-10-18): era la MISMA
  // estampa del nombre del primario en ventana corta por otra puerta. Si la voz no
  // alcanza ventana sostenida + identidad registrada, no se afirma nombre propio; esa voz
  // conserva/recibe su «Hablante N».

  // SE RETIRO `production-reuse-no-evidence` (mandato del dueno 2026-10-18). Reusaba la
  // etiqueta del hablante anterior con una medida SOSTENIDA que no casaba con NINGUNA voz
  // (cosenos medidos de 14 %, 19 %, 38 % y 37 % en su log): una sola etiqueta ("Hablante 1") terminaba
  // representando al dueno y a la nina, y "soy Luis" no podia separarlas despues. La regla
  // del dueno es explicita: voz DISTINTA = etiqueta DISTINTA; prohibido heredar por
  // cercania, participante activo o ultimo hablante. Un turno sostenido que no casa con
  // ninguna voz abre/usa SU cluster (`production-forced-new-voice` mas abajo). Las ventanas
  // cortas conservan su regla propia (no son evidencia y no aprenden), y un turno sin
  // medida no llega aqui (`no-vector`).

  // VENTANA CORTA (<4 palabras / <1.5 s): su medida NO es evidencia SOSTENIDA, asi que
  // no abre voz nueva ni aprende (mandato 2026-10-18). Si no caso con ningun cluster
  // (arriba), se queda con la etiqueta automatica anterior —sin aprender— o con el
  // respaldo generico. La voz nueva se abre cuando hay ventana suficiente para medirla;
  // una frase de 1.1 s no puede partir la sesion en dos "Hablante N".
  if (shortWindow) {
    if (lastSpeaker && isAutoSpeakerLabel(lastSpeaker)) {
      return anchorLastSpeaker('production-short-window-continuity')
    }
    const fallback = getFallbackSpeaker()
    note?.({ reason: 'production-short-window-fallback', speaker: fallback, lastSim, bestSim, autoCount })
    return fallback
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

  if (lastSpeaker && lastSim >= CONTINUITY && canAssertName(lastSpeaker, registeredIdentityConfirmed(lastSpeaker))) {
    return anchorLastSpeaker('production-last-continuity-late')
  }

  if (lastSpeaker && bestLabel === lastSpeaker && bestSim >= REUSE_EFF) {
    return adoptCluster(lastSpeaker, 'production-cluster-continuity', bestSim)
  }

  if (bestLabel && bestLabel !== lastSpeaker && bestSim >= NEW_VOICE_EFF) {
    // "Bloquear a otro" ANCLA al anterior: si es un NOMBRE PROPIO exige identidad
    // REGISTRADA medida (mismo dueno que el resto de la continuidad con nombre).
    if (lastSpeaker && lastSim >= NEW_VOICE_EFF && bestSim - lastSim < SWITCH && canAssertName(lastSpeaker, registeredIdentityConfirmed(lastSpeaker))) {
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
    // Dueño unico del "siguiente Hablante N" (high-water de la sesion): una etiqueta
    // automatica no se toma del respaldo, que puede quedar por debajo del maximo ya
    // emitido si el primer cluster paso a nombre propio.
    const label = nextSessionSpeakerLabel(speakerClusters, reservedLabels, maxAutoSpeakers || hardCap || 0)
    speakerClusters.push({
      label,
      signature: [...normalized],
      signatureHistory: [[...normalized]],
    })
    note?.({ reason: 'production-first-cluster', speaker: label })
    return label
  }

  if (soloSession) {
    if (lastSpeaker && canAssertName(lastSpeaker, registeredIdentityConfirmed(lastSpeaker))) {
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
    const nearestLabel = String(nearestCluster.label || effectiveSticky).trim()
    // Un NOMBRE PROPIO no se afirma en ventana CORTA aunque el NN de sala alcance el piso estricto:
    // la medida corta fluctua dentro de la banda de "misma voz" (mandato 2026-10-18).
    const shortWindow = isShortUtteranceContext({
      utteranceText,
      voicedSampleCount,
      sampleRate,
      thresholds,
    })
    // La similitud del NN ES una medida (>= piso estricto de sala): `backed` es true;
    // lo unico que puede impedir el nombre es que la ventana no sea sostenida.
    if (canAssertSpeakerName(nearestLabel, { backed: true, shortWindow })) {
      updateClusterSignature(nearestCluster, normalized)
      note({
        reason: 'room-nn-rematch',
        speaker: nearestLabel,
        clusterSimilarity: nearestSimilarity,
        cosineThreshold: requiredForRematch,
        embeddingDim: normalized.length,
      })
      return nearestLabel
    }
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
    // SIN MEDIDA no hay identidad: la etiqueta se conserva SOLO si es ANONIMA; un
    // nombre propio (el del onboarding / lastLogged) NO se hereda (mandato 2026-10-18).
    const keep = anonymousSpeakerLabel(lastSpeaker || preferSpeaker || getFallbackSpeaker())
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
  // La preferencia de IDENTIDAD es el NOMBRE del participante activo (`sessionPrimary`)
  // cuando esta presente: el `preferSpeaker` que llega del commit es el sticky
  // ("Hablante N"), asi que la compuerta "registrado" buscaba una etiqueta generica y el
  // nombre quedaba muerto (defecto 3 medido 2026-10-15: 45 turnos cortos rotulados
  // "Hablante N" con `Match reason=canonical name="luis"`). El nombre NO se inventa: la
  // via que lo afirma sigue exigiendo coincidencia MEDIDA contra su ancla
  // (`registeredFloorFor`: piso verificado para el ancla de la base, registrado general para el resto).
  const sessionPrimaryLabel = normalizeSpeakerLabel(sessionPrimary)
  const preferIdentity =
    pinRegistered && isRegisteredSpeakerLabel(sessionPrimaryLabel) ? sessionPrimaryLabel : preferSpeaker
  const preferIsRegistered = pinRegistered && isRegisteredSpeakerLabel(preferIdentity)
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
  const CONTINUITY = cosineThreshold(thresholds, 'cosineContinuityThreshold', VOICE_DIARIZATION_DEFAULTS.cosineContinuity)
  const NEW_VOICE = cosineThreshold(thresholds, 'cosineNewVoiceThreshold', VOICE_DIARIZATION_DEFAULTS.cosineNewVoice)
  /** Piso de identidad de `label` (dueno unico a nivel modulo, `floorForRegisteredLabel`). */
  const registeredFloorFor = (label) =>
    floorForRegisteredLabel(speakerClusters, thresholds, label)
  /** Consumidor del dueno unico (`canAssertSpeakerName`) con la ventana de ESTE turno. */
  const canAssertName = (label, backed) =>
    canAssertSpeakerName(label, { backed, shortWindow: shortUtterance })

  if (!voicedSampleCount || voicedSampleCount < minVoicedSamples) {
    // Sin audio suficiente no hay medida: NUNCA se afirma un nombre propio; se
    // conserva la etiqueta anonima con la que venia esa voz (mandato 2026-10-18).
    const keep = anonymousSpeakerLabel(effectiveSticky)
    note({ reason: 'insufficient-voiced', voicedSampleCount, minVoicedSamples, speaker: keep })
    return keep
  }

  if (preferIsRegistered && pinRegistered && preferIdentity) {
    const pinnedCluster = findClusterByLabel(speakerClusters, preferIdentity)
    if (pinnedCluster?.signature?.length) {
      const pinnedSimilarity = compareCosineSignatures(vector, pinnedCluster.signature)
      // Nombre propio: coincidencia REGISTRADA y ventana SOSTENIDA. En una frase de
      // ~1 s la medida fluctua dentro de la banda de "misma voz" y no afirma nada.
      if (pinnedSimilarity >= registeredFloorFor(preferIdentity) && canAssertName(preferIdentity, true)) {
        // La firma del cluster del registrado NO se actualiza aquí: es su ancla
        // de identidad. Actualizarla con la voz entrante (updateClusterSignature
        // da más peso al vector nuevo que al acumulado) dejaba que otra voz
        // —TV, otro hablante— la arrastrara hacia sí misma turno a turno hasta
        // que todo pasaba el umbral y la sala entera quedaba con un solo nombre.
        // La deriva natural del titular la absorbe la ruta normal (nearest
        // neighbour), que exige más evidencia que este atajo.
        note({ reason: 'registered-pinned-rematch', speaker: preferIdentity, clusterSimilarity: pinnedSimilarity })
        return preferIdentity
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
      preferSpeaker: preferIdentity,
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
    const label = String(cluster?.label || '').trim()
    const similarity = compareCosineSignatures(vector, cluster.signature)
    // Un NOMBRE PROPIO solo COMPITE con coincidencia REGISTRADA y ventana sostenida:
    // la banda de "misma voz" (timbre) NO es identidad. Sin esta poda, la voz de la
    // hija (medida por debajo de la identidad registrada contra el ancla "Luis")
    // ganaba el match generico y heredaba el nombre (mandato 2026-10-18).
    if (!canAssertName(label, similarity >= registeredFloorFor(label))) return
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
        if (pinnedSimilarity >= registeredFloorFor(preferSpeaker) && canAssertName(preferSpeaker, true)) {
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
    const lastTurnRematchSimilarity =
      lastSpeaker && Array.isArray(lastSignature) && lastSignature.length
        ? compareCosineSignatures(vector, lastSignature)
        : 0
    if (
      lastSpeaker &&
      lastTurnRematchSimilarity >= strictRematch &&
      // Un NOMBRE PROPIO no se afirma por continuidad: exige su ANCLA medida
      // (`registeredVoiceFloor`) y ventana sostenida. Sin ancla, recibe/conserva su «Hablante N».
      canAssertName(lastSpeaker, registeredIdentityBacked(vector, lastSpeaker, speakerClusters, registeredFloorFor(lastSpeaker)))
    ) {
      // La etiqueta AUTOMATICA aprende su voz; el ancla de un NOMBRE no se toca (ni se
      // crea) con la voz entrante: la identidad solo entra por su dato o por el registro.
      if (!isRegisteredSpeakerLabel(lastSpeaker)) {
        ensureClusterForLabel(speakerClusters, lastSpeaker, vector)
      }
      note({
        reason: 'room-last-turn-rematch',
        speaker: lastSpeaker,
        clusterSimilarity: lastTurnRematchSimilarity,
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
      if (pinnedSimilarity >= registeredFloorFor(preferSpeaker) && canAssertName(preferSpeaker, true)) {
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
        && canAssertName(effectiveSticky, registeredIdentityBacked(vector, effectiveSticky, speakerClusters, registeredFloorFor(effectiveSticky)))) {
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
        && canAssertName(lastSpeaker, registeredIdentityBacked(vector, lastSpeaker, speakerClusters, registeredFloorFor(lastSpeaker)))) {
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
    canAssertName(lastSpeaker, registeredIdentityBacked(vector, lastSpeaker, speakerClusters, registeredFloorFor(lastSpeaker)))
  ) {
    // Solo la etiqueta ANONIMA aprende aqui; un nombre propio ya tiene su ancla y no
    // se crea ni se mezcla por continuidad (mandato 2026-10-18).
    if (allowNew && !isRegisteredSpeakerLabel(lastSpeaker)) {
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
      && canAssertName(effectiveSticky, registeredIdentityBacked(vector, effectiveSticky, speakerClusters, registeredFloorFor(effectiveSticky)))) {
      updateClusterSignature(stickyCluster, vector)
      return effectiveSticky
    }
    if (clusterMatch) {
      updateClusterSignature(clusterMatch, vector)
      return clusterMatch.label || effectiveSticky
    }
    if (canAssertName(effectiveSticky, registeredIdentityBacked(vector, effectiveSticky, speakerClusters, registeredFloorFor(effectiveSticky)))) {
      return effectiveSticky
    }
  }

  if (!speakerClusters.some((cluster) => Array.isArray(cluster?.signature) && cluster.signature.length)) {
    // El PRIMER cluster de la sesion es ANONIMO: bautiza a quien hable primero (la TV,
    // un invitado), NO al participante del onboarding. Si esa voz ya traia una etiqueta
    // anonima se conserva; un nombre propio NUNCA se crea aqui (mandato 2026-10-18).
    const label = anonymousSpeakerLabel(effectiveSticky)
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
      if (pinnedSimilarity >= registeredFloorFor(preferSpeaker) && canAssertName(preferSpeaker, true)) {
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
    if (canAssertName(effectiveSticky, registeredIdentityBacked(vector, effectiveSticky, speakerClusters, registeredFloorFor(effectiveSticky)))) {
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
      canAssertName(matched, registeredIdentityBacked(vector, matched, speakerClusters, registeredFloorFor(matched))) &&
      (allowNew || allowNewDespiteBoundary || foldSpeakerKey(matched) === foldSpeakerKey(effectiveSticky))
    ) {
      return matched
    }
    return stickyFallback()
  }

  if (allowNew || allowNewDespiteBoundary) {
    // La etiqueta que se crea/refuerza aqui NUNCA es un nombre propio sin medida: se
    // usa la etiqueta anonima que ya traia esa voz (mandato 2026-10-18).
    ensureClusterForLabel(speakerClusters, anonymousSpeakerLabel(effectiveSticky), vector, { learn: false })
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
