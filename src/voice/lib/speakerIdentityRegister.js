/**
 * DUENO UNICO del REGISTRO de un nombre propio para la VOZ activa (A1).
 *
 * QUE ES "REGISTRAR EL NOMBRE": cuando una voz dice su nombre ("okay flu soy Luz"),
 * el nombre debe quedar pegado a ESA voz: (a) las filas que esa voz ya venia
 * escribiendo con su etiqueta automatica ('Hablante N') pasan a llevar el nombre, y
 * (b) la etiqueta queda registrada como alias de sesion, para las filas siguientes.
 *
 * RUTA DOBLE MEDIDA (2026-10-10): el registro estaba implementado DOS veces
 *   - src/voice/hooks/useFluVoiceAssistant.js (resolucion tardia del hablante)
 *   - src/voice/lib/turnSpeakerCommit.js     (ruta `wake-intro` del commit)
 * y el comando `REGISTRAR_PARTICIPANTE` -producido en audioMath.js con el nombre
 * introducido- NO tenia consumidor: `handleNavigationCommand` no traia caso para el,
 * asi que decia "Registrado {name}." SIN registrar nada. Tres caminos, dos copias y
 * la del comando muerta.
 *
 * AHORA: las tres vias llaman AQUI. El commit y el comando aportan la evidencia que
 * tienen (el commit, ademas, los clusters para unir etiquetas de la MISMA voz); el
 * dueño decide una sola vez. El detector del nombre tambien es unico
 * (`resolveSpeakerNameFromUtterance`, que exige wake segun config): el comando no
 * reimplementa "soy <nombre>".
 *
 * NO hace: escribir el hablante primario de la sesion (lo hace su dueño,
 * `setSessionPrimarySpeaker`, con la precedencia declarada). Aqui solo se registra el
 * nombre sobre las filas y el alias.
 */
import { resolveSpeakerNameFromUtterance } from './speakerPolicy.js'
import { isProperSpeakerName, normalizeSpeakerLabel } from './voiceIdentity.js'
import { canonicalSpeakerName } from './speakerLabels.js'
import { findClusterByLabel, mergeSpeakerClustersOnRename } from "./speakerClusters.js"
import { registerVoiceName, voiceKeyFor } from './speakerDirectory.js'
import { labelToSpeakerId } from './conversationRow.js'
import { freezeVoiceName } from './conversationTurnRow'
import { setSessionPrimarySpeaker } from './sessionPrimarySpeaker.js'

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
 * @param {string} [params.previousLabel] Etiqueta con la que esa voz venia apareciendo.
 * @param {{ sessionPrimarySpeakerRef?: { current: string }, setClusters?: (clusters: unknown[]) => void, registerParticipant?: (name: string, speakerLabel?: string, voiceVector?: number[] | null) => void | Promise<unknown> }} [params.refs] Refs de sesion
 *   (el dueno de la precedencia decide si escribe).
 * @param {"presented"|"participant"|"resolved"} [params.source] Fuente del primario.
 * @param {(labels: string[], toName: string) => number} [params.rename] Escritor de
 * @returns {{ registered: boolean, name: string, labels: string[], rowsChanged: number, primarySet: boolean }}
 */
export function registerSpeakerIdentity({
  name,
  clusters = [],
  previousLabel = "",
  refs = null,
  source = "presented",
} = {}) {
  // P9.78: UNA grafia. El nombre entra canonico (inicial en mayuscula) para que la fila,
  // el alias y la base no partan la MISMA identidad en "luis"/"Luis".
  const clean = canonicalSpeakerName(normalizeSpeakerLabel(name))
  if (!clean || !isProperSpeakerName(clean)) {
    return { registered: false, name: "", labels: [], rowsChanged: 0, primarySet: false }
  }
  // La VOZ agrupa sus etiquetas por FIRMA: el ancla es la ETIQUETA con la que esa voz venia
  // apareciendo (`previousLabel`), no el nombre (que aun no esta en ningun cluster). Antes se
  // anclaba en `clean`, asi que solo se renombraba ESA etiqueta y los demas turnos de la misma
  // voz (re-clusterizada como Hablante 2/3) quedaban genericos.
  const anchor = normalizeSpeakerLabel(previousLabel)
  // El TIMBRE de ESA voz (el vector de su cluster): es su IDENTIDAD.
  const clusterDeLaVoz = findClusterByLabel(clusters, anchor) || findClusterByLabel(clusters, clean)
  const vectorDeLaVoz = Array.isArray(clusterDeLaVoz?.signature) ? clusterDeLaVoz.signature : null
  // UN DUENO DEL NOMBRE (mandato del dueno 2026-10-13): el nombre se pega a la VOZ en el
  // DIRECTORIO y no se reescribe NINGUNA fila (la conversacion es texto insertado). La clave
  // es el TIMBRE cuando se midio: el mismo timbre da la misma voz aunque cambie su etiqueta.
  const voiceId = voiceKeyFor({ voiceId: labelToSpeakerId(anchor || clean), signature: vectorDeLaVoz })
  registerVoiceName(voiceId, clean, { vector: vectorDeLaVoz })
  // FREEZE (mandato del dueno 2026-10-17): toda la participacion YA MOSTRADA de esa voz pasa a
  // llevar el nombre, ESCRITO en la fila (no se re-resuelve desde el directorio). Solo las filas
  // con etiqueta escrita; una voz distinta que reutilice la clave no se pinta.
  const rowsChanged = freezeVoiceName(voiceId, clean)
  // El nombre queda tambien en el CLUSTER de ESA voz (dato de la voz) para el cosido de los
  // turnos siguientes por firma. Copia: la publica el escritor unico de clusters.
  const clustersRenombrados = mergeSpeakerClustersOnRename(clusters.map((c) => ({ ...c })), anchor, clean)
  if (typeof refs?.setClusters === "function") refs.setClusters(clustersRenombrados)
  const primarySet = setSessionPrimarySpeaker(refs?.sessionPrimarySpeakerRef, clean, source)
  // La VOZ que dice su nombre ENTRA en la BASE de participantes con su NOMBRE y su VECTOR.
  if (typeof refs?.registerParticipant === "function") refs.registerParticipant(clean, clean, vectorDeLaVoz)
  return { registered: true, name: clean, labels: [anchor].filter(Boolean), rowsChanged, primarySet }
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
 * @param {Array} [params.clusters] Clusters vivos de la sesion (cosido de la misma voz).
 * @param {{ sessionPrimarySpeakerRef?: { current: string }, setClusters?: (clusters: unknown[]) => void, registerParticipant?: (name: string, speakerLabel?: string) => void | Promise<unknown> }} [params.refs] Refs de sesion.
 * @returns {ReturnType<typeof registerSpeakerIdentity>}
 */
export function registerSpeakerIdentityFromCommand({
  transcript = "",
  speakerName = "",
  clusters = [],
  refs = null,
} = {}) {
  return registerSpeakerIdentity({
    name: resolveSpeakerNameFromUtterance(transcript),
    previousLabel: speakerName,
    clusters,
    refs,
  })
}
