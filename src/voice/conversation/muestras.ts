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
