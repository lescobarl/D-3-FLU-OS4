/**
 * Utilidades compartidas por los Web Workers de voz: lectura de payloads de
 * audio transferidos y emisión de respuestas por mensaje. Un solo cuerpo (V18).
 */

/**
 * Extrae muestras Float32 de un payload transferido por un Worker.
 * @param payload Payload con `audioBuffer`/`samples`, `byteOffset` y `sampleCount`.
 * @returns Float32Array con las muestras recibidas (vacío si no hay datos).
 */
export function samplesFromTransfer(payload = {}) {
  const { audioBuffer, samples, byteOffset = 0, sampleCount } = payload
  if (audioBuffer instanceof ArrayBuffer) {
    const count =
      Number.isFinite(sampleCount) && sampleCount > 0
        ? sampleCount
        : Math.floor((audioBuffer.byteLength - byteOffset) / 4)
    return count > 0 ? new Float32Array(audioBuffer, byteOffset, count) : new Float32Array(0)
  }
  if (samples instanceof ArrayBuffer) {
    const count =
      Number.isFinite(sampleCount) && sampleCount > 0
        ? sampleCount
        : Math.floor(samples.byteLength / 4)
    return count > 0 ? new Float32Array(samples, byteOffset, count) : new Float32Array(0)
  }
  if (samples instanceof Float32Array) return samples
  if (Array.isArray(samples)) return new Float32Array(samples)
  return new Float32Array(0)
}

/**
 * Crea el emisor de respuestas de un Worker para un mensaje concreto.
 * @param id Identificador del mensaje entrante.
 * @returns Función `(ok, result, error)` que responde por `postMessage`.
 */
export function createWorkerReply(id) {
  return (ok, result, error) => {
    self.postMessage({ id, ok, result, error: error ? String(error?.message || error) : '' })
  }
}
