/**
 * MUESTRAS de audio retenidas del módulo CONVERSACIÓN (puro).
 *
 * Única utilidad de retención de PCM para la medida de voz: concatena los
 * bloques de la locución abierta y aplica el tope declarado (cola: se descarta
 * el más viejo, nunca el más nuevo). La consumen `ingesta` (retención y medida
 * temprana) y `cierre` (medida de respaldo); no decide nada de dominio.
 *
 * La lógica de concatenación vive en el DUEÑO ÚNICO (`pcmChunks.concatFloat32`);
 * aquí solo se publica la superficie del módulo (structureDuplicationGuard).
 */
import { countVoicedSamples } from '../lib/voicedActivity.js'

export { concatFloat32 as concatenarMuestras } from '../lib/pcmChunks.js'

/**
 * Duración REAL de VOZ en milisegundos del audio medido. Dueño único de la
 * conversión voz→ms: la identidad temprana, la tardía y el cierre la consumen.
 * La longitud de la captura y la del tramo (`fin - inicio`) NO son voz: una
 * ventana con silencio superaba el piso `minNuevaVozMs` y la plantilla de 0,9 s
 * de VOZ partía la fila (outlier de la sesión 68c837da).
 * @param muestras PCM medido (mono).
 * @param sampleRate Frecuencia de muestreo.
 * @returns Milisegundos de VOZ real (0 sin muestras, sin voz o tasa inválida).
 * @revisor CREAR NUEVO — reemplaza `duracionMsDeMuestras` (captura) como dueño
 * único de la duración de identidad; ahora la evidencia es la VOZ real.
 */
export function vozMsDeMuestras(muestras: Float32Array, sampleRate: number): number {
  const tasa = Number(sampleRate)
  if (!(tasa > 0) || !muestras || muestras.length === 0) return 0
  return Math.round((countVoicedSamples(muestras, { sampleRate: tasa }) / tasa) * 1000)
}

/**
 * Añade un bloque a la cola conservando el tope en muestras.
 * Si el tope se supera, se descartan los bloques MÁS VIEJOS; si un único bloque
 * lo supera, se conserva su cola más reciente.
 * @param cola Bloques retenidos, en orden de llegada.
 * @param nuevo Bloque entrante.
 * @param tope Máximo de muestras retenidas (≥ 1).
 * @returns Cola nueva (nunca muta la entrada).
 */
export function retenerCola(
  cola: readonly Float32Array[],
  nuevo: Float32Array,
  tope: number,
): Float32Array[] {
  const limite = Math.max(1, Math.round(tope))
  const siguiente = [...cola, nuevo]
  let total = siguiente.reduce((suma, bloque) => suma + bloque.length, 0)
  while (total > limite && siguiente.length > 1) {
    const caido = siguiente.shift()
    if (!caido) break
    total -= caido.length
  }
  if (total > limite && siguiente.length === 1) {
    const unico = siguiente[0]
    siguiente[0] = unico.slice(unico.length - limite)
  }
  return siguiente
}

/**
 * Copia SOLO la cola de una cola de bloques, sin concatenar todo.
 *
 * Para medir la voz se usaba `concatenarMuestras(cola)` y después `slice(-ventana)`:
 * se copiaba el búfer entero (hasta 30 s) por cada medición para usar 1,5 s. Medido
 * en la sesión 8149df78 (2026-11-08): 104 mediciones copiando el búfer completo,
 * 11.712.064 muestras copiadas en 74 s de audio.
 *
 * @param cola Bloques retenidos, en orden de llegada.
 * @param ventana Muestras deseadas (se toman las MÁS RECIENTES).
 * @returns Bloque contiguo con la cola pedida (nunca muta la entrada).
 */
export function colaDeMuestras(
  cola: readonly Float32Array[],
  ventana: number,
): Float32Array {
  const pedidas = Math.max(0, Math.round(Number(ventana) || 0))
  if (pedidas === 0) return new Float32Array(0)
  let disponibles = 0
  for (const bloque of cola) disponibles += bloque.length
  const salida = new Float32Array(Math.min(pedidas, disponibles))
  let escrito = salida.length
  for (let indice = cola.length - 1; indice >= 0 && escrito > 0; indice -= 1) {
    const bloque = cola[indice]
    if (!bloque || bloque.length === 0) continue
    const tomar = Math.min(bloque.length, escrito)
    escrito -= tomar
    salida.set(bloque.subarray(bloque.length - tomar), escrito)
  }
  return salida
}
