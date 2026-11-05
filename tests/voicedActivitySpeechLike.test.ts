// @vitest-environment node
// ============================================================
// voicedActivitySpeechLike - el VAD de HABLA (no solo energia)
// ------------------------------------------------------------
// DEFECTO MEDIDO (2026-10-20): la degradacion por "SR mudo con VOZ en el PCM" medía
// SOLO RMS (`countVoicedSamplesInBlocks`), asi que una pausa con ruido/TV contaba
// como voz y encendia Whisper (que alucinaba frases). Este test fija el criterio
// NUEVO con senales sinteticas deterministas y lo falsifica por los dos lados:
//   - DC y ruido blanco NO son habla (RMS alto, pero ZCR fuera de banda);
//   - un TONO sostenido pasa la trama (RMS+ZCR) pero NO el contador (energia plana,
//     sin modulacion: ratio ~1);
//   - una senal con envelope silabico SI cuenta como habla, y cuenta su duracion.
// ============================================================
import { describe, expect, it } from 'vitest'
import {
  countSpeechLikeSamples,
  countSpeechLikeSamplesInBlocks,
  isSpeechLikeFrame,
  rmsOf,
} from '../src/voice/lib/voicedActivity.js'
import { dc, RATE, silence, speech, tone, whiteNoise } from './_speechSignals'

describe('isSpeechLikeFrame — RMS + ZCR (franja de voz)', () => {
  it('un DC NO es habla aunque tenga energia (ZCR = 0)', () => {
    const frame = dc(40, 0.5).subarray(0, 480)
    expect(rmsOf(frame)).toBeGreaterThan(0.02)
    expect(isSpeechLikeFrame(frame)).toBe(false)
  })

  it('el ruido blanco NO es habla (ZCR ~0.5, fuera de la banda)', () => {
    const frame = whiteNoise(40).subarray(0, 480)
    expect(rmsOf(frame)).toBeGreaterThan(0.02)
    expect(isSpeechLikeFrame(frame)).toBe(false)
  })

  it('silencio NO es habla', () => {
    expect(isSpeechLikeFrame(silence(40).subarray(0, 480))).toBe(false)
  })

  it('una trama en banda de voz SI pasa la trama', () => {
    expect(isSpeechLikeFrame(tone(40).subarray(0, 480))).toBe(true)
  })
})

describe('countSpeechLikeSamples — tramas + MODULACION (envelope)', () => {
  it('el silencio cuenta 0', () => {
    expect(countSpeechLikeSamples(silence(1000), { sampleRate: RATE })).toBe(0)
  })

  it('el DC cuenta 0 (energia sin cruces no es voz)', () => {
    expect(countSpeechLikeSamples(dc(1000), { sampleRate: RATE })).toBe(0)
  })

  it('el ruido blanco cuenta 0 (cruces fuera de banda)', () => {
    expect(countSpeechLikeSamples(whiteNoise(1000), { sampleRate: RATE })).toBe(0)
  })

  it('un tono SOSTENIDO pasa la trama pero NO cuenta: energia plana (falsacion)', () => {
    const signal = tone(1000)
    // La trama suelta SI parece voz...
    expect(isSpeechLikeFrame(signal.subarray(0, 480))).toBe(true)
    // ...pero sin modulacion no es habla: el contador la descarta entera.
    expect(countSpeechLikeSamples(signal, { sampleRate: RATE })).toBe(0)
  })

  it('el habla con envelope silabico SI cuenta (y cuenta su duracion)', () => {
    const signal = speech(1000)
    const counted = countSpeechLikeSamples(signal, { sampleRate: RATE })
    expect(counted).toBeGreaterThan(RATE * 0.7)
    expect(counted).toBeLessThanOrEqual(signal.length)
  })
})

describe('countSpeechLikeSamplesInBlocks — misma regla en la cola del buffer', () => {
  it('suma los bloques como si fueran el buffer entero', () => {
    const signal = speech(1000)
    const blocks = [signal.subarray(0, 8000), signal.subarray(8000)]
    const total = countSpeechLikeSamples(signal, { sampleRate: RATE })
    expect(countSpeechLikeSamplesInBlocks(blocks, { sampleRate: RATE })).toBe(total)
  })

  it('windowMs acota a la cola: una ventana de silencio cuenta 0', () => {
    const blocks = [tone(1000), silence(1000)]
    expect(countSpeechLikeSamplesInBlocks(blocks, { sampleRate: RATE, windowMs: 500 })).toBe(0)
  })
})
