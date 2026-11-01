/**
 * fusion.ts — DUENO UNICO de la fusion de una locucion con la fila anterior.
 *
 * Una frase identica o su continuacion/revision con audio contiguo es la MISMA
 * unidad de conversacion. Se devuelve una fila con el `locutionId` ANTERIOR: el
 * almacen hace upsert por id, la vista reemplaza y no aparece una segunda fila.
 * Antes cada `row.committed` insertaba otra fila y la conversacion duplicaba
 * lo mismo dos veces (auditoria 2026-11-01).
 */
import { continuaLaFrase } from '../core/locucion.js'
import { normalizeForMatch } from '../../lib/textUtils.ts'
import type { Fila, FilaNueva } from './ports.ts'

/** Decision de la puerta de fusion: fundir, descartar reentrega o fila nueva. */
export type DecisionFusion =
  | Readonly<{ tipo: 'fusionar'; fila: FilaNueva }>
  | Readonly<{ tipo: 'descartar'; motivo: 'turnoYaEscrito' }>
  | Readonly<{ tipo: 'nueva' }>

/**
 * Decide si la locucion nueva es la MISMA unidad que la anterior:
 *  - texto identico + ventana SOLAPADA de otro turno => dos utterances (nueva),
 *  - texto identico en el mismo turno o ventana DISJUNTA => reentrega (descartar),
 *  - continuacion/revision con audio contiguo => fusionar.
 * @param anterior Fila ya commiteada.
 * @param nueva Fila nueva.
 * @param opciones `vozDistinta` medida y gaps.
 */
export function decidirFusion(
  anterior: Fila | null,
  nueva: FilaNueva,
  opciones: { vozDistinta?: boolean; mergeGapMs?: number; duplicateGapMs?: number } = {},
): DecisionFusion {
  if (!anterior || opciones.vozDistinta) return { tipo: 'nueva' }
  const mergeGapMs = opciones.mergeGapMs ?? 2000
  const duplicateGapMs = opciones.duplicateGapMs ?? 8000
  const textoAnterior = String(anterior.texto || '').trim()
  const textoNuevo = String(nueva.texto || '').trim()
  if (!textoAnterior || !textoNuevo) return { tipo: 'nueva' }
  const rate = Math.max(1, Number(nueva.tramo.sampleRate) || Number(anterior.tramo.sampleRate) || 1)
  const gapMs = Math.max(0, ((nueva.tramo.inicio - anterior.tramo.fin) / rate) * 1000)
  if (textoAnterior === textoNuevo) {
    if (nueva.turnId !== anterior.turnId) {
      const durNueva = ((nueva.tramo.fin - nueva.tramo.inicio) / rate) * 1000
      const palabras = textoNuevo.split(/\s+/).filter(Boolean).length
      // Un texto largo con audio muy corto es reentrega/alucinacion: la sesion
      // real 6b471291 repitio ~20 s de texto con 1,18 s de audio. Un texto corto
      // en un turno nuevo es una frase legitima (aunque el audio sea breve).
      if (palabras > 8 && durNueva < 2000) {
        return { tipo: 'descartar', motivo: 'turnoYaEscrito' }
      }
      return { tipo: 'nueva' }
    }
    if (gapMs <= duplicateGapMs) return { tipo: 'descartar', motivo: 'turnoYaEscrito' }
    return { tipo: 'nueva' }
  }
  if (!continuaLaFrase(textoAnterior, textoNuevo) || gapMs > mergeGapMs) return { tipo: 'nueva' }
  const fila = fusionarFila(anterior, nueva, mergeGapMs)
  return fila ? { tipo: 'fusionar', fila } : { tipo: 'nueva' }
}

/**
 * @param anterior Fila ya commiteada.
 * @param nueva Fila nueva que se iba a insertar.
 * @param mergeGapMs hueco maximo para una continuacion.
 * @param duplicateGapMs hueco maximo para un texto identico.
 * @returns La fila fusionada o null si no son la misma unidad.
 */
export function fusionarFila(
  anterior: Fila,
  nueva: FilaNueva,
  mergeGapMs = 2000,
): FilaNueva | null {
  const textoAnterior = String(anterior.texto || '').trim()
  const textoNuevo = String(nueva.texto || '').trim()
  if (!textoAnterior || !textoNuevo) return null
  if (textoAnterior === textoNuevo) return null
  if (!continuaLaFrase(textoAnterior, textoNuevo)) return null
  const rate = Math.max(1, Number(nueva.tramo.sampleRate) || Number(anterior.tramo.sampleRate) || 1)
  const gapMs = Math.max(0, ((nueva.tramo.inicio - anterior.tramo.fin) / rate) * 1000)
  if (gapMs > mergeGapMs) return null
  // Revision: el texto nuevo contiene al anterior (o al reves) y lo reemplaza.
  // Continuacion real sin prefijo: se conservan AMBOS (no se pierde la primera).
  const normalizadoAnterior = normalizeForMatch(textoAnterior)
  const normalizadoNuevo = normalizeForMatch(textoNuevo)
  const texto = normalizadoNuevo.includes(normalizadoAnterior)
    ? textoNuevo
    : normalizadoAnterior.includes(normalizadoNuevo)
      ? textoAnterior
      : `${textoAnterior} ${textoNuevo}`
  return {
    locutionId: anterior.locutionId,
    sessionId: anterior.sessionId,
    turnId: anterior.turnId,
    texto,
    tramo: {
      inicio: anterior.tramo.inicio,
      fin: Math.max(anterior.tramo.fin, nueva.tramo.fin),
      sampleRate: nueva.tramo.sampleRate || anterior.tramo.sampleRate,
    },
    // La medida nueva manda; si nace pendiente, conserva la etiqueta previa.
    etiqueta: nueva.evidencia === 'pendiente' ? anterior.etiqueta : nueva.etiqueta,
    evidencia: nueva.evidencia === 'pendiente' ? anterior.evidencia : nueva.evidencia,
    firma: nueva.firma ?? anterior.firma,
    idioma: nueva.idioma,
    overlap: Boolean(anterior.overlap || nueva.overlap),
    provisional: nueva.provisional,
    reason: nueva.reason,
  }
}
