import { recordSessionTurn } from '../lib/sessionRecorder.js'

/**
 * turnSnapshot.js — DUENO UNICO del mapeo fila -> snapshot de audio/firma del
 * turno de grabacion.
 *
 * Hallazgo 2026-11-01: el hook calculaba el tramo con su buffer circular
 * (`tramoDelTurno`) y la firma con `lastTurnSignatureRef`. Pasado el tope del
 * buffer, los commits salian con `audioStartSample == audioEndSample`,
 * `tramoValido:false` y `signature:null`. La fila de conversacion YA trae el
 * tramo absoluto (`fila.tramo`) y la firma de su voz (`fila.firma`): ese es el
 * dato canonico; el buffer solo es respaldo para filas sin tramo.
 */

/**
 * @param {{ tramo?: { inicio?: number, fin?: number, sampleRate?: number } | null, firma?: number[] | null } | null} fila
 * @param {{ audioStartSample?: number, audioEndSample?: number, tramoValido?: boolean, sampleRate?: number, signature?: number[] | null }} fallback
 * @returns {{ audioStartSample: number, audioEndSample: number, tramoValido: boolean, sampleRate: number, signature: number[] | null }}
 */
export function snapshotDeTurno(fila, fallback = {}) {
  const tramo = fila?.tramo ?? null
  const inicio = Number(tramo?.inicio)
  const fin = Number(tramo?.fin)
  const tramoValido = Number.isFinite(inicio) && Number.isFinite(fin) && fin > inicio
  const firma = Array.isArray(fila?.firma) && fila.firma.length > 0 ? fila.firma : null
  return {
    audioStartSample: tramoValido ? inicio : Math.max(0, Number(fallback.audioStartSample) || 0),
    audioEndSample: tramoValido ? fin : Math.max(0, Number(fallback.audioEndSample) || 0),
    tramoValido: tramoValido || Boolean(fallback.tramoValido),
    sampleRate: Number(tramo?.sampleRate) || Number(fallback.sampleRate) || 0,
    signature: firma ?? fallback.signature ?? null,
  }
}

/**
 * Graba el snapshot del turno desde la fila canonica. Dueno unico de la
 * llamada a `recordSessionTurn` para locuciones: el hook solo aporta el
 * respaldo del buffer y los contadores de sesion.
 * @param {object|null} fila
 * @param {{ fallback?: object, signature?: number[] | null, clusters?: unknown, lastSpeaker?: unknown, primary?: unknown, turnId?: string, locutionId?: string, sampleRate?: number }} ctx
 * @returns {boolean}
 */
export function grabarSnapshotDeTurno(fila, ctx = {}) {
  const fallback = ctx.fallback || {}
  const snapshot = snapshotDeTurno(fila, {
    audioStartSample: fallback.audioStartSample,
    audioEndSample: fallback.audioEndSample,
    tramoValido: fallback.tramoValido,
    signature: ctx.signature,
    sampleRate: ctx.sampleRate,
  })
  return recordSessionTurn({
    kind: 'commit',
    text: fila?.texto || '',
    speaker: fila?.etiqueta || '',
    signature: snapshot.signature,
    clusters: ctx.clusters,
    lastSpeaker: ctx.lastSpeaker,
    primary: ctx.primary,
    audioStartSample: snapshot.audioStartSample,
    audioEndSample: snapshot.audioEndSample,
    tramoValido: snapshot.tramoValido,
    sampleRate: snapshot.sampleRate,
    sessionTurnId: ctx.turnId,
    locutionId: ctx.locutionId,
  })
}

/**
 * Graba una REVISION del snapshot de una fila ya registrada (firma/tramo
 * finales). Dueno unico de la revision: la usan la medida tardia y la fusion
 * de continuaciones; antes cada camino repetia el mismo bloque de 21 lineas.
 * @param {object|null} fila
 * @returns {boolean}
 */
export function grabarRevisionDeFila(fila) {
  if (!fila) return false
  const tramo = fila.tramo || null
  const inicio = Number(tramo?.inicio)
  const fin = Number(tramo?.fin)
  return recordSessionTurn({
    kind: 'commit',
    revision: true,
    text: fila.texto || '',
    speaker: fila.etiqueta || '',
    signature: Array.isArray(fila.firma) && fila.firma.length ? fila.firma : null,
    audioStartSample: Number.isFinite(inicio) ? inicio : 0,
    audioEndSample: Number.isFinite(fin) ? fin : 0,
    tramoValido: Number.isFinite(inicio) && Number.isFinite(fin) && fin > inicio,
    sampleRate: Number(tramo?.sampleRate) || 0,
    sessionTurnId: fila.turnId,
    locutionId: fila.locutionId,
  })
}
