/**
 * Clusters de hablante + ventana de audio para firma (512-D): actualización,
 * búsqueda por vecino más cercano, match histórico de frase corta y fusión.
 * Única fuente de estas operaciones; la consumen el directorio de voces, el
 * registro de identidad y la sesión de hablantes.
 */
import { blendEmbeddingVectors, normalizeSpaces } from './audioMath.js'
import { compareCosineSignatures, hasVoiceMeasurement, isAutoSpeakerLabel, normalizeEmbeddingVector, parseSpeakerIndex } from './speakerCore.js'
import { foldSpeakerKey, getVoiceIdentityConfig, isRegisteredSpeakerLabel, isProperSpeakerName, canonicalSpeakerName, normalizeSpeakerLabel } from './speakerLabels.js'
import { getPassiveBufferMs } from './micCapture.js'
import { SPEAKER_ASSIGN } from './speakerAssignDefaults.js'
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

/**
 * DUENO UNICO del piso de "esta voz es una identidad REGISTRADA" (la BASE de participantes).
 *
 * POR QUE ES OTRO PISO (medido 2026-10-13, debug.log del dueno): dentro de una reunion la
 * MISMA voz mide 0.69-0.74 (por eso la sesion reutiliza con 0.66) y una voz DISTINTA 0.58;
 * entre reuniones el vector se mide con otra ventana/tono, asi que la BASE exige el piso de
 * identidad registrada cosineRegisteredMatchThreshold (0.76), el MISMO valor con el que
 * el directorio de voces compara su ancla registrada. Con el
 * piso de sesion en la base, un 0.70 ajeno se daba por "es Luis" (defecto medido en vivo).
 *
 * @param {object|null} [thresholds] bloque conversationSpeakerThresholds (o se lee de config)
 * @returns {number} umbral coseno de "identidad registrada"
 */
export function registeredVoiceFloor(thresholds = null) {
  const cfg = thresholds || getVoiceIdentityConfig()?.capture?.conversationSpeakerThresholds || {}
  const floor = Number(cfg?.cosineRegisteredMatchThreshold)
  return Number.isFinite(floor) && floor > 0 && floor <= 1 ? floor : 0.76
}

/**
 * DUENO UNICO del piso de "esta voz es el ANCLA VERIFICADA de la base de participantes".
 *
 * POR QUE ES OTRO PISO (medido 2026-10-19, sesion del dueno 18f3888c): el ancla verificada
 * de "Luis" mide 0.629–0.714 con SU MISMA voz (otra ventana y otro dia) y 0.29–0.58 con una
 * voz DISTINTA (la mujer). El piso registrado general (0.76) exige mas de lo que la MISMA
 * persona da contra su propia ancla, asi que Luis caia a «Hablante N» toda la sesion. Una
 * ancla VERIFICADA (`voiceAnchorVerified`: el dueno la midio y la guardo) es evidencia mas
 * fuerte que un cluster anonimo de la sesion; su piso es propio y no se rebaja por caller.
 *
 * @param {object|null} [thresholds] bloque conversationSpeakerThresholds (o se lee de config)
 * @returns {number} umbral coseno de "ancla verificada"
 */
export function verifiedAnchorFloor(thresholds = null) {
  const cfg = thresholds || getVoiceIdentityConfig()?.capture?.conversationSpeakerThresholds || {}
  const floor = Number(cfg?.cosineVerifiedAnchorMatchThreshold)
  return Number.isFinite(floor) && floor > 0 && floor <= 1 ? floor : 0.62
}

/**
 * DUENO UNICO del piso de "esta fila es de una voz CLARAMENTE DISTINTA".
 *
 * POR QUE ES OTRO PISO: la clave (`speaker_N`) la asigna la diarizacion y un turno
 * MEZCLADO puede darsela a dos personas. MEDIDO (debug.log del dueno): MISMA voz
 * 0.69-0.74, DISTINTA 0.50-0.58. Por DEBAJO de esa banda no hay duda razonable: la fila
 * es de otra persona y "soy X" NO la renombra aunque comparta clave. Lo consume el
 * renombre por clave (`renameVoiceRowsByKey`); no es un piso de asignacion de nombre.
 *
 * @param {object|null} [thresholds] bloque conversationSpeakerThresholds (o se lee de config)
 * @returns {number} piso coseno por debajo del cual la voz es OTRA persona
 */
export function differentVoiceFloor(thresholds = null) {
  const cfg = thresholds || getVoiceIdentityConfig()?.capture?.conversationSpeakerThresholds || {}
  const floor = Number(cfg?.differentVoiceFloor)
  return Number.isFinite(floor) && floor > 0 && floor <= 1 ? floor : SPEAKER_ASSIGN.differentVoiceFloor
}

/**
 * DUENO UNICO del piso para AFIRMAR un nombre propio desde la medida del turno.
 *
 * El piso de identidad registrada (0.76) mide contra un ANCLA guardada; este mide la
 * confianza de la ASIGNACION en la sesion: el nombre solo se afirma si el mejor coseno
 * llega a `namedAssignFloor` (banda alta de la misma voz) y le saca `namedAssignMargin`
 * al mejor cluster ALTERNATIVO. Sin margen, dos voces de timbre parecido se reparten el
 * nombre turno a turno.
 *
 * @param {object|null} [thresholds] bloque conversationSpeakerThresholds
 * @returns {number} piso coseno de asignacion de nombre (0..1)
 */
/**
 * DUENO UNICO del MARGEN de un ANCLA VERIFICADA contra la mejor alternativa.
 * La MISMA voz medida contra su ancla (0.629-0.714) no puede exigir el margen
 * generico de asignacion (0.08): su banda medida es mas estrecha (0.05).
 */
export function verifiedAnchorMargin(thresholds = null) {
  const cfg = thresholds || getVoiceIdentityConfig()?.capture?.conversationSpeakerThresholds || {}
  const margin = Number(cfg?.verifiedAnchorMargin)
  return Number.isFinite(margin) && margin >= 0 && margin <= 1 ? margin : 0.05
}
export function namedAssignFloor(thresholds = null) {
  const cfg = thresholds || getVoiceIdentityConfig()?.capture?.conversationSpeakerThresholds || {}
  const floor = Number(cfg?.namedAssignFloor)
  return Number.isFinite(floor) && floor > 0 && floor <= 1 ? floor : SPEAKER_ASSIGN.namedAssignFloor
}

/**
 * DUENO UNICO del MARGEN entre el nombre candidato y el mejor cluster alternativo.
 *
 * @param {object|null} [thresholds] bloque conversationSpeakerThresholds
 * @returns {number} margen coseno exigido (0..1)
 */
export function namedAssignMargin(thresholds = null) {
  const cfg = thresholds || getVoiceIdentityConfig()?.capture?.conversationSpeakerThresholds || {}
  const margin = Number(cfg?.namedAssignMargin)
  return Number.isFinite(margin) && margin >= 0 && margin <= 1 ? margin : SPEAKER_ASSIGN.namedAssignMargin
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
  /** Sin transcripción no hay locución que medir (cola de silencio): no es corta. */
  if (words <= 0) return false
  // LA MEDIDA DE AUDIO MANDA CUANDO EXISTE (medido 2026-10-19 en el log del dueno):
  // "voy a contar 1 2 3" tiene 3 palabras y sonaba 2 s (`voiced=96000 ms=2000`); el
  // criterio por CONTEO lo daba por ventana corta y bloqueaba el nombre registrado
  // (Luis 0.83) para anclar por continuidad a "Hablante 1". Una ventana SOSTENIDA es
  // evidencia aunque el ASR entregue pocas palabras (numeros, nombres propios).
  if (durationMs > 0) return durationMs < msCap
  /** Sin audio medido, el unico indicio disponible es el texto. */
  return words < wordCap
}

/**
 * Umbral room-rematch estricto (0.85): similitud coseno < umbral → room-new-person.
 */
export function resolveRoomRematchThreshold({ thresholds = {} } = {}) {
  // EL CONFIG MANDA. Antes habia un `Math.max(ROOM_REMATCH_STRICT, configurado)` que anulaba
  // en silencio cualquier `roomRematchThreshold` por debajo de 0.85: la clave existia en
  // `fluConfig` (0.80) y no hacia nada (auditoria 2026-10-22). El fallback solo aplica si la
  // clave falta o esta fuera de rango.
  return cosineThreshold(thresholds, 'roomRematchThreshold', ROOM_REMATCH_STRICT)
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
  // Un vector VACIO o DEGENERADO (snap=0) es AUSENCIA de medida, no voz: la firma
  // jamas se mezcla con eso (mandato 2026-10-18: prohibido actualizar el ancla con
  // audio vacio; su coseno es 0 con todo y contamina el cluster entero).
  if (!next.length || !hasVoiceMeasurement(next)) return

  // Un cluster con NOMBRE PROPIO es el ancla de identidad de esa persona y su
  // firma NO se mezcla con la voz entrante. Muchas ramas (sticky/fallback)
  // etiquetan por defecto —«sigue siendo el de antes»— y llaman aquí con la voz
  // que acaba de sonar; mezclarla acercaba el ancla a esa voz turno a turno hasta
  // que cualquier otra (la TV, otro hablante) la casaba y se quedaba con el
  // nombre, arrastrando después a la sala entera. Los clusters automáticos
  // («Hablante N») sí adaptan: es lo que evita el H2 fantasma por pausa o eco.
  if (isPinnedAnchorCluster(cluster)) return

  // ANTI-CONTAMINACION (mandato 2026-10-18): el cluster es UNA voz. Si la medida entrante
  // NO casa con su firma al piso de "misma voz", es OTRA persona y no se aprende: mezclarla
  // acercaba el cluster a todas las voces de la sala y una sola etiqueta ("Hablante 1")
  // acababa representando al dueno y a la nina (defecto medido en vivo). La voz distinta
  // abre o usa SU cluster; esta no se toca.
  const priorSignature = Array.isArray(cluster?.signature) && cluster.signature.length
    ? normalizeEmbeddingVector(cluster.signature)
    : []
  if (priorSignature.length && compareCosineSignatures(priorSignature, next) < sameVoiceFloor()) return

  const stableHistory = Array.isArray(cluster?.signatureHistory)
    ? cluster.signatureHistory
      .filter((entry) => Array.isArray(entry) && entry.length)
      .map((entry) => normalizeEmbeddingVector(entry))
      .slice(-3)
    : []

  let base = priorSignature.length ? priorSignature : next

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
  // HUELLA DE ETIQUETAS: la cache valida por LONGITUD y por las etiquetas. El renombrado MUTA
  // `label` en sitio (speakerDiarization): con solo la longitud, el mapa se quedaba obsoleto y
  // el nombre nuevo no se encontraba (auditoria 2026-10-22).
  const cached = _clusterMapCache.get(speakerClusters)
  const huella = speakerClusters.map((c) => String(c?.label ?? '')).join('\u0000')
  if (cached && cached.length === speakerClusters.length && cached.huella === huella) {
    return cached.map
  }
  const map = new Map()
  for (let i = 0; i < speakerClusters.length; i++) {
    const cluster = speakerClusters[i]
    if (cluster && cluster.label != null) {
      // Clave PLEGADA (`foldSpeakerKey`): 'luis' y 'Luis' son la MISMA identidad, no
      // dos clusters (medido en el log del dueno 14:00-14:08: `['luis','Luis']`).
      map.set(foldSpeakerKey(cluster.label), cluster)
    }
  }
_clusterMapCache.set(speakerClusters, { map, length: speakerClusters.length, huella })
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
  // `learn: false` es CONTINUIDAD (conjetura temporal, no medida): NO crea ancla. Si
  // creara, tras renombrar 'Hablante 1' -> 'Luis' la continuidad volvia a crear un
  // 'Hablante 1' sin historia y la MISMA voz quedaba en dos clusters (medido en el log
  // del dueno 2026-10-18). Solo abre cluster quien aprende con medida.
  if (!learn) return null
  // PROHIBIDO crear un ancla con audio VACIO/DEGENERADO (snap=0, mandato 2026-10-18):
  // una firma sin medida casa por coseno 0 con cualquier voz y arrastra la sala entera.
  const signature = normalizeEmbeddingVector(vector)
  if (!signature.length || !hasVoiceMeasurement(signature)) return null
  const cluster = { label, signature: [...signature], signatureHistory: [[...signature]] }
  speakerClusters.push(cluster)
  return cluster
}

/**
 * SIEMBRA en la sesion las anclas de voz de la BASE de participantes.
 *
 * Medido (log del dueno 2026-10-18): la base tenia el vector de "Luis" y aun asi
 * todos sus turnos salian "Hablante 1" — la base solo se consultaba al final, en el
 * contrato (`resolveVoiceIdentity`), NUNCA en la decision de diarizacion. Con las
 * anclas sembradas, la voz conocida se resuelve por la misma regla que cualquier
 * cluster (piso de identidad registrada, `registeredVoiceFloor`) y el nombre sale en
 * el PRIMER turno sostenido.
 *
 * La sesion MANDA: si el cluster de ese nombre ya existe, no se reescribe su firma
 * (puede haber aprendido en vivo). Solo se agregan los nombres que faltan.
 *
 * @param {Array} speakerClusters clusters vivos de la sesion
 * @param {Array<{name?: string, vector?: number[], model?: string, verified?: boolean}>} anchors base de participantes
 * @param {{ model?: string }} [options] modelo vigente del embedder (un vector de OTRO
 *   modelo no es comparable y NO se siembra)
 * @returns {Array|null} clusters con las anclas, o `null` si no hubo cambios
 *
 * La marca `verified` del ancla viaja al cluster (`anchorVerified`): es la que habilita el
 * piso propio de identidad verificada en la diarizacion (`verifiedAnchorFloor`).
 */
export function seedRegisteredAnchors(speakerClusters = [], anchors = [], { model = '' } = {}) {
  if (!Array.isArray(anchors) || !anchors.length) return null
  const out = [...(Array.isArray(speakerClusters) ? speakerClusters : [])]
  let changed = false
  for (const anchor of anchors) {
    const name = canonicalSpeakerName(normalizeSpeakerLabel(anchor?.name))
    if (!name || !isProperSpeakerName(name)) continue
    // SOLO se siembra un ancla COMPARABLE: mismo modelo Y dtype. Antes una ancla SIN
    // modelo pasaba la puerta y su vector se comparaba contra el vigente (log del dueno
    // 2026-10-18: el ancla "Luis" de la base casaba a 0.44 con su propia voz y la dejaba
    // sin nombre). Un vector sin clave de modelo NO es evidencia de esta sesion.
    if (model && String(anchor?.model || '') !== String(model)) continue
    const signature = normalizeEmbeddingVector(anchor?.vector)
    if (!signature.length || !hasVoiceMeasurement(signature)) continue
    if (findClusterByLabel(out, name)) continue
    out.push({
      label: name,
      signature: [...signature],
      signatureHistory: [[...signature]],
      anchorSource: 'participant-base',
      // ANCLA VERIFICADA: el productor (`participantVoiceAnchorsForDiarization`) solo entrega
      // vectores con `voiceAnchorVerified === true`. La marca viaja al cluster para que la
      // diarizacion use SU piso (`verifiedAnchorFloor`, medido 0.629–0.714) y no el registrado
      // general (0.76), que la misma voz no alcanza entre sesiones.
      anchorVerified: anchor?.verified === true,
    })
    changed = true
  }
  return changed ? out : null
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
    // Un NOMBRE PROPIO (ancla de identidad registrada) NUNCA se estampa desde una
    // ventana CORTA: el piso 0.70 es la banda de REUTILIZACION, no la de identidad
    // REGISTRADA (0.76). Medido (debug.log 16:50:34): 0.741 contra el ancla "Luis"
    // renombraba la voz de la mujer. (Mandato 2026-10-18.)
    if (isRegisteredSpeakerLabel(label)) continue
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
  // Un NOMBRE PROPIO no se hereda por continuidad de frase CORTA: la continuidad
  // (piso 0.72) no es la identidad REGISTRADA (0.76). (Mandato 2026-10-18.)
  if (isRegisteredSpeakerLabel(speaker)) return null

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

/**
 * Copia un cluster con la etiqueta NUEVA, sin arrastrar el id de voz viejo.
 * - `speakerId` se DERIVA de la etiqueta (`ensureClusterSpeakerId`). Conservarlo deja
 *   el cluster renombrado con `speaker_1` y a la vez la etiqueta nueva `Hablante 1`
 *   con `speaker_1`: `resolveSpeakerNameFromId` devuelve el PRIMERO y la voz de otra
 *   persona salia como "Luis" (medido en el log del dueno 2026-10-18).
 * - `autoNumber` conserva el numero automatico para que el SIGUIENTE hablante
 *   incremente 1 y no recicle el numero de quien paso a nombre propio.
 * @param {object} cluster
 * @param {string} label
 * @returns {object}
 */
function renamedCluster(cluster, label) {
  const index = parseSpeakerIndex(cluster?.label)
  const autoNumber = index != null ? index : Number(cluster?.autoNumber) || 0
  const next = { ...cluster, label }
  delete next.speakerId
  if (autoNumber > 0) next.autoNumber = autoNumber
  return next
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
    const out = []
    for (const cluster of speakerClusters) {
      if (foldSpeakerKey(cluster?.label) !== foldSpeakerKey(from)) {
        out.push(cluster)
        continue
      }
      // El duplicado plegado del mismo `from` se absorbe en la fila renombrada.
      if (cluster === source) out.push(renamedCluster(cluster, to))
    }
    return out
  }
  // El destino YA existe: absorber el origen SOLO si es la MISMA VOZ. Un cluster de
  // OTRA voz no se borra: son dos personas distintas (medido en el log del dueno
  // 2026-10-18: el renombre elimino el cluster de la voz que hablaba y dejo solo el
  // ancla "Luis", asi que despues ninguna comparacion casaba con esa voz).
  const sameVoice =
    Array.isArray(source.signature) &&
    source.signature.length > 0 &&
    Array.isArray(target.signature) &&
    target.signature.length > 0 &&
    compareCosineSignatures(source.signature, target.signature) >= sameVoiceFloor()
  if (!sameVoice) return speakerClusters
  const out = []
  for (const cluster of speakerClusters) {
    if (cluster === source) continue
    if (cluster === target) {
      // `updateClusterSignature` respeta el ancla con nombre propio: el nombre no se
      // contamina, pero el cluster automatico de la misma voz si aprende.
      updateClusterSignature(cluster, source.signature)
      // El indice de la etiqueta automatica sobrevive al renombre (mandato 2026-10-18:
      // "voz nueva incrementa 1 en hablante(N)... no se incrementan arbitrariamente").
      // Se toma del `autoNumber` YA guardado o, si el cluster nunca paso por
      // `renamedCluster`, del propio rotulo ("Hablante 3" -> 3). Sin esto, fusionar el
      // cluster de una voz con su ancla liberaba el numero y la voz SIGUIENTE lo
      // reciclaba.
      const sourceIndex = parseSpeakerIndex(source.label)
      const carried = Math.max(sourceIndex != null ? sourceIndex : 0, Number(source.autoNumber) || 0)
      if (carried > (Number(cluster.autoNumber) || 0)) cluster.autoNumber = carried
    }
    out.push(cluster)
  }
  return out
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
