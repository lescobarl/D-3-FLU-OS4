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
 * Sin imports: no conoce ASR, store, reloj ni UI. No muta la entrada.
 */

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

  const anterior = String(abierto.texto || '').trim()
  const palabrasNuevas = contarPalabras(nuevo)
  const palabrasAnteriores = contarPalabras(anterior)

  if (palabrasNuevas > palabrasAnteriores) {
    return { tipo: 'extiende', texto: nuevo, pintar: true, completa }
  }
  if (palabrasNuevas === palabrasAnteriores && palabrasNuevas > 0) {
    return { tipo: 'revisa', texto: nuevo, pintar: true, completa }
  }
  return { tipo: 'revisa', texto: anterior, pintar: false, completa }
}
