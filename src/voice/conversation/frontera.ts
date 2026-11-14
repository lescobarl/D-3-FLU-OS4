/**
 * FRONTERA DE LA LOCUCIÓN — regla 2 del módulo CONVERSACIÓN (pura).
 *
 * El VAD MIDE (`hayVoz`, `silencioMs`); esta frontera DECIDE si la locución
 * abierta se cierra. LAS DOS PUERTAS del producto viven aquí:
 *
 *  - VOZ: el tramo entrante fue medido como OTRA voz. Cierra YA (no espera al
 *    silencio); es la única puerta de cambio de hablante.
 *  - TIEMPO: la línea lleva demasiado tiempo como UN bloque. Tres medidas del
 *    mismo hecho:
 *      · silencio MEDIDO por el VAD hasta `silenceCloseMs` (puerta de abajo),
 *        con causa `frontera` si hay texto ajeno y `silencio` si no;
 *      · silencio de RELOJ desde el final del ASR confirmado hasta
 *        `finalCloseConfirmMs` sin voz (el final solo arma la ventana, no
 *        cierra por contenido);
 *      · TOPE de locución `maxLocutionMs` (causa `maximo`): la frase que sigue
 *        ganando voz se PARTE a los 12 s para que el respaldo transcriba
 *        ventanas medibles (contrato ASR local, §5-quinquies). No es una
 *        puerta de texto: el texto ajeno no cierra por sí solo.
 *
 * Con voz presente en la medida no se cierra por tiempo: la voz gana. La única
 * excepción es el TOPE, que existe justamente para acotar la ventana cuando la
 * voz no para.
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
  /** Tope de duración de la locución en ms (0 o ausente = sin tope). */
  maxLocutionMs?: number
}>

/** Causa del cierre: voz distinta, frontera por texto ajeno, silencio o tope. */
export type CausaFrontera = 'voz' | 'frontera' | 'silencio' | 'maximo'

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
  /**
   * Duración de AUDIO de la locución abierta (ms), medida por la ingesta sobre
   * su ventana. Ausente = sin medida: el TOPE de duración no evalúa.
   */
  duracionMs?: number
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
  // TOPE DE LOCUCIÓN: techo de TIEMPO, no de contenido. Sin `duracionMs` (las
  // puertas viejas no la pasan) o con el umbral apagado, no evalúa.
  const topeMs = Math.max(0, Number(umbrales.maxLocutionMs) || 0)
  const topeCierra =
    topeMs > 0 &&
    entrada.duracionMs !== undefined &&
    Math.max(0, Number(entrada.duracionMs) || 0) >= topeMs
  // Con voz presente en la medida no se cierra por tiempo: la voz gana. El TOPE
  // es la excepción: la persona puede seguir hablando; la ventana ya no.
  if (entrada.medida.hayVoz && !topeCierra) return { cerrar: false, causa: null }

  // PUERTA 2 (TIEMPO): SOLO el tiempo cierra. El texto ajeno por sí solo NO
  // cierra. Tres medidas del mismo hecho, la que primero se cumpla:
  //  - silencio MEDIDO por el VAD hasta `silenceCloseMs` (puerta de abajo),
  //  - silencio de RELOJ desde el final confirmado: el final del ASR MARCA la
  //    frase pero NO la cierra (mandato 2026-10-30); la ventana de silencio
  //    posterior es la que adelanta la fila. Solo dispara si no hubo voz en
  //    el camino (el llamador rearma la marca en cada bloque con voz),
  //  - TOPE de duración `maxLocutionMs`: la ventana ya no crece (§5-quinquies).
  const finalConfirmadoMs = Math.max(0, Number(entrada.finalDesdeMs) || 0)
  const topeConfirmacion = Number(umbrales.finalCloseConfirmMs)
  const silencioCierra =
    silencioMs >= umbrales.silenceCloseMs ||
    (topeConfirmacion > 0 &&
      entrada.finalDesdeMs !== undefined &&
      finalConfirmadoMs >= topeConfirmacion)
  if (silencioCierra || topeCierra) {
    return {
      cerrar: true,
      causa: silencioCierra
        ? (entrada.textoAjeno ? 'frontera' : 'silencio')
        : 'maximo',
    }
  }
  return { cerrar: false, causa: null }
}
