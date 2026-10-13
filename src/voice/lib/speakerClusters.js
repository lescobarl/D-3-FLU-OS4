/**
 * Clusters de hablante + ventana de audio para firma (512-D): actualización,
 * búsqueda por vecino más cercano, match histórico de frase corta y fusión.
 * Única fuente de estas operaciones; el resolver (speakerDiarization.js) las consume.
 */
import { blendEmbeddingVectors, normalizeSpaces } from './audioMath.js'
import { compareCosineSignatures, isAutoSpeakerLabel, normalizeEmbeddingVector } from './speakerCore.js'
import { foldSpeakerKey, getVoiceIdentityConfig, isRegisteredSpeakerLabel } from './speakerLabels.js'
import { getPassiveBufferMs } from './micCapture.js'
import { DEFAULT_SAMPLE_RATE } from './audioConstants.js'

export const ROOM_REMATCH_STRICT = 0.85
export const SHORT_UTTERANCE_HISTORICAL_MATCH = 0.7
export const SHORT_UTTERANCE_IMMEDIATE_CONTINUITY = 0.72

/** Umbral coseno validado en (0, 1]; fuera de rango usa el fallback. */
export function cosineThreshold(thresholds = {}, key, fallback) {
  const value = Number(thresholds?.[key])
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : fallback
}

/**
 * DUENO UNICO del umbral de "MISMA VOZ" (dos clusters de la MISMA persona
 * re-clusterizada). MEDIDO (debug.log del dueno): MISMA voz 0.69-0.74, DISTINTA
 * 0.58; el umbral tiene que caer ENTRE las dos bandas, y el valor validado y
 * config-driven es `productionClusterReuseThreshold` (0.66) -el mismo que ya usaba
 * `turnSpeakerPreflight.clusterMergeFloor` para consolidar-.
 *
 * DEFECTO MEDIDO (P9.66): `findLabelsWithSharedVoice`/`findSpeakerLabelsMatchingSignature`
 * traian el umbral HARDCODEADO en 0.78, POR ENCIMA del techo de la banda de la misma
 * voz (0.74): el predicado era INSATISFACIBLE para la clase que dice cubrir (dos
 * clusters de la misma voz nunca llegan a 0.78), asi que el "soy Luz" jamas unificaba
 * sus etiquetas automaticas y NINGUNA fila cambiaba de nombre. Un dueno, un valor.
 *
 * @param {object|null} [thresholds] bloque `conversationSpeakerThresholds` (o se lee de config)
 * @returns {number} umbral coseno de "misma voz"
 */
export function sameVoiceFloor(thresholds = null) {
  const cfg = thresholds || getVoiceIdentityConfig()?.capture?.conversationSpeakerThresholds || {}
  const floor = Number(cfg?.productionClusterReuseThreshold)
  return Number.isFinite(floor) && floor > 0 && floor <= 1 ? floor : 0.66
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

/** Ventana de audio del turno actual (desde ultimo cierre) con fallback a cola fija. */
export function flattenChunksWindow(
  chunks = [],
  { totalSamples = 0, sinceSample = 0, maxSamples = 0, minSamples = 0 } = {},
) {
  // RENDIMIENTO (medido 2026-10-07): el buffer vivo llega a 30 s (~1,44 M muestras,
  // 11250 chunks). Antes se copiaba ENTERO (`flattenChunksTail(chunks, Infinity)`) y
  // luego se tomaba su cola: esa copia corria en CADA tick de identidad (800 ms) y en
  // CADA commit. Aqui se calcula la ventana y se copian SOLO sus muestras (mismo
  // resultado, sin la copia del buffer completo).
  let bufferLen = 0
  for (let index = 0; index < chunks.length; index += 1) {
    bufferLen += chunks[index]?.length || 0
  }
  if (!bufferLen) return new Float32Array(0)

  const hasTurnMark = sinceSample > 0
  const turnSpan = Math.max(0, totalSamples - sinceSample)
  let windowLen = hasTurnMark ? Math.min(turnSpan, bufferLen) : bufferLen
  if (maxSamples > 0) windowLen = Math.min(windowLen, maxSamples)
  if (minSamples > 0 && windowLen < minSamples) {
    // R1: la ventana NO puede empezar ANTES del turno (marca presente). Si la marca
    // cae en el sello (turnSpan<=0) la ventana es VACIA: no se mide la cola del buffer
    // (fallo medido: turnSpan=0 -> ventana = cola completa = audio PRE-turno).
    const limit = hasTurnMark ? turnSpan : bufferLen
    windowLen = Math.min(Math.max(windowLen, minSamples), limit)
  }
  if (windowLen <= 0) return new Float32Array(0)

  return flattenChunksTail(chunks, windowLen)
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
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : DEFAULT_SAMPLE_RATE
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
  sampleRate = DEFAULT_SAMPLE_RATE,
  thresholds = {},
} = {}) {
  const maxWords = Number(thresholds.shortUtteranceMaxWords)
  const maxMs = Number(thresholds.shortUtteranceMaxMs)
  const wordCap = Number.isFinite(maxWords) && maxWords > 0 ? maxWords : 3
  const msCap = Number.isFinite(maxMs) && maxMs > 0 ? maxMs : 1500
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : DEFAULT_SAMPLE_RATE
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

/** ¿Este cluster es el ancla de identidad de una persona REGISTRADA (nombre propio)? */
function isPinnedAnchorCluster(cluster) {
  const roomCfg = getVoiceIdentityConfig()?.capture?.roomCapture || {}
  if (roomCfg.pinRegisteredSpeaker === false) return false
  return isRegisteredSpeakerLabel(cluster?.label)
}

export function updateClusterSignature(cluster, vector) {
  const next = normalizeEmbeddingVector(vector)
  if (!next.length) return

  // Un cluster con NOMBRE PROPIO es el ancla de identidad de esa persona y su
  // firma NO se mezcla con la voz entrante. Muchas ramas (sticky/fallback)
  // etiquetan por defecto —«sigue siendo el de antes»— y llaman aquí con la voz
  // que acaba de sonar; mezclarla acercaba el ancla a esa voz turno a turno hasta
  // que cualquier otra (la TV, otro hablante) la casaba y se quedaba con el
  // nombre, arrastrando después a la sala entera. Los clusters automáticos
  // («Hablante N») sí adaptan: es lo que evita el H2 fantasma por pausa o eco.
  if (isPinnedAnchorCluster(cluster)) return

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
      // Clave PLEGADA (`foldSpeakerKey`): 'luis' y 'Luis' son la MISMA identidad, no
      // dos clusters (medido en el log del dueno 14:00-14:08: `['luis','Luis']`).
      map.set(foldSpeakerKey(cluster.label), cluster)
    }
  }
  _clusterMapCache.set(speakerClusters, { map, length: speakerClusters.length })
  return map
}

export function findClusterByLabel(speakerClusters, label = '') {
  const normalized = foldSpeakerKey(label)
  if (!normalized) return null
  const map = _buildClusterMap(speakerClusters)
  return map.get(normalized) || null
}

/**
 * Garantiza que exista un clúster para `label`.
 *
 * `learn` separa DOS responsabilidades que antes iban juntas y no debían:
 *   - ETIQUETAR un turno (decidir a quién pertenece esa voz), y
 *   - APRENDER su voz (actualizar la firma del clúster).
 * Las ramas de continuidad/sticky etiquetan por conjetura temporal («sigue
 * siendo el de antes») y aun así llamaban aquí, así que cada turno mezclaba su
 * voz en el clúster del anterior: en pocos turnos un solo clúster acababa
 * casando con toda la sala y se quedaba con todas las frases. Con
 * `learn: false` la etiqueta no contamina la firma; solo aprende quien tiene
 * evidencia real (coincidencia de vecino más cercano sobre el umbral).
 */
export function ensureClusterForLabel(speakerClusters, label, vector, { learn = true } = {}) {
  const existing = findClusterByLabel(speakerClusters, label)
  if (existing) {
    if (learn) updateClusterSignature(existing, vector)
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
  sampleRate = DEFAULT_SAMPLE_RATE,
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

/**
 * DUENO UNICO de "que etiquetas son la MISMA voz que el ancla" para el COSIDO.
 *
 * Regla: ESTRELLA (cada etiqueta entra si su firma pasa el piso contra el ANCLA), NO
 * encadenamiento. El contrato anterior declaraba "encadenamiento hasta punto fijo" y el
 * codigo no lo hacia; P9.85 se cierra en el lado del CONTRATO, no del codigo, porque el
 * encadenamiento es transitivo y COLAPSA voces distintas: con el piso del cosido (0.66,
 * el de la diarizacion) una voz "distinta" (banda medida 0.58) queda a ~0.99 de una
 * etiqueta de 0.70 al meterlas en cadena, asi que se fusionarian las dos voces y el
 * nombre del titular acabaria en la voz ajena (el defecto que el dueno reporta como
 * "me puso Luis a la chica"). El cosido parcial se prefiere a la fusion falsa.
 * CONSECUENCIA DECLARADA: una voz partida en A--B--C donde C solo se parece a B queda
 * en {A,B}; B y C se coseran cuando compartan turno medido. La propiedad queda FIJADA
 * por tests/vozCosidoDiarizacionGuard.test.ts (una cadena NO se cose mas alla del ancla).
 *
 * @param {Array} speakerClusters Clusters con firma.
 * @param {string} anchorLabel Etiqueta ancla (el nombre registrado o su etiqueta).
 * @param {number} [matchThreshold] Piso (por defecto, el de la diarizacion).
 * @returns {string[]} Grupo (incluye el ancla si existe) sin duplicados.
 */
export function sameVoiceLabelGroup(
  speakerClusters = [],
  anchorLabel = '',
  matchThreshold = sameVoiceFloor(),
) {
  const anchor = String(anchorLabel || "").trim()
  if (!anchor) return []
  const floor = Number(matchThreshold)
  if (!Number.isFinite(floor) || floor <= 0) return [anchor]
  const conFirma = (Array.isArray(speakerClusters) ? speakerClusters : []).filter(
    (cluster) =>
      String(cluster?.label || "").trim() &&
      Array.isArray(cluster?.signature) &&
      cluster.signature.length,
  )
  const ancla = conFirma.find((cluster) => foldSpeakerKey(cluster.label) === foldSpeakerKey(anchor))
  if (!ancla) return [anchor]
  const firmaAncla = normalizeEmbeddingVector(ancla.signature)
  const group = [String(ancla.label).trim()]
  const vistos = new Set([foldSpeakerKey(anchor)])
  for (const cluster of conFirma) {
    const label = String(cluster.label).trim()
    const clave = foldSpeakerKey(label)
    if (vistos.has(clave)) continue
    const similarity = compareCosineSignatures(firmaAncla, normalizeEmbeddingVector(cluster.signature))
    if (similarity >= floor) {
      vistos.add(clave)
      group.push(label)
    }
  }
  return group
}

/**
 * true si `name` es la etiqueta de un cluster CON firma: el NOMBRE esta LIGADO a esa VOZ (lo
 * escribio el registro del comando o el panel de participantes). Un turno de esa voz lleva su
 * nombre AUNQUE la medida del turno no llegue (N turnos de la voz -> N filas con el nombre).
 *
 * @param {Array} speakerClusters clusters de sesion
 * @param {string} name nombre candidato
 * @returns {boolean}
 */


export function isNameBoundToVoice(speakerClusters = [], name = '') {
  const target = String(name || '').trim()
  if (!target) return false
  return (speakerClusters || []).some((c) => {
    const sig = c?.signature
    return String(c?.label || '').trim() === target && Array.isArray(sig) && sig.length > 0
  })
}
export function findLabelsWithSharedVoice(
  speakerClusters = [],
  anchorLabel = '',
  matchThreshold = sameVoiceFloor(),
) {
  return sameVoiceLabelGroup(speakerClusters, anchorLabel, matchThreshold)
}

/** Filas del log cuya firma de cluster coincide con la voz del registro. */
export function findSpeakerLabelsMatchingSignature(
  speakerClusters = [],
  signatureVector = [],
  labels = [],
  matchThreshold = sameVoiceFloor(),
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

/** Numero de etiquetas AUTOMATICAS (Hablante N) con firma entre los clusters. */
export function autoSpeakerCount(speakerClusters = []) {
  return (Array.isArray(speakerClusters) ? speakerClusters : []).filter(
    (cluster) => isAutoSpeakerLabel(String(cluster?.label || '')) && Array.isArray(cluster?.signature) && cluster.signature.length,
  ).length
}

/**
 * DUENO UNICO del TOPE + FUSION de los clusters de una sesion (A6: una voz = un cluster).
 *
 * Orden (una sola via):
 *   1) FUSION por el criterio de la DIARIZACION: delega en `consolidateSpeakerClusters`
 *      (mismo dueno, sin copia) con el piso de "misma voz" (`sameVoiceFloor`).
 *   2) TOPE de etiquetas AUTOMATICAS: si el numero supera `maxAuto`, el exceso se funde en
 *      el cluster MAS PARECIDO (por coseno); es el precio declarado del tope (mejor una
 *      etiqueta de mas que un crecimiento sin freno: medido H1..H5 con DOS personas).
 *
 * @param {Array} speakerClusters Clusters de la sesion (no se muta el array: se devuelve nuevo).
 * @param {{ maxAuto?: number, floor?: number }} [options]
 * @returns {Array} clusters fusionados y acotados
 */
export function capAndFuseSpeakerClusters(speakerClusters = [], { maxAuto = 0, floor = 0 } = {}) {
  const piso = Number(floor)
  let out = piso > 0 && piso <= 1 ? consolidateSpeakerClusters(speakerClusters, piso) : [...speakerClusters]
  const tope = Number(maxAuto)
  if (Number.isFinite(tope) && tope > 0) {
    while (autoSpeakerCount(out) > tope) {
      const autos = out.filter((cluster) => isAutoSpeakerLabel(String(cluster?.label || '')))
      const sobran = autos[autos.length - 1]
      const otros = out.filter((cluster) => cluster !== sobran)
      if (!otros.length) break
      let mejor = otros[0]
      let mejorSim = -2
      for (const candidato of otros) {
        const a = normalizeEmbeddingVector(sobran.signature)
        const b = normalizeEmbeddingVector(candidato.signature)
        const sim = a.length && b.length ? compareCosineSignatures(a, b) : -1
        if (sim > mejorSim) { mejorSim = sim; mejor = candidato }
      }
      updateClusterSignature(mejor, normalizeEmbeddingVector(sobran.signature))
      out = out.filter((cluster) => cluster !== sobran)
    }
  }
  return out
}
/**
 * CONSOLIDA clusters de la MISMA voz: fusiona los que tienen firma muy similar en
 * el mas antiguo. MEDIDO en el log del dueno (2026-10-07 17:28-17:33): con 2
 * personas (y TV) la sesion acumulaba `refClusters=5` y las filas iban saltando de
 * etiqueta; el indice de clusters no se reducia nunca (`pruneGhostClusters` esta en
 * false desde P8.93 porque borraba el cluster recien escrito).
 *
 * Reglas de seguridad (no es un borrado ciego):
 *  - solo se fusionan firmas con coseno >= `matchThreshold` (config
 *    `cosineMatchThreshold`: "misma persona");
 *  - un NOMBRE PROPIO es un ancla de identidad: nunca se absorbe en una etiqueta
 *    automatica, ni dos nombres propios distintos se fusionan;
 *  - el superviviente conserva su etiqueta (el mas antiguo) y refuerza su firma.
 */
export function consolidateSpeakerClusters(speakerClusters = [], matchThreshold = 0.85) {
  const floor = Number(matchThreshold) > 0 && Number(matchThreshold) <= 1 ? Number(matchThreshold) : 0.85
  const out = []
  for (const cluster of speakerClusters) {
    const label = String(cluster?.label || '').trim()
    if (!label) continue
    const signature = Array.isArray(cluster?.signature) && cluster.signature.length
      ? normalizeEmbeddingVector(cluster.signature)
      : []
    if (!signature.length) {
      out.push(cluster)
      continue
    }
    const target = out.find((candidate) => {
      const candidateLabel = String(candidate?.label || '')
      // MISMA identidad por NOMBRE (plegado): 'luis' y 'Luis' son una sola voz aunque
      // el timbre medido difiera; no se dejan dos clusters con dos grafias.
      if (foldSpeakerKey(candidateLabel) === foldSpeakerKey(label)) return true
      if (isRegisteredSpeakerLabel(candidateLabel) !== isRegisteredSpeakerLabel(label)) return false
      const other = Array.isArray(candidate?.signature) && candidate.signature.length
        ? normalizeEmbeddingVector(candidate.signature)
        : []
      if (!other.length) return false
      return compareCosineSignatures(signature, other) >= floor
    })
    if (!target) {
      out.push(cluster)
      continue
    }
    updateClusterSignature(target, signature)
    const merged = [
      ...(target.signatureHistory || []),
      ...(cluster.signatureHistory || []),
    ].filter((entry) => Array.isArray(entry) && entry.length)
    target.signatureHistory = merged.slice(-3)
  }
  return out
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
