// ============================================================
// resample.js — Remuestreo de audio. DUENO UNICO de `downsample`.
// ------------------------------------------------------------
// Algoritmo: media por tramos (box low-pass) para evitar aliasing al bajar de
// frecuencia. Tomar una de cada `ratio` muestras distorsiona la voz y hace que
// Whisper alucine. Lo comparten el motor de Whisper
// (voice/lib/asr/whisperRecognitionEngine.js) y el laboratorio DEV
// (dev/asrLab/AsrLab.tsx): antes cada uno tenia su copia (P8.26).
// ============================================================

/**
 * Remuestrea `samples` de `fromRate` a `toRate` con media box low-pass.
 * @param {Float32Array|ArrayLike<number>} samples Muestras de entrada.
 * @param {number} fromRate Frecuencia de origen (Hz).
 * @param {number} toRate Frecuencia destino (Hz).
 * @returns {Float32Array} Muestras remuestreadas (o las de entrada si no hay que bajar).
 */
export function downsample(samples, fromRate, toRate) {
  const input = samples instanceof Float32Array ? samples : new Float32Array(samples || [])
  if (!input.length || fromRate <= toRate) return input
  const ratio = fromRate / toRate
  const length = Math.max(1, Math.floor(input.length / ratio))
  const out = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio)
    const end = Math.min(input.length, Math.floor((index + 1) * ratio))
    let sum = 0
    const count = Math.max(1, end - start)
    for (let cursor = start; cursor < end; cursor += 1) sum += input[cursor]
    out[index] = sum / count
  }
  return out
}
