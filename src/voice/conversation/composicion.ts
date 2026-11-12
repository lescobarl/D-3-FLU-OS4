/**
 * COMPOSICIÓN DEL EVENTO DEL RECONOCEDOR — frontera de transporte del límite.
 *
 * El reconocedor entrega FRAGMENTOS: re-emite delante el final retenido del
 * enunciado anterior, manda prefijo re-plegado + cola que crece y puede
 * re-escuchar el mismo tramo dos veces (medido 8f3112c2: patrones `10`/`11`).
 * Este módulo compone la HIPÓTESIS COMPLETA de cada evento contra una FRONTERA
 * de transporte por índice: los resultados que ya sostuvieron una fila
 * commiteada no se vuelven a entregar («después que cierro la escucha escribe
 * cosas que ya había escrito antes», dueño 2026-11-12).
 *
 * NO es un dedupe por texto: el módulo nunca deduplica por texto entre turnos
 * (D11 — la repetición legítima tras pausa conserva su fila). Es una marca por
 * ÍNDICE que avanza cuando una fila commitea.
 *
 * El motor local REEMPLAZA el array de resultados en cada segmento (longitud
 * 1), así que `total` nunca supera la frontera y su composición queda intacta:
 * con `total <= corte` la frontera no aplica (si no, se tragaría sus segmentos).
 */
import { fraseDelEventoAsr } from '../lib/speechMerge.js'

/** Alternativa de transcripción de un resultado del reconocedor. */
type AlternativaProducto = Readonly<{ transcript?: string }>

/** Resultado del reconocedor (la nube y el motor local comparten esta forma). */
type ResultadoProducto = ArrayLike<AlternativaProducto> &
  Readonly<{ isFinal?: boolean }>

/** Evento real de ASR con el índice del primer resultado nuevo. */
export type EventoComposicion = Readonly<{
  results?: ArrayLike<ResultadoProducto>
  resultIndex?: number
  /** Métricas acústicas del evento (el hook ya las manda con esta forma). */
  metrics?: Readonly<{ durationMs?: number; speechLikeMs?: number; rms?: number }>
}>

/**
 * Frontera de transporte de una instancia del reconocedor.
 * @property corte Índice EXCLUSIVO de resultados cubiertos por filas commiteadas.
 * @property ultimoFinal Índice del final más alto VISTO (hasta dónde llegó).
 */
export type FronteraComposicion = Readonly<{
  corte: number
  ultimoFinal: number
}>

/** Frontera de una sesión sin filas commiteadas todavía. */
export const FRONTERA_INICIAL: FronteraComposicion = { corte: 0, ultimoFinal: -1 }

/**
 * ¿El evento trae un final del reconocedor desde `resultIndex`?
 * (Caso 7+6: dueño único de la pregunta "¿es final?"; `isFinal` es la marca
 * de Chrome de que la frase quedó completa.)
 * @revisor CREAR NUEVO — dueño único de la pregunta «¿el evento trae final?»;
 *   nace en `producto.ts` y se muda aquí con la composición para que el límite
 *   del producto quede solo como cableado.
 * @param evento Evento real del reconocedor.
 * @returns `true` si algún resultado nuevo es final.
 */
export function traeFinal(evento: EventoComposicion): boolean {
  const resultados = evento.results
  if (!resultados) return false
  for (let i = Number(evento.resultIndex) || 0; i < resultados.length; i += 1) {
    if (resultados[i]?.isFinal === true) return true
  }
  return false
}

/**
 * Compone el trozo de UN evento contra la frontera vigente y devuelve la
 * frontera que deja (con el máximo índice final visto).
 *
 * El FINAL se compone desde la frontera ya cubierta por filas commiteadas (0
 * si no hay): la re-emisión retenida del enunciado anterior no se vuelve a
 * entregar. Los interinos siguen usando `resultIndex` (solo los resultados
 * NUEVOS), nunca por debajo de la frontera. Un evento con MENOS resultados que
 * la frontera es una instancia NUEVA del reconocedor (reinicio del fallback u
 * `onend`): sus índices empiezan en 0 y la frontera vieja se descarta.
 * @revisor CREAR NUEVO — único dueño de la composición contra la frontera de
 *   transporte; reemplaza el bloque inline de `producto.ts` para poder probarlo
 *   (rojo/verde) sin el producto real.
 * @param evento Evento real del reconocedor.
 * @param frontera Frontera vigente de la instancia.
 * @returns Trozo compuesto, si trae final y la frontera nueva.
 */
export function componerEvento(
  evento: EventoComposicion,
  frontera: FronteraComposicion,
): Readonly<{ trozo: string; hayFinal: boolean; frontera: FronteraComposicion }> {
  const resultados = evento.results
  const total = resultados ? resultados.length : 0
  let vigente = frontera
  if (total < vigente.corte) vigente = FRONTERA_INICIAL
  const hayFinal = traeFinal(evento)
  const recorte = total > vigente.corte ? vigente.corte : 0
  const trozo = fraseDelEventoAsr(
    resultados,
    hayFinal ? recorte : Math.max(Number(evento.resultIndex) || 0, recorte),
  )
  // Hasta dónde llegó el reconocedor: el máximo índice final VISTO es lo que
  // cubre una fila cuando commitea.
  let ultimoFinal = vigente.ultimoFinal
  if (resultados) {
    for (let i = 0; i < total; i += 1) {
      if (resultados[i]?.isFinal === true) {
        ultimoFinal = Math.max(ultimoFinal, i)
      }
    }
  }
  return { trozo, hayFinal, frontera: { corte: vigente.corte, ultimoFinal } }
}

/**
 * Avanza la frontera cuando una fila commitea: lo que sostuvo su texto ya está
 * escrito y no se re-compone. Cubre también el commit del stop.
 * @revisor CREAR NUEVO — única transición «una fila commiteó» de la frontera;
 *   el producto la dispara desde `row.committed` y el test la ejerce sin motor.
 * @param frontera Frontera vigente de la instancia.
 * @returns Frontera con el corte al máximo final visto.
 */
export function avanzarFrontera(
  frontera: FronteraComposicion,
): FronteraComposicion {
  return {
    corte: Math.max(frontera.corte, frontera.ultimoFinal + 1),
    ultimoFinal: frontera.ultimoFinal,
  }
}
