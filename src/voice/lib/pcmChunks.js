/**
 * pcmChunks.js — utilidades de chunks de PCM en Float32.
 *
 * DUEÑO ÚNICO de `concatFloat32`: concatenar porciones de audio en un solo
 * Float32Array. Antes estaba copiado 3 veces con OTRO nombre (concatFrames en el
 * segmentador VAD, concatChunks en el motor Whisper y en el snapshot del turno),
 * más una copia inline en speakerClusters: la misma implementación con distinto
 * nombre, y los guards de duplicación por NOMBRE/cuerpo-idéntico no lo veían
 * (P9.23). Lo caza `structureDuplicationGuard` (mide el esqueleto, no el nombre).
 */

/**
 * Concatena chunks de PCM en un único Float32Array.
 * @param {ArrayLike<Float32Array|number[]>} chunks
 * @returns {Float32Array}
 */
export function concatFloat32(chunks) {
  const total = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
