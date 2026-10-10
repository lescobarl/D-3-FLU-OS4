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
import { findLabelsWithSharedVoice } from './speakerClusters.js'
import { renameSpeakerRows } from './conversationTurnRow'
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
 * @param {{ sessionPrimarySpeakerRef?: { current: string } }} [params.refs] Refs de sesion
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
  const clean = normalizeSpeakerLabel(name)
  if (!clean || !isProperSpeakerName(clean)) {
    return { registered: false, name: "", labels: [], rowsChanged: 0, primarySet: false }
  }
  const labels = [
    ...new Set(
      [normalizeSpeakerLabel(previousLabel), ...findLabelsWithSharedVoice(clusters, clean)].filter(Boolean),
    ),
  ]
  const rowsChanged = typeof rename === "function" ? rename(labels, clean) : 0
  const primarySet = setSessionPrimarySpeaker(refs?.sessionPrimarySpeakerRef, clean, source)
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
 * @param {{ sessionPrimarySpeakerRef?: { current: string } }} [params.refs] Refs de sesion.
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
