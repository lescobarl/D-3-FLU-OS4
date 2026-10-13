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
import { findClusterByLabel, findLabelsWithSharedVoice, mergeSpeakerClustersOnRename, sameVoiceFloor } from './speakerClusters.js'
import { renameSpeakerRows, setSpeakerLabelAlias, labelsAliasedTo } from './conversationTurnRow'
import { setSessionPrimarySpeaker } from './sessionPrimarySpeaker.js'

/**
 * Registra un nombre propio para la voz activa: alias de sesion + renombrado de las
 * filas de la MISMA voz + hablante PRIMARIO de la sesion.
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
 * @param {{ sessionPrimarySpeakerRef?: { current: string }, setClusters?: (clusters: unknown[]) => void, registerParticipant?: (name: string, speakerLabel?: string) => void | Promise<unknown> }} [params.refs] Refs de sesion
 *   (el dueno de la precedencia decide si escribe).
 * @param {"presented"|"participant"|"resolved"} [params.source] Fuente del primario.
 * @param {(labels: string[], toName: string) => number} [params.rename] Escritor de
 *   filas (inyectado; por defecto el dueno unico `renameSpeakerRows`).
 * @returns {{ registered: boolean, name: string, labels: string[], rowsChanged: number, primarySet: boolean }}
 */
export function registerSpeakerIdentity({
  name,
  clusters = [],
  previousLabel = "",
  refs = null,
  source = "presented",
  rename = renameSpeakerRows,
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
  // SUSTITUIR A LA PERSONA, no dar de alta una identidad nueva (spec del dueno 2026-10-11:
  // "a todo lo que tenia Luis o Hablante X lo debia haber sustituido ... no dar de alta uno
  // nuevo sino sustituir a esa persona"). Entra la etiqueta del PRIMARIO/PARTICIPANTE: es un
  // DATO de la persona, no una medida. Medido 2026-10-11 01:21:57: el renombre solo alcanzo la
  // etiqueta de ese turno ("Juan") y las filas anteriores ("Hablante 1") y las del participante
  // ("luis") se quedaron como estaban (el cosido por firma no las alcanza: la misma voz midio
  // bestSim 0.476 frente a "luis").
  const personLabels = [normalizeSpeakerLabel(refs?.sessionPrimarySpeakerRef?.current || '')]
  const labels = [
    ...new Set(
      [
        anchor,
        ...personLabels,
        // PISO ESTRICTO (el de REUTILIZACION, 0.66): el cosido permisivo metia voces distintas
        // (la banda de voz DISTINTA medida es 0.58).
        ...findLabelsWithSharedVoice(clusters, anchor, sameVoiceFloor()),
        ...findLabelsWithSharedVoice(clusters, clean, sameVoiceFloor()),
        // Y las etiquetas que YA sabemos de ESA voz (su alias apunta a este nombre): son las
        // filas que se escribieron con su etiqueta provisional antes de decir su nombre.
        ...labelsAliasedTo(clean),
      ].filter(Boolean),
    ),
  ]
  // Ancla de la VOZ para el renombre por FIRMA: la del cluster de la etiqueta previa (o la del
  // nombre). Sin firma, el renombre solo alcanza etiquetas vivas.
  const clusterAncla = findClusterByLabel(clusters, clean) || findClusterByLabel(clusters, anchor)
  // El NOMBRE queda tambien en la ETIQUETA de esa voz (alias de sesion): los turnos
  // siguientes de la misma voz, SIN ventana de audio medida, llevan el nombre en vez de su
  // etiqueta provisional. Dueno unico del alias: este registro (no hay mapa global).
  labels.forEach((label) => setSpeakerLabelAlias(label, clean))
  const rowsChanged = typeof rename === "function" ? rename(labels, clean, { anchorSignature: clusterAncla?.signature || null }) : 0
  // El nombre queda en el CLUSTER de ESA VOZ (un dato: la voz), no en un mapa de
  // etiquetas: los turnos siguientes lo resuelven por FIRMA. Se trabaja sobre una
  // COPIA y la entrega el escritor unico de clusters (`refs.setClusters`).
  const clustersRenombrados = labels.reduce(
    (acc, label) => mergeSpeakerClustersOnRename(acc, label, clean),
    clusters.map((c) => ({ ...c })),
  )
  if (typeof refs?.setClusters === "function") refs.setClusters(clustersRenombrados)
  const primarySet = setSessionPrimarySpeaker(refs?.sessionPrimarySpeakerRef, clean, source)
  // P9.79: la VOZ que dice su nombre ENTRA en la BASE de participantes (puerto inyectado
  // por la app). Antes el nombre quedaba ligado a las filas y el panel, que lee Dexie, no
  // lo mostraba ("si hay una base de participantes debe de aparecer a la derecha"). El
  // nombre que entra es el CANONICO del registro: UNA grafia para fila, alias y base.
  // El puerto avisa de sus fallos (no se silencian aqui).
  if (typeof refs?.registerParticipant === "function") refs.registerParticipant(clean, clean)
  return { registered: true, name: clean, labels, rowsChanged, primarySet }
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
