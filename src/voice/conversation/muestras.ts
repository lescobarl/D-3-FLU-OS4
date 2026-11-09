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
export { concatFloat32 as concatenarMuestras } from '../lib/pcmChunks.js'

/**
 * Duración REAL en milisegundos del audio medido. Dueño único de la conversión
 * muestras→ms: la medida de voz y la medida tardía la consumen; la duración del
 * tramo (`fin - inicio`) NO es la del audio retenido (una locución sembrada con
 * audio de otro tramo mide más de lo que dice su ventana).
 * @param muestras Número de muestras PCM medidas.
 * @param sampleRate Frecuencia de muestreo.
 * @returns Milisegundos (0 si no hay muestras o frecuencia válida).
 */
export function duracionMsDeMuestras(muestras: number, sampleRate: number): number {
  const total = Number(muestras)
  const tasa = Number(sampleRate)
  if (!(total > 0) || !(tasa > 0)) return 0
  return (total / tasa) * 1000
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
