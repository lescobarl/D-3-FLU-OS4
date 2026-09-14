/**
 * Helpers puros de PCM/embeddings compartidos entre el núcleo de embedding
 * (Node/fallback) y el Worker de identidad de voz. Un solo cuerpo (V18).
 */

/**
 * Remuestrea por decimación a la tasa objetivo (por defecto 16 kHz).
 * @param samples Muestras de entrada (Float32Array o array numérico).
 * @param sampleRate Tasa de muestreo de entrada.
 * @param targetRate Tasa de muestreo objetivo.
 * @returns Float32Array remuestreado.
 */
export function downsampleTo16k(samples, sampleRate, targetRate) {
  if (!samples?.length) return new Float32Array(0)
  const safeTargetRate = Number(targetRate) > 0 ? Number(targetRate) : 16000
  if (sampleRate <= safeTargetRate) {
    return samples instanceof Float32Array ? samples : new Float32Array(samples)
  }
  const ratio = sampleRate / safeTargetRate
  const length = Math.max(1, Math.floor(samples.length / ratio))
  const result = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    result[index] = samples[Math.min(samples.length - 1, Math.floor(index * ratio))]
  }
  return result
}

/**
 * Extrae el embedding crudo de la salida del modelo como array numérico.
 * @param output Salida del modelo (con `embeddings` o `logits`).
 * @returns Vector de embedding o [] si no hay datos.
 */
export function tensorToEmbeddingVector(output) {
  const tensor = output?.embeddings ?? output?.logits
  if (!tensor?.data) return []
  return Array.from(tensor.data)
}
