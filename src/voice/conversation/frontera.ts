/**
 * FRONTERA DE LA LOCUCIÓN — regla 2 del módulo CONVERSACIÓN (pura).
 *
 * El VAD MIDE (`hayVoz`, `silencioMs`); esta frontera DECIDE si la locución
 * abierta se cierra. Dos cierres distintos, con umbrales del plan:
 *
 *  - FRONTERA: hay silencio suficiente (`minSilenceMs`) y llega texto ajeno
 *    (otro tramo). Es el cierre por cambio de hablante/tramo.
 *  - SILENCIO: no llega texto ajeno, pero el silencio alcanza
 *    `silenceCloseMs`. Es el segundo cierre; el llamador decide si la fila es
 *    provisional o descarte contado (regla 4).
 *
 * Con voz presente no se cierra aunque la medida traiga silencio: la voz gana.
 * Los umbrales salen de `CONVERSACION_CONFIG` (tabla del plan); no hay literales
 * de milisegundos aquí. Sin imports externos y sin mutar la entrada.
 */
import { CONVERSACION_CONFIG } from './ports.ts'
import type { MedidaVad } from './ports.ts'

/** Umbrales que la frontera consume; por defecto, la tabla del plan. */
export type UmbralesFrontera = Readonly<{
  minSilenceMs: number
  silenceCloseMs: number
}>

/** Causa del cierre: frontera por texto ajeno o silencio sin texto ajeno. */
export type CausaFrontera = 'frontera' | 'silencio'

/** Decisión de la regla 2: si cerrar y por qué. */
export type DecisionFrontera = Readonly<{
  cerrar: boolean
  causa: CausaFrontera | null
}>

/** Entrada de la frontera: medida del VAD, texto ajeno y si hay locución abierta. */
export type EntradaFrontera = Readonly<{
  medida: MedidaVad
  textoAjeno: boolean
  abierta: boolean
}>

/**
 * Decide si la locución abierta se cierra con la medida actual del VAD.
 *
 * @param entrada Medida del VAD, si llegó texto de otro tramo y si hay locución.
 * @param umbrales Umbrales de la tabla del plan (inyectables en pruebas).
 * @returns `{cerrar, causa}`; `causa` es null mientras no se cierre.
 */
export function decidirFrontera(
  entrada: EntradaFrontera,
  umbrales: UmbralesFrontera = CONVERSACION_CONFIG,
): DecisionFrontera {
  if (!entrada.abierta) return { cerrar: false, causa: null }

  const silencioMs = Math.max(0, Number(entrada.medida.silencioMs) || 0)
  if (entrada.medida.hayVoz) return { cerrar: false, causa: null }

  if (entrada.textoAjeno && silencioMs >= umbrales.minSilenceMs) {
    return { cerrar: true, causa: 'frontera' }
  }
  if (!entrada.textoAjeno && silencioMs >= umbrales.silenceCloseMs) {
    return { cerrar: true, causa: 'silencio' }
  }
  return { cerrar: false, causa: null }
}
