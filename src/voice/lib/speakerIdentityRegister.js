/**
 * DUENO UNICO del REGISTRO de un nombre propio para la VOZ activa (A1).
 *
 * QUE ES "REGISTRAR EL NOMBRE": cuando una voz dice su nombre ("okay flu soy Luz"),
 * el nombre queda pegado a ESA VOZ en el directorio de la sesion. NO reescribe
 * filas ya escritas: la etiqueta de cada fila la resuelve el modulo CONVERSACION
 * al cerrar su locucion (mandato 2026-10-26, un solo dueno de la fila).
 *
 * RUTA DOBLE MEDIDA (2026-10-10): el registro estaba implementado DOS veces
 *   - src/voice/hooks/useFluVoiceAssistant.js (resolucion tardia del hablante)
 *   - la ruta `wake-intro` del commit (RETIRADA al cortar la tuberia vieja de
 *     conversacion, 2026-10-25)
 * y el comando `REGISTRAR_PARTICIPANTE` -producido en audioMath.js con el nombre
 * introducido- NO tenia consumidor: `handleNavigationCommand` no traia caso para el,
 * asi que decia "Registrado {name}." SIN registrar nada. Tres caminos, dos copias y
 * la del comando muerta.
 *
 * AHORA: las dos vias vivas (el hook y el comando) llaman AQUI. Aportan la evidencia
 * que tienen (el hook, ademas, los clusters para unir etiquetas de la MISMA voz); el
 * dueño decide una sola vez. El detector del nombre tambien es unico
 * (`resolveSpeakerNameFromUtterance`, que exige wake segun config): el comando no
 * reimplementa "soy <nombre>".
 *
 * DOS OPERACIONES, UN DUENO (mandato del dueno 2026-10-19):
 *   - `registerSpeakerIdentity`: alguien DICE su nombre. Afirma identidad con la medida
 *     del turno (base, directorio, clusters, primario).
 *   - `applyKnownVoiceName`: la VOZ mide contra una identidad YA CONOCIDA. Aplica ese
 *     nombre sin afirmar nada nuevo (ni base, ni ancla del turno, ni clusters, ni primario).
 *
 * NO hace: escribir el hablante primario de la sesion (lo hace su dueño,
 * `setSessionPrimarySpeaker`, con la precedencia declarada). Aqui solo se registra el
 * nombre sobre las filas y el alias.
 */
import { resolveSpeakerNameFromUtterance } from './speakerPolicy.js'
import { isProperSpeakerName, normalizeSpeakerLabel } from './voiceIdentity.js'
import { canonicalSpeakerName } from './speakerLabels.js'
import { findClusterByLabel, findLabelsWithSharedVoice, findNearestCluster, mergeSpeakerClustersOnRename, sameVoiceFloor } from "./speakerClusters.js"
import { registerVoiceName, voiceKeyFor } from './speakerDirectory.js'
import { labelToSpeakerId } from './conversationRow.js'
import { compareCosineSignatures, hasVoiceMeasurement, isAutoSpeakerLabel, normalizeEmbeddingVector } from './speakerCore.js'
import { setSessionPrimarySpeaker } from './sessionPrimarySpeaker.js'
import { voiceProbe } from './voiceProbe'
import { getLastCompletedSpeechAt } from './fluSpeech.js'
import { FLU_CONFIG } from './fluConfig.js'

/**
 * Ventana (ms) del eco ASR ya commiteado: la MISMA frase re-emitida DENTRO de esta ventana es
 * el MISMO evento (doble final / loop de Chrome), NO habla nueva; pasada la ventana, la
 * repeticion es genuina. DUENO UNICO del criterio (antes eran 3 copias del mismo literal).
 * Vive aqui por ser su unico consumidor (el eco de identidad), tras la retirada de
 * activeListen.js (tuberia vieja de conversacion).
 *
 * @returns {number} ms
 */
export function committedEchoStreakWindowMs() {
  return Number(FLU_CONFIG?.voiceIdentity?.capture?.committedEchoStreakWindowMs) || 1200
}

/**
 * Registra un nombre propio para la VOZ activa. DUENO UNICO del nombre (mandato del dueno
 * 2026-10-13): el nombre se pega a la VOZ en el DIRECTORIO (`registerVoiceName`) y NO se
 * toca ninguna fila (la conversacion es texto insertado; el nombre se resuelve al MOSTRAR).
 * Ademas: la voz entra en la BASE de participantes con su nombre y su VECTOR, y queda fijada
 * como hablante PRIMARIO de la sesion.
 *
 * El primario se fija con fuente "presented" por defecto: es la voz DICIENDO su nombre,
 * y la precedencia declarada de `setSessionPrimarySpeaker` (presented > participant >
 * resolved) hace que mande sobre el sembrado del panel. Con "resolved" (relleno) los
 * turnos siguientes seguian cayendo a "Hablante N".
 *
 * @param {object} params
 * @param {string} params.name Nombre propio detectado en el enunciado.
 * @param {Array} [params.clusters] Clusters de hablante (evidencia de voces): sin ellos
 *   no se cosen las etiquetas de la MISMA voz re-clusterizada ("Hablante 3"/"4").
 * @param {string} [params.previousLabel] Etiqueta con la que esa voz venia apareciendo
 *   (solo se usa cuando NO hay voz medida; es una conjetura de continuidad).
 * @param {number[]|null} [params.signatureVector] Vector MEDIDO del turno que dice el
 *   nombre. Es la evidencia que ata el nombre a la VOZ correcta.
 * @param {{ sessionPrimarySpeakerRef?: { current: string }, setClusters?: (clusters: unknown[]) => void, registerParticipant?: (name: string, speakerLabel?: string, voiceVector?: number[] | null) => void | Promise<unknown> }} [params.refs] Refs de sesion
 *   (el dueno de la precedencia decide si escribe).
 * @param {"presented"|"participant"|"resolved"} [params.source] Fuente del primario.
 * @returns {{ registered: boolean, name: string, labels: string[], rowsChanged: number, primarySet: boolean }}
 */
export function registerSpeakerIdentity({
  name,
  clusters = [],
  previousLabel = "",
  signatureVector = null,
  refs = null,
  source = "presented",
} = {}) {
  // P9.78: UNA grafia. El nombre entra canonico (inicial en mayuscula) para que la fila,
  // el alias y la base no partan la MISMA identidad en "luis"/"Luis".
  const clean = canonicalSpeakerName(normalizeSpeakerLabel(name))
  if (!clean || !isProperSpeakerName(clean)) {
    return { registered: false, name: "", labels: [], rowsChanged: 0, primarySet: false }
  }
  // ECO DEL TTS: el final del habla de FLU vuelve por el microfono y el ASR puede
  // formar "soy <nombre>" con esa cola. Esa cola NO es una presentacion de la
  // persona: no puede afirmar identidad ni re-anclar la base. El dueno de la
  // ventana es el mismo del eco de filas (`committedEchoStreakWindowMs`). El turno
  // ORIGINAL (el que dispara la respuesta) se registra antes de que el TTS termine,
  // asi que no cae en esta ventana.
  const lastSpeechAt = getLastCompletedSpeechAt()
  const echoAgeMs = lastSpeechAt > 0 ? Date.now() - lastSpeechAt : Number.POSITIVE_INFINITY
  if (echoAgeMs >= 0 && echoAgeMs < committedEchoStreakWindowMs()) {
    voiceProbe('identity-register-skip', {
      name: clean,
      reason: 'tts-echo-window',
      ageMs: echoAgeMs,
      windowMs: committedEchoStreakWindowMs(),
    })
    return { registered: false, name: clean, labels: [], rowsChanged: 0, primarySet: false }
  }
  const measured =
    Array.isArray(signatureVector) && signatureVector.length && hasVoiceMeasurement(signatureVector)
      ? signatureVector
      : null
  // La VOZ que dice el nombre es la del TURNO, MEDIDA. Antes el ancla era la etiqueta
  // con la que "venia apareciendo" el ultimo hablante (`previousLabel` por continuidad),
  // que puede ser OTRA persona (la TV): el nombre se pegaba a ese cluster y la voz real
  // seguia generica (defecto medido 2026-10-18: "okay flu soy Luis" sobre el turno de la
  // TV y despues "le quito Luis" a las filas del dueno).
  const nearest = measured ? findNearestCluster(measured, clusters) : null
  const measuredCluster =
    nearest && nearest.nearestSimilarity >= sameVoiceFloor() ? nearest.nearestCluster : null
  // La VOZ agrupa sus etiquetas por FIRMA: el ancla es la etiqueta de ESA voz.
  const anchor = normalizeSpeakerLabel(measuredCluster?.label || previousLabel)
  // TODAS las etiquetas de ESA voz: la diarizacion puede partir la MISMA voz en dos
  // etiquetas ('Hablante 1' y 'Hablante 3', defecto 4 del dueno 2026-10-18). El grupo
  // por firma lo decide el dueno de los clusters, no este modulo.
  const etiquetasDeLaVoz = findLabelsWithSharedVoice(clusters, anchor)
  // EVIDENCIA para afirmar el nombre: la MEDIDA del turno, o una etiqueta AUTOMATICA
  // (continuidad). Una etiqueta con NOMBRE PROPIO es OTRA persona: sin medida no se
  // toca (el "Luis pegado a la TV" medido por el dueno).
  const hayEvidencia = Boolean(measured) || isAutoSpeakerLabel(anchor)
  // El GRUPO de etiquetas solo se cose cuando la etiqueta ancla tiene evidencia propia:
  // la voz MEDIDA (su cluster reconocido por timbre) o la CONTINUIDAD de una etiqueta
  // automatica. Con una medida que no reconoce al ancla, la etiqueta es solo una
  // conjetura: se congelan SUS filas por clave, pero no se arrastra a las de al lado.
  const evidenciaDeEtiqueta = Boolean(measuredCluster) || (!measured && isAutoSpeakerLabel(anchor))
  // MANDATO DEL DUENO (2026-10-18): la comparacion es sobre VECTORES. El UNICO vector
  // que puede anclar la identidad en el DIRECTORIO y en la BASE es el MEDIDO en el
  // turno. La firma de un cluster es una conjetura de agrupacion (puede ser la voz de
  // al lado: la mujer salia "Luis"): solo sirve para RECONOCER filas, nunca para
  // afirmar quien es la voz.
  const vectorDeLaVoz = measured
  const voiceId = hayEvidencia
    ? voiceKeyFor({ voiceId: labelToSpeakerId(anchor || clean), signature: vectorDeLaVoz })
    : ''
  if (voiceId && vectorDeLaVoz) registerVoiceName(voiceId, clean, { vector: vectorDeLaVoz })
  // FREEZE (mandato del dueno 2026-10-17): toda la participacion YA MOSTRADA de esa voz pasa a
  // llevar el nombre, ESCRITO en la fila (no se re-resuelve desde el directorio). La VOZ se
  // reconoce por su TIMBRE, no solo por la clave de la etiqueta: las filas anteriores pueden
  // tener una clave reciclada y antes el nombre solo cambiaba la ULTIMA intervencion (defecto
  // medido por el dueno 2026-10-18). Se prueban TODAS las medidas de ESA voz: la del turno y
  // las firmas/historial de las etiquetas del grupo (una medida cruda puede no casar y las
  // demas si). Las firmas de cluster reconocen filas; NO anclan la identidad.
  const clustersDeLaVoz = clusters.filter((cluster) =>
    etiquetasDeLaVoz.some((label) => label === normalizeSpeakerLabel(cluster?.label)),
  )
  const voiceSignatures = [
    measured,
    ...clustersDeLaVoz.flatMap((cluster) => [
      cluster?.signature,
      ...(Array.isArray(cluster?.signatureHistory) ? cluster.signatureHistory : []),
    ]),
  ].filter((sig) => Array.isArray(sig) && sig.length && hasVoiceMeasurement(sig))
  // NINGUNA fila se reescribe aqui (mandato 2026-10-26). El nombre se liga a la VOZ en
  // el DIRECTORIO y la etiqueta de cada fila la resuelve el modulo CONVERSACION al
  // cerrar su locucion. Renombrar filas ya escritas era la ruta doble retirada.
  const rowsChanged = 0
  // El nombre queda tambien en el CLUSTER de ESA voz (dato de la voz) para el cosido de los
  // turnos siguientes por firma. Copia: la publica el escritor unico de clusters.
  let clustersRenombrados = clusters.map((c) => ({ ...c }))
  if (evidenciaDeEtiqueta && etiquetasDeLaVoz.length) {
    // Renombra/absorbe las etiquetas de la MISMA voz (medida o continuidad automatica).
    // Nunca el cluster de una etiqueta con NOMBRE PROPIO sin medida (otra persona).
    for (const label of etiquetasDeLaVoz) {
      if (label !== clean) {
        clustersRenombrados = mergeSpeakerClustersOnRename(clustersRenombrados, label, clean)
      }
    }
  }
  if (!findClusterByLabel(clustersRenombrados, clean)) {
    // Voz nueva que dice su nombre: su cluster nace con la medida del turno. Sin medida
    // NO se crea ancla (un vector vacio casa por coseno 0 con toda la sala).
    if (measured && hasVoiceMeasurement(measured)) {
      clustersRenombrados.push({
        label: clean,
        signature: [...measured],
        signatureHistory: [[...measured]],
      })
    }
  }
  // MARCA VERIFICADA (medido d4c1c8f3): el cluster del NOMBRE solo se marca si su firma
  // ES la voz medida del turno (la MISMA que afirmo "soy X"). La afirmacion del titular
  // con su medida fresca ES la verificacion del ancla: habilita el piso verificado
  // (`verifiedAnchorFloor`) en la diarizacion (la banda del dueno, 0.629-0.714, no pasa
  // el piso registrado 0.76). Un cluster con firma ajena (la mujer pegada a "Luis",
  // coseno 0.495) NO se marca ni por renombre ni por continuidad.
  if (measured) {
    const marcado = findClusterByLabel(clustersRenombrados, clean)
    if (
      marcado &&
      Array.isArray(marcado.signature) &&
      marcado.signature.length &&
      compareCosineSignatures(measured, marcado.signature) >= sameVoiceFloor()
    ) {
      marcado.anchorVerified = true
    }
  }
  if (typeof refs?.setClusters === "function") refs.setClusters(clustersRenombrados)
  const primarySet = setSessionPrimarySpeaker(refs?.sessionPrimarySpeakerRef, clean, source)
  // La VOZ que dice su nombre ENTRA en la BASE de participantes con su NOMBRE y su VECTOR.
  // MANDATO (2026-10-18): la base guarda la evidencia MEDIDA; sin vector no se escribe nada
  // (un nombre sin numero es basura y sembraba identidades ajenas). La ruta del comando, la
  // del commit y la de la resolucion tardia comparten este unico escritor.
  const vectorParaLaBase = measured && hasVoiceMeasurement(measured) ? measured : null
  if (vectorParaLaBase && typeof refs?.registerParticipant === "function") {
    refs.registerParticipant(clean, clean, vectorParaLaBase)
  }
  voiceProbe('identity-register', {
    name: clean,
    anchor: anchor || '',
    turnMeasured: measured ? measured.length : 0,
    baseVector: vectorParaLaBase ? vectorParaLaBase.length : 0,
    signatures: voiceSignatures.length,
    rows: rowsChanged,
    clusters: clustersRenombrados.length,
    registeredInBase: Boolean(vectorParaLaBase && refs?.registerParticipant),
  })
  return { registered: true, name: clean, labels: etiquetasDeLaVoz.filter(Boolean), rowsChanged, primarySet }
}

/**
 * APLICA un nombre YA CONOCIDO a la VOZ de un turno: RECONOCIMIENTO, no registro.
 *
 * Cuando el vector medido del turno casa con una identidad CONOCIDA (directorio de la
 * sesion o base de participantes), la voz YA es esa persona: el nombre se aplica al
 * directorio (no a las filas ya escritas). NO se afirma nada nuevo:
 *   - la BASE no se escribe (la identidad ya estaba alli);
 *   - el DIRECTORIO no se re-ancla con el vector del TURNO: el ancla es el vector
 *     CONOCIDO que hizo el match (una ventana contaminada no puede envenenar la identidad);
 *   - los CLUSTERS no se renombran ni fusionan (reconocer no decide agrupaciones);
 *   - el hablante PRIMARIO no se fija (nadie se presento en este turno).
 *
 * DEFECTO MEDIDO (log del dueno 2026-10-19): esta ruta llamaba a `registerSpeakerIdentity`
 * y escribia la base/directorio con la medida del turno. La voz de la mujer, reconocida por
 * error con una ventana contaminada (`Luis 0.799`), reescribio la base y su cluster
 * (`identity-register {"name":"Luis","anchor":"Hablante 2","baseVector":512}`) y sus filas
 * siguientes salieron "Luis" aunque su medida ya fuera `Hablante 2 0.971 / Luis 0.49`.
 *
 * @param {object} params
 * @param {string} params.name Identidad conocida (base/sesion) que caso con la VOZ.
 * @param {string} [params.previousLabel] Etiqueta de diarizacion del turno (clave provisional).
 * @param {number[]|null} params.anchorVector Vector CONOCIDO de la identidad (ancla del match);
 *   NUNCA la medida del turno. Sin vector no se aplica nada (coseno 0 con toda la sala).
 * @returns {{ registered: boolean, name: string, voiceId: string, rowsChanged: number }}
 */
export function applyKnownVoiceName({
  name,
  previousLabel = '',
  anchorVector = null,
} = {}) {
  const clean = canonicalSpeakerName(normalizeSpeakerLabel(name))
  const ancla = normalizeEmbeddingVector(Array.isArray(anchorVector) ? anchorVector : [])
  if (!clean || !isProperSpeakerName(clean) || !hasVoiceMeasurement(ancla)) {
    return { registered: false, name: '', voiceId: '', rowsChanged: 0 }
  }
  const label = normalizeSpeakerLabel(previousLabel)
  // La clave es la de la VOZ (timbre), no la de la etiqueta: `voiceKeyFor` consulta el
  // directorio y, si la voz es nueva en la sesion, liga el ANCLA a su clave provisional.
  const voiceId = voiceKeyFor({ voiceId: labelToSpeakerId(label || clean), signature: ancla })
  if (!voiceId) return { registered: false, name: '', voiceId: '', rowsChanged: 0 }
  registerVoiceName(voiceId, clean, { vector: ancla })
  // Reconocer NO reescribe filas ya escritas: el nombre queda en el directorio de la VOZ
  // y el modulo CONVERSACION etiqueta las locuciones siguientes (mandato 2026-10-26).
  const rowsChanged = 0
  voiceProbe('identity-recognized', {
    name: clean,
    label,
    voice: voiceId,
    rows: rowsChanged,
  })
  return { registered: true, name: clean, voiceId, rowsChanged }
}

/**
 * Puerto `registerParticipant` de la sesion para `registerSpeakerIdentity`.
 *
 * DUENO UNICO de la forma del puerto: la base de participantes se re-ancla por la
 * MISMA via en TODAS las rutas de "soy X" (resolucion tardia del hook y commit). Sin
 * puerto devuelve `undefined`: el registro solo escribe la base con vector medido y
 * puerto; un nombre sin vector es basura (mandato del dueno 2026-10-18).
 *
 * @param {{ current?: { registerParticipant?: (name: string, speakerLabel?: string, voiceVector?: number[] | null) => void | Promise<unknown> } } | null} identitySession
 * @returns {((name: string, speakerLabel?: string, voiceVector?: number[] | null) => void | Promise<unknown>) | undefined}
 */
export function participantRegisterPort(identitySession) {
  if (typeof identitySession?.current?.registerParticipant !== 'function') return undefined
  return (name, speakerLabel, voiceVector) =>
    identitySession.current.registerParticipant(name, speakerLabel, voiceVector)
}

/**
 * RUTA UNICA del comando de voz `REGISTRAR_PARTICIPANTE`: el mismo registro que la
 * ruta `wake-intro` del commit, con el mismo detector de nombre y la MISMA evidencia
 * (clusters vivos de la sesion + ref del primario). Antes el comando no tenia
 * consumidor en `handleNavigationCommand` y el nombre solo se registraba por el
 * efecto colateral del commit.
 *
 * @param {object} params
 * @param {string} params.transcript Enunciado completo (con wake: "okay flu soy Luz").
 * @param {string} [params.speakerName] Etiqueta con la que venia apareciendo esa voz.
 * @param {number[]|null} [params.signatureVector] Vector MEDIDO del turno, si el
 *   llamador lo tiene: ata el nombre a la voz real (no a la etiqueta heredada).
 * @param {Array} [params.clusters] Clusters vivos de la sesion (cosido de la misma voz).
 * @param {{ sessionPrimarySpeakerRef?: { current: string }, setClusters?: (clusters: unknown[]) => void, registerParticipant?: (name: string, speakerLabel?: string, voiceVector?: number[] | null) => void | Promise<unknown> }} [params.refs] Refs de sesion.
 * @returns {ReturnType<typeof registerSpeakerIdentity>}
 */
export function registerSpeakerIdentityFromCommand({
  transcript = "",
  speakerName = "",
  signatureVector = null,
  clusters = [],
  refs = null,
} = {}) {
  return registerSpeakerIdentity({
    name: resolveSpeakerNameFromUtterance(transcript),
    previousLabel: speakerName,
    signatureVector,
    clusters,
    refs,
  })
}
