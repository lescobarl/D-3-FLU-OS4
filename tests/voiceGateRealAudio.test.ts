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
import { countSpeechLikeSamples, countVoicedSamples, frameRms } from '../src/voice/lib/voicedActivity.js'

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

/**
 * VOZ real del audio (ms), con el MISMO dueño que mide el cierre
 * (`vozMsDeMuestras` → `countVoicedSamples`). No es la duración de la ventana:
 * una captura con silencio no sostiene texto.
 * @param samples PCM real.
 * @returns Milisegundos de VOZ medida.
 */
function vozReal(samples: Float32Array): number {
  return (countVoicedSamples(samples, { sampleRate: RATE }) / RATE) * 1000
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

// ============================================================
// RESPALDO POR TRAMO (docs/CONTRATO-ASR-LOCAL.md §6): la MISMA puerta se
// amplía con la evidencia que el módulo ya mide sobre el tramo CERRADO.
// Los casos límite usan el audio real del dueño; los números del hueco son los
// MEDIDOS en la grabación de referencia b6d82bca.
// ============================================================
describe('respaldo por tramo — la puerta exige evidencia del tramo cerrado', () => {
  const runtime = getLocalFallbackRuntimeConfig()
  const habla = leerWav('habla-real-600ms.wav')
  const metricsHabla = metricaReal(habla)
  const vozHabla = vozReal(habla)

  it('el audio real de habla corta tiene VOZ suficiente para el respaldo', () => {
    // ANTI-VACUIDAD: los casos positivos de abajo pasan la puerta de VOZ primero.
    expect(metricsHabla.durationMs).toBeCloseTo(600, 0)
    expect(vozHabla).toBeGreaterThanOrEqual(runtime.minVozMs)
  })

  it('el hueco 67–95 s de b6d82bca se RECHAZA: 120 ms de VOZ no sostienen «Back to the cojo»', () => {
    // MEDIDO en la fila 3c37f4f6 de la grabación de referencia (Playback
    // b6d82bca): el tramo midió vozMs=120 (< minMs 350) y su descarte fue
    // `sinTexto`. El texto alucinado de Whisper sobre silencio no debe entrar.
    const decision = classifyLocalResult({
      isFinal: true,
      vozMs: 120,
      text: 'Back to the cojo',
      audioSeconds: 4.5,
    })
    expect(decision).toMatchObject({ keep: false, reason: 'sin-voz' })
  })

  it('audio real SIN habla: la VOZ medida (230 ms) no llega al piso y el descarte es `sin-voz`', () => {
    const muestras = leerWav('no-habla-800ms.wav')
    expect(vozReal(muestras)).toBeLessThan(runtime.minVozMs)
    expect(
      classifyLocalResult({
        isFinal: true,
        metrics: metricaReal(muestras),
        vozMs: vozReal(muestras),
        text: 'Back to the cojo',
        audioSeconds: 0.8,
      }),
    ).toMatchObject({ keep: false, reason: 'sin-voz' })
  })

  it('el piso de VOZ es el de la config y su borde se ACEPTA (349 rechaza, 350 conserva)', () => {
    const base = {
      isFinal: true,
      metrics: metricsHabla,
      text: 'hola',
      audioSeconds: metricsHabla.durationMs / 1000,
    }
    expect(
      classifyLocalResult({ ...base, vozMs: runtime.minVozMs - 1 }),
    ).toMatchObject({ keep: false, reason: 'sin-voz' })
    expect(classifyLocalResult({ ...base, vozMs: runtime.minVozMs })).toMatchObject({
      keep: true,
      reason: null,
    })
  })

  it('voz y habla reales SIN texto: no hay fila local (mejor sinTexto que alucinar)', () => {
    expect(
      classifyLocalResult({
        isFinal: true,
        metrics: metricsHabla,
        vozMs: vozHabla,
        text: '   ',
        audioSeconds: metricsHabla.durationMs / 1000,
      }),
    ).toMatchObject({ keep: false, reason: 'sin-texto' })
  })

  it('un texto humano-imposible para la duración real del tramo se RECHAZA', () => {
    // 10 palabras en 600 ms reales = 16,7 palabras/s; el máximo humano medido
    // en b6d82bca fue 5,31 palabras/s (fila ef5f8a23).
    const decision = classifyLocalResult({
      isFinal: true,
      metrics: metricsHabla,
      vozMs: vozHabla,
      text: 'uno dos tres cuatro cinco seis siete ocho nueve diez',
      audioSeconds: metricsHabla.durationMs / 1000,
    })
    expect(decision).toMatchObject({ keep: false, reason: 'imposible' })
  })

  it('un decoder en BUCLE (palabras repetidas) se RECHAZA', () => {
    // Ventana real de 1,8 s (el fixture de habla concatenado 3 veces): 9
    // palabras = 5 palabras/s, dentro del máximo humano; el descarte lo decide
    // el colapso del dueño (`collapseRepeatedSpeech`) al quedar 3 únicas.
    const hablaLarga = new Float32Array(habla.length * 3)
    hablaLarga.set(habla, 0)
    hablaLarga.set(habla, habla.length)
    hablaLarga.set(habla, habla.length * 2)
    const decision = classifyLocalResult({
      isFinal: true,
      metrics: metricaReal(hablaLarga),
      vozMs: vozReal(hablaLarga),
      text: 'hola cómo estás hola cómo estás hola cómo estás',
      audioSeconds: hablaLarga.length / RATE,
    })
    expect(decision).toMatchObject({ keep: false, reason: 'bucle' })
  })

  it('un texto SIN letras latinas (otro idioma) se RECHAZA', () => {
    const decision = classifyLocalResult({
      isFinal: true,
      metrics: metricsHabla,
      vozMs: vozHabla,
      text: 'こんにちは',
      audioSeconds: metricsHabla.durationMs / 1000,
    })
    expect(decision).toMatchObject({ keep: false, reason: 'idioma' })
  })

  it('texto plausible con voz y habla reales: la puerta lo CONSERVA', () => {
    expect(
      classifyLocalResult({
        isFinal: true,
        metrics: metricsHabla,
        vozMs: vozHabla,
        text: 'hola qué tal',
        audioSeconds: metricsHabla.durationMs / 1000,
      }),
    ).toMatchObject({ keep: true, reason: null })
  })
})
