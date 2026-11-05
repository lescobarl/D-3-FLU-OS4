/**
 * Senales SINTETICAS deterministas para los tests de voz (ASR/VAD).
 *
 * DUENO UNICO de las fixtures acusticas: las comparten el VAD speech-like, la
 * decision de degradar y el gate de resultados locales. Nada de copias por test
 * (si cambia la definicion de "habla sintetica", cambia en un sitio).
 *
 * `speech()` NO es un modelo de voz: es una portadora en banda con envelope
 * silabico (~4 Hz), que es lo que el VAD debe reconocer; `tone()` es la misma
 * portadora SIN envelope, que debe rechazar por falta de modulacion.
 */
export const RATE = 16000

/** Silencio digital (RMS 0). */
export function silence(ms: number, rate = RATE): Float32Array {
  return new Float32Array(Math.round((ms / 1000) * rate))
}

/** Nivel pegado (DC): energia alta y CERO cruces por cero. */
export function dc(ms: number, amplitude = 0.5, rate = RATE): Float32Array {
  const out = new Float32Array(Math.round((ms / 1000) * rate))
  out.fill(amplitude)
  return out
}

/** Ruido pseudoaleatorio determinista (LCG): cruza por cero ~0.5. */
export function whiteNoise(ms: number, amplitude = 0.3, rate = RATE): Float32Array {
  const n = Math.round((ms / 1000) * rate)
  const out = new Float32Array(n)
  let seed = 123456789
  for (let i = 0; i < n; i += 1) {
    seed = (1103515245 * seed + 12345) % 2147483648
    out[i] = ((seed / 2147483648) * 2 - 1) * amplitude
  }
  return out
}

/** Portadora sostenida: RMS constante, ZCR en banda, SIN modulacion. */
export function tone(ms: number, freq = 180, amplitude = 0.3, rate = RATE): Float32Array {
  const n = Math.round((ms / 1000) * rate)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / rate)
  return out
}

/** Habla sintetica: portadora en banda + envelope silabico (~4 Hz). */
export function speech(ms: number, rate = RATE): Float32Array {
  const n = Math.round((ms / 1000) * rate)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const t = i / rate
    const envelope = 0.05 + 0.35 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t))
    out[i] = envelope * Math.sin(2 * Math.PI * 180 * t)
  }
  return out
}
