import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Dueño único de la medición de una grabación de conversación.
 *
 * Lee `events.ndjson` y `turns.ndjson` (formato redactado de la grabación real
 * `14c1aa32`: se conservan tiempos, longitudes, hashes, turnId, hablante y
 * motivos; el texto y los vectores de voz no se versionan) y devuelve las
 * métricas que congela `scripts/conversacion-grabacion-baseline.json`.
 *
 * No decide producto: solo cuenta hechos medibles. El único consumidor es
 * `tests/conversacionGrabacionGuard.test.ts`.
 */

/** Milisegundos de la ventana de stall de conversación (`fluConfig.js:305`). */
const STALL_MS_DEFECTO = 4200

/**
 * Normaliza un texto para comparar contenido sin depender de espacios.
 * @param {unknown} texto Texto de la fila o del final.
 * @returns {string} Texto normalizado.
 */
export function normalizarTexto(texto) {
  return String(texto ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Huella SHA-256 del texto normalizado.
 * @param {unknown} texto Texto a medir.
 * @returns {string} Hash hexadecimal.
 */
export function hashTexto(texto) {
  return createHash('sha256').update(normalizarTexto(texto)).digest('hex')
}

/**
 * Lee un NDJSON y devuelve sus objetos.
 * @param {string} ruta Ruta absoluta del archivo.
 * @returns {object[]} Filas.
 */
function leerNdjson(ruta) {
  return readFileSync(ruta, 'utf8')
    .split(/\r?\n/)
    .filter((linea) => linea.trim())
    .map((linea) => JSON.parse(linea))
}

/**
 * Carga una grabación (events.ndjson + turns.ndjson).
 * @param {string} directorio Directorio de la grabación.
 * @returns {{ eventos: object[], turnos: object[] }} Datos cargados.
 */
export function leerGrabacion(directorio) {
  return {
    eventos: leerNdjson(join(directorio, 'events.ndjson')),
    turnos: leerNdjson(join(directorio, 'turns.ndjson')),
  }
}

/**
 * Mensaje de un evento de log (vacío si no lo tiene).
 * @param {object} evento Evento.
 * @returns {string} Mensaje.
 */
function mensaje(evento) {
  const data = evento?.data
  return data && typeof data.message === 'string' ? data.message : ''
}

/**
 * Parsea el JSON que sigue a un prefijo de log.
 * @param {string} texto Mensaje completo.
 * @param {string} prefijo Prefijo del mensaje.
 * @returns {object|null} Objeto parseado.
 */
function jsonTrasPrefijo(texto, prefijo) {
  if (!texto.startsWith(prefijo)) return null
  return JSON.parse(texto.slice(texto.indexOf('{')))
}

/**
 * Mide los hechos de una grabación.
 *
 * - `rowsNotEqualAnyFinal`: filas que no son exactamente un `asrFinal`.
 * - `tailLossChars`: caracteres perdidos entre finales y fila del mismo turnId.
 * - `extraCommitsForDuplicateTurn`: commits de más por turnId repetido.
 * - `commitsAfterStop`: filas commiteadas después del último `[REC] stop`.
 * - `identitySkips`: nombres descartados por la ventana de eco.
 * - `chromeRawGapsOverStall`: huecos de ASR por encima de `stallMs`.
 * - `sinVector`: medidas de voz sin vector.
 * - `speakerFlips`: cambios de hablante entre commits consecutivos.
 *
 * @param {{ eventos: object[], turnos: object[] }} grabacion Datos cargados.
 * @param {{ stallMs?: number }} [opciones] Ventana de stall a medir.
 * @returns {object} Métricas de la grabación.
 */
export function medirGrabacion({ eventos, turnos }, { stallMs = STALL_MS_DEFECTO } = {}) {
  const finals = eventos
    .map((evento) => jsonTrasPrefijo(mensaje(evento), 'asrFinal '))
    .filter(Boolean)
  const finalHashes = new Set(
    finals.map((final) => final.textHash ?? hashTexto(final.text)),
  )
  const filas = turnos
    .filter((turno) => turno.kind === 'commit')
    .map((turno) => ({
      hash: turno.textHash ?? hashTexto(turno.text),
      len: Number(turno.textLen ?? String(turno.text ?? '').length),
    }))
  const rowsNotEqualAnyFinal = filas.filter((fila) => !finalHashes.has(fila.hash)).length

  const commits = eventos.filter((evento) => evento.event === 'fila.commiteada')
  const porTurno = {}
  for (const commit of commits) {
    const turnId = String(commit.data?.turnId ?? '')
    ;(porTurno[turnId] ??= []).push(commit)
  }
  const finalesPorTurno = {}
  for (const final of finals) {
    const turnId = String(final.turn ?? '')
    ;(finalesPorTurno[turnId] ??= []).push(final)
  }
  const tailLossTurns = Object.entries(porTurno)
    .map(([turnId, lista]) => {
      const finalLen = (finalesPorTurno[turnId] ?? []).reduce(
        (total, final) => total + Number(final.len || 0),
        0,
      )
      if (!finalLen) return null
      const rowLen = Math.max(...lista.map((commit) => Number(commit.data?.longitud || 0)))
      const loss = Math.max(0, finalLen - rowLen)
      return loss > 0 ? { turnId, finalLen, rowLen, loss } : null
    })
    .filter(Boolean)

  const stop = eventos.filter((evento) => mensaje(evento).includes('[REC] stop')).pop()
  const commitsAfterStop = stop
    ? commits.filter((commit) => Number(commit.t) > Number(stop.t)).length
    : 0

  const raw = eventos
    .filter((evento) => evento.event === 'chrome-raw')
    .map((evento) => Number(evento.t))
  const gaps = []
  for (let i = 1; i < raw.length; i += 1) {
    const gap = raw[i] - raw[i - 1]
    if (gap > stallMs) gaps.push(gap)
  }

  let speakerFlips = 0
  for (let i = 1; i < commits.length; i += 1) {
    if (commits[i].data?.hablante !== commits[i - 1].data?.hablante) speakerFlips += 1
  }

  const anchorsMsg = eventos.map(mensaje).find((texto) => texto.startsWith('anchors '))
  const anchors = anchorsMsg ? jsonTrasPrefijo(anchorsMsg, 'anchors ') : null
  const turnIds = new Set(commits.map((commit) => String(commit.data?.turnId ?? '')))

  return {
    events: eventos.length,
    commits: commits.length,
    finals: finals.length,
    uniqueTurnIds: turnIds.size,
    duplicateTurnIds: [...turnIds].filter((turnId) => porTurno[turnId].length > 1),
    extraCommitsForDuplicateTurn: commits.length - turnIds.size,
    rowsNotEqualAnyFinal,
    tailLossChars: tailLossTurns.reduce((total, caso) => total + caso.loss, 0),
    tailLossTurns,
    commitsAfterStop,
    identitySkips: eventos.filter((evento) =>
      mensaje(evento).includes('identity-register-skip'),
    ).length,
    chromeRawGapsOverStall: gaps.length,
    maxGapMs: gaps.length ? Math.max(...gaps) : 0,
    sinVector: eventos.filter((evento) =>
      mensaje(evento).includes('conversacion.voz.medida.sinVector'),
    ).length,
    speakerFlips,
    initialAnchorsCount: anchors?.count ?? null,
    initialAnchorsUsable: anchors?.usable ?? null,
  }
}
