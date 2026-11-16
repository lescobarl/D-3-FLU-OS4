/**
 * REVISIÓN DE LA LOCUCIÓN — regla 3 del módulo CONVERSACIÓN (pura).
 *
 * Una locución abierta se identifica por su `tramoId` (el ÚNICO id: `locutionId`
 * = `tramoId`). El ASR puede reemitir el mismo tramo o emitir otro:
 *
 *  - mismo tramo + MÁS palabras → extiende. El prefijo no es obligatorio: la
 *    primera palabra puede cambiar y la locución sigue creciendo.
 *  - mismo tramo + las MISMAS palabras → revisa (puede reemplazar palabras).
 *  - mismo tramo + MENOS palabras → no se pinta: la locución nunca pierde
 *    palabras. Se conserva el texto anterior y se declara `pintar: false`.
 *  - tramo distinto (o sin locución abierta) → locución nueva.
 *
 * "Más largo" se mide en PALABRAS, no en caracteres: la regla habla de perder
 * palabras. `final` no cambia el texto: solo declara que el tramo completa.
 *
 * Solo importa el dueño del comparador de fragmentos (`speechMerge`). No
 * conoce ASR, store, reloj ni UI. No muta la entrada.
 */
import { isSameFragmentRevision } from '../lib/speechMerge.js'

/** Texto de una locución abierta: su tramo y lo que la caja muestra. */
export type TramoAbierto = Readonly<{ id: string; texto: string }>

/** Decisión de la regla 3 para un resultado del ASR. */
export type DecisionRevision = Readonly<{
  /** `nueva` abre locución; `extiende`/`revisa` aplican al tramo abierto. */
  tipo: 'nueva' | 'extiende' | 'revisa'
  /** Texto que debe quedar en la locución (el anterior si la revisión pierde palabras). */
  texto: string
  /** `false` cuando la revisión pierde palabras: la caja no retrocede. */
  pintar: boolean
  /** `true` solo si el resultado es final: el tramo completa. */
  completa: boolean
}>

/** Resultado de unir dos versiones del MISMO tramo. */
export type TextoUnido = Readonly<{
  /** Texto que queda en la locución abierta. */
  texto: string
  /** `false` si la nueva versión pierde palabras: no se pinta. */
  pintar: boolean
  /** `extiende` si creció; `revisa` si se mantuvo o perdió palabras. */
  tipo: 'extiende' | 'revisa'
}>

/**
 * Número de palabras de un texto (espacios colapsados; vacío = 0).
 * Es la unidad de la regla 3: "más largo" y "pierde palabras" se miden así.
 * @param texto Texto crudo del ASR o de la locución.
 */
function contarPalabras(texto: string): number {
  const limpio = String(texto || '').trim()
  return limpio ? limpio.split(/\s+/).length : 0
}

/**
 * Une dos versiones del MISMO tramo (dueño único de la regla 3).
 *
 * La versión nueva gana si crece o si empata en palabras; si pierde palabras,
 * se conserva la anterior y se declara que no debe pintarse. Nunca concatena
 * colas distintas: eso inventaría texto que nadie dijo.
 *
 * @param anterior Texto ya pintado en la locución abierta.
 * @param nuevo Texto reemitido por el ASR para el mismo `tramoId`.
 * @returns Texto a conservar, si se pinta y el tipo de revisión.
 */
export function unirRevision(anterior: string, nuevo: string): TextoUnido {
  const previo = String(anterior || '').trim()
  const siguiente = String(nuevo || '').trim()
  const palabrasNuevas = contarPalabras(siguiente)
  const palabrasAnteriores = contarPalabras(previo)
  if (palabrasNuevas > palabrasAnteriores) {
    return { texto: siguiente, pintar: true, tipo: 'extiende' }
  }
  if (palabrasNuevas === palabrasAnteriores && palabrasNuevas > 0) {
    // Solo una REVISIÓN del mismo fragmento reemplaza. Una frase nueva con las
    // mismas palabras ("uno" → "dos") no pisa la locución.
    return isSameFragmentRevision(previo, siguiente)
      ? { texto: siguiente, pintar: true, tipo: 'revisa' }
      : { texto: previo, pintar: false, tipo: 'revisa' }
  }
  return { texto: previo, pintar: false, tipo: 'revisa' }
}

/**
 * Decide qué hacer con un resultado del ASR sobre la locución abierta.
 *
 * @param entrada `tramoAbierto` (o null), `tramoId` del resultado, `texto` crudo
 *   y `final` del ASR.
 * @returns Decisión con el texto a conservar y si debe pintarse.
 * @throws Si `tramoId` viene vacío: sin tramo no hay locución (regla 1).
 */
export function decidirRevision(
  entrada: Readonly<{
    tramoAbierto: TramoAbierto | null
    tramoId: string
    texto: string
    final: boolean
  }>,
): DecisionRevision {
  const tramoId = String(entrada.tramoId || '').trim()
  if (!tramoId) throw new Error('tramoId vacio: sin tramo no hay locucion')
  const nuevo = String(entrada.texto || '').trim()
  const completa = Boolean(entrada.final)
  const abierto = entrada.tramoAbierto

  if (!abierto || abierto.id !== tramoId) {
    return { tipo: 'nueva', texto: nuevo, pintar: true, completa }
  }

  const union = unirRevision(abierto.texto, nuevo)
  return { tipo: union.tipo, texto: union.texto, pintar: union.pintar, completa }
}
