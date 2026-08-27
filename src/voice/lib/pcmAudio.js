/**
 * PCM lineal 16-bit mono para STT streaming.
 */
export function float32ToInt16(samples) {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
  }
  return out
}

export function resampleLinear(input, fromRate, toRate) {
  if (!input?.length || !fromRate || !toRate || fromRate === toRate) {
    return input || new Float32Array(0)
  }
  const ratio = fromRate / toRate
  const outLen = Math.max(1, Math.floor(input.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i += 1) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const a = input[idx] ?? 0
    const b = input[idx + 1] ?? a
    out[i] = a + (b - a) * frac
  }
  return out
}

export function encodePcmChunk(float32, sampleRate, targetRate = 16000) {
  if (!float32?.length) return new Int16Array(0)
  const resampled = resampleLinear(float32, sampleRate, targetRate)
  return float32ToInt16(resampled)
}

export function pcmRms(float32) {
  if (!float32?.length) return 0
  let sum = 0
  for (let i = 0; i < float32.length; i += 1) {
    sum += float32[i] * float32[i]
  }
  return Math.sqrt(sum / float32.length)
}
