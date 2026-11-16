// @vitest-environment node
// ============================================================
// voiceGateRealAudio - el gate, medido con AUDIO REAL (no metricas inventadas)
// ------------------------------------------------------------
// Los fixtures son recortes de la grabacion de la sesion del dueno
// (d4c1c8f3-76f8-400b-b89e-e8e428cfdff7), PCM16 mono 16k. Ver
// `tests/fixtures/audio/README.md` (origen, duracion y metricas MEDIDAS).
//
// Lo que se fija:
//   1. habla real corta SIN wake  -> speechLike >= umbral y el gate la CONSERVA;
//   2. audio real sin habla con RMS POR ENCIMA del piso (el criterio viejo lo
//      aceptaba) -> speechLike por debajo del umbral y el gate lo DESCARTA;
//   3. la wake conserva un final sin evidencia (excepcion unica);
//   4. LIMITACION DECLARADA: voz de fondo (TV/sala) pasa el gate. El criterio es
//      "el audio parece habla", NO "es habla dirigida a FLU": separar eso exige
//      criterio de HABLANTE (diarizacion), fuera de este modulo. Se prueba para
//      que nadie crea que esta cubierto.
// ============================================================
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  classifyLocalResult,
  getLocalFallbackRuntimeConfig,
} from '../src/voice/lib/voiceLocalFallback.js'
import { countSpeechLikeSamples, frameRms } from '../src/voice/lib/voicedActivity.js'

const RATE = 16000
const DIR = join(process.cwd(), 'tests', 'fixtures', 'audio')

/** PCM16 de un WAV (mono): localiza el chunk 'data' y devuelve Float32Array [-1,1]. */
function leerWav(nombre: string): Float32Array {
  const buf = readFileSync(join(DIR, nombre))
  let off = 12
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'data') {
      const n = Math.floor(size / 2)
      const out = new Float32Array(n)
      for (let i = 0; i < n; i += 1) out[i] = buf.readInt16LE(off + 8 + i * 2) / 32768
      return out
    }
    off += 8 + size + (size % 2)
  }
  throw new Error(`sin chunk 'data' en ${nombre}`)
}

/** Metrica REAL del audio: la misma que adjunta el motor local (`measure`). */
function metricaReal(samples: Float32Array) {
  return {
    durationMs: (samples.length / RATE) * 1000,
    speechLikeMs: (countSpeechLikeSamples(samples, { sampleRate: RATE }) / RATE) * 1000,
    rms: frameRms(samples, 0, samples.length),
  }
}

describe('gate del motor local con AUDIO REAL', () => {
  const runtime = getLocalFallbackRuntimeConfig()

  it('habla real corta SIN wake: el gate la conserva', () => {
    const metrics = metricaReal(leerWav('habla-real-600ms.wav'))
    expect(metrics.durationMs).toBeCloseTo(600, 0)
    expect(metrics.speechLikeMs, 'el habla real corta no llega al umbral').toBeGreaterThanOrEqual(
      runtime.finalMinSpeechLikeMs,
    )
    expect(classifyLocalResult({ isFinal: true, metrics })).toMatchObject({ keep: true, reason: null })
  })

  it('audio real SIN habla (RMS sobre el piso): el gate lo descarta', () => {
    const metrics = metricaReal(leerWav('no-habla-800ms.wav'))
    // El criterio VIEJO (solo RMS) lo habria aceptado: esa es la regresion.
    expect(metrics.rms, 'la fixture debe superar el piso de energia del VAD').toBeGreaterThan(0.02)
    expect(metrics.speechLikeMs).toBeLessThan(runtime.finalMinSpeechLikeMs)
    expect(classifyLocalResult({ isFinal: true, metrics })).toMatchObject({
      keep: false,
      reason: 'not-speech',
    })
  })

  it('la wake conserva un final sin evidencia (excepcion unica, sin lista negra)', () => {
    const metrics = metricaReal(leerWav('no-habla-800ms.wav'))
    expect(classifyLocalResult({ isFinal: true, metrics, wakeMatched: true })).toMatchObject({
      keep: true,
    })
    expect(classifyLocalResult({ isFinal: true, metrics, isNavigationCommand: true })).toMatchObject({
      keep: true,
    })
  })

  it('un parcial de no-habla tambien se descarta (mismo criterio)', () => {
    const metrics = metricaReal(leerWav('no-habla-800ms.wav'))
    expect(classifyLocalResult({ isFinal: false, metrics })).toMatchObject({
      keep: false,
      reason: 'not-speech',
    })
  })

  it('LIMITACION DECLARADA: la voz de FONDO (TV/sala) pasa el gate', () => {
    const metrics = metricaReal(leerWav('fondo-con-voz-800ms.wav'))
    expect(metrics.speechLikeMs, 'si esto deja de pasar, el criterio cambio: medir de nuevo').toBeGreaterThan(
      runtime.finalMinSpeechLikeMs,
    )
    // Documentado, no deseado: acusticamente es habla. Filtrarla exige hablante.
    expect(classifyLocalResult({ isFinal: true, metrics })).toMatchObject({ keep: true })
  })

  it('DECISION (a): el borde de 180 ms se ACEPTA — 500 ms reales con 120 ms de habla se descartan', () => {
    // DECISION DE PRODUCTO (2026-10-21): se mantiene el umbral ABSOLUTO de 180 ms.
    // Medido sobre este mismo audio, dentro de turnos reales: ventanas de 500 ms dan
    // p25 = 90 ms (17/36 por debajo de 180), asi que una minoria de habla MUY corta
    // se descarta. Se acepta el borde; no se baja el umbral para taparlo.
    const metrics = metricaReal(leerWav('habla-real-500ms-borde.wav'))
    expect(metrics.durationMs).toBeCloseTo(500, 0)
    expect(metrics.speechLikeMs).toBeLessThan(runtime.finalMinSpeechLikeMs)
    expect(metrics.speechLikeMs).toBeGreaterThan(0)
    expect(classifyLocalResult({ isFinal: true, metrics })).toMatchObject({
      keep: false,
      reason: 'not-speech',
    })
  })
})
