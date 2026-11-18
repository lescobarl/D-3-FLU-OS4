/**
 * FRONTERA DE LA LOCUCIÓN — regla 2 del módulo CONVERSACIÓN (pura).
 *
 * El VAD MIDE (`hayVoz`, `silencioMs`); esta frontera DECIDE si la locución
 * abierta se cierra. LAS DOS PUERTAS del producto viven aquí:
 *
 *  - VOZ: el tramo entrante fue medido como OTRA voz. Cierra YA (no espera al
 *    silencio); es la única puerta de cambio de hablante.
 *  - SILENCIO: dos medidas del MISMO hecho. El silencio MEDIDO por el VAD
 *    alcanza `silenceCloseMs` (puerta de abajo), o el silencio de RELOJ desde
 *    el final del ASR confirmado alcanza `finalCloseConfirmMs` sin voz
 *    (adelanto de la fila; el final solo arma la ventana, no cierra por
 *    contenido). Con texto ajeno la causa es `frontera`; sin él, `silencio`.
 *
 * Con voz presente en la medida no se cierra por tiempo: la voz gana.
 * Los umbrales salen de `CONVERSACION_CONFIG` (tabla del plan); no hay literales
 * de milisegundos aquí. Sin imports externos y sin mutar la entrada.
 */
import { CONVERSACION_CONFIG } from './ports.ts'
import type { MedidaVad } from './ports.ts'

/** Umbrales que la frontera consume; por defecto, la tabla del plan. */
export type UmbralesFrontera = Readonly<{
  minSilenceMs: number
  silenceCloseMs: number
  /** Confirmación del final: silencio de reloj tras el final (puerta 2). */
  finalCloseConfirmMs?: number
}>

/** Causa del cierre: voz distinta medida, frontera por texto ajeno o silencio. */
export type CausaFrontera = 'voz' | 'frontera' | 'silencio'

/** Decisión de la regla 2: si cerrar y por qué. */
export type DecisionFrontera = Readonly<{
  cerrar: boolean
  causa: CausaFrontera | null
}>

/** Entrada de la frontera: medida del VAD, texto ajeno, voz y locución abierta. */
export type EntradaFrontera = Readonly<{
  medida: MedidaVad
  textoAjeno: boolean
  abierta: boolean
  /** Voz DISTINTA medida/declarada para el tramo entrante. */
  cambioVoz?: boolean
  /**
   * Milisegundos de RELOJ desde que el final del ASR se aplicó a la locución
   * abierta (solo la ingesta lo entrega; cada bloque con voz rearma la marca).
   * Ausente = sin final aplicado: la puerta 2 solo usa el silencio VAD.
   */
  finalDesdeMs?: number
}>

/**
 * Decide si la locución abierta se cierra.
 *
 * @param entrada Medida del VAD, texto ajeno, cambio de voz medido y si hay locución.
 * @param umbrales Umbrales de la tabla del plan (inyectables en pruebas).
 * @returns `{cerrar, causa}`; `causa` es null mientras no se cierre.
 */
export function decidirFrontera(
  entrada: EntradaFrontera,
  umbrales: UmbralesFrontera = CONVERSACION_CONFIG,
): DecisionFrontera {
  if (!entrada.abierta) return { cerrar: false, causa: null }

  // PUERTA 1: cambio de hablante MEDIDO. Cierra ya, sin esperar silencio.
  if (entrada.cambioVoz === true) return { cerrar: true, causa: 'voz' }

  const silencioMs = Math.max(0, Number(entrada.medida.silencioMs) || 0)
  // Con voz presente en la medida no se cierra por tiempo: la voz gana.
  if (entrada.medida.hayVoz) return { cerrar: false, causa: null }

  // PUERTA 2: SOLO el silencio cierra. El texto ajeno por sí solo NO cierra.
  // Dos medidas del mismo hecho, la que primero se cumpla:
  //  - silencio MEDIDO por el VAD hasta `silenceCloseMs` (puerta de abajo), o
  //  - silencio de RELOJ desde el final confirmado: el final del ASR MARCA la
  //    frase pero NO la cierra (mandato 2026-10-30); la ventana de silencio
  //    posterior es la que adelanta la fila.
  const finalConfirmadoMs = Math.max(0, Number(entrada.finalDesdeMs) || 0)
  const topeConfirmacion = Number(umbrales.finalCloseConfirmMs)
  const silencioCierra =
    silencioMs >= umbrales.silenceCloseMs ||
    (topeConfirmacion > 0 &&
      entrada.finalDesdeMs !== undefined &&
      finalConfirmadoMs >= topeConfirmacion)
  if (silencioCierra) {
    return {
      cerrar: true,
      causa: entrada.textoAjeno ? 'frontera' : 'silencio',
    }
  }
  return { cerrar: false, causa: null }
}
