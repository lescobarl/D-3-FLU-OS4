// @vitest-environment node
// ============================================================
// voiceFrameSingleOwner - UN dueño del predicado de trama del VAD
// ------------------------------------------------------------
// DEFECTO MEDIDO (2026-10-21): "¿esta trama es voz?" estaba implementado TRES
// veces: `rootMeanSquare` en el segmentador, el bucle de `countVoicedSamples` y
// el bucle de marcado de `selectVoicedWindow`; ademas el segmentador redondeaba
// la trama (`Math.round`) y el conteo truncaba (`Math.floor`), asi que a 22050 Hz
// la trama no medía lo mismo (661 vs 662 muestras).
//
// Aqui se fija:
//   1. `frameSamplesFor` es el canon del REDONDEO (round, el del segmentador);
//   2. para silencio, tono, ruido y mezcla, en 16k/22.05k/44.1k/48k, el
//      predicado, el conteo, la seleccion de ventana y el SEGMENTADOR coinciden
//      en QUE tramas son voz (oraculo RMS independiente escrito en el test);
//   3. el detector de duplicacion es FALSABLE (archivo sintetico infractor ->
//      marca; archivo que importa el helper -> no marca);
//   4. guard de fuente: el segmentador no define `rootMeanSquare` y
//      `voicedActivity` tiene UN solo bucle de energia.
// ============================================================
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  countVoicedSamples,
  frameRms,
  frameSamplesFor,
  isVoicedFrame,
  rmsOf,
  selectVoicedWindow,
} from '../src/voice/lib/voicedActivity.js'
import { createVoiceSegmenter } from '../src/voice/lib/asr/voiceActivitySegmenter.js'
import { silence, tone, whiteNoise } from './_speechSignals'

const ROOT = process.cwd()
const FRAME_MS = 30
const FLOOR = 0.02
const RATES = [16000, 22050, 44100, 48000]

/**
 * ORACULO independiente: RMS por trama escrito en el test (sin usar el src).
 * Si el dueño unico cambia de criterio, esto lo delata.
 */
function referenceFrames(signal: Float32Array, rate: number, frameMs = FRAME_MS, floor = FLOOR) {
  const frame = Math.round((rate * frameMs) / 1000)
  const flags: boolean[] = []
  let voicedSamples = 0
  for (let i = 0; i < signal.length; i += frame) {
    const end = Math.min(i + frame, signal.length)
    let sum = 0
    for (let j = i; j < end; j += 1) sum += signal[j] * signal[j]
    const rms = Math.sqrt(sum / (end - i))
    const voiced = rms >= floor
    flags.push(voiced)
    if (voiced) voicedSamples += end - i
  }
  return { frame, flags, voicedSamples }
}

/** Audio de prueba: silencio + tono (voz por energia) + silencio. */
function mezcla(rate: number): Float32Array {
  const parts = [silence(90, rate), tone(150, 180, 0.3, rate), silence(300, rate)]
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const SEGMENTER_CFG = {
  frameMs: FRAME_MS,
  energyThreshold: FLOOR,
  minSpeechMs: 60,
  minSilenceMs: 60,
  maxSegmentMs: 1000,
  // `0` real: el segmentador lo respeta (`numberOr`, no `Number(x) || 180`).
  preRollMs: 0,
}

describe('frameSamplesFor — el REDONDEO tiene un solo canon (round)', () => {
  it('coincide con el segmentador en 16k, 44.1k y 48k', () => {
    expect(frameSamplesFor(16000, FRAME_MS)).toBe(480)
    expect(frameSamplesFor(44100, FRAME_MS)).toBe(1323)
    expect(frameSamplesFor(48000, FRAME_MS)).toBe(1440)
  })

  it('a 22050 Hz fija round (662), no floor (661) — la divergencia medida', () => {
    const exacto = (22050 * FRAME_MS) / 1000
    expect(exacto).toBe(661.5)
    expect(frameSamplesFor(22050, FRAME_MS)).toBe(662)
    expect(Math.floor(exacto), 'floor era la copia divergente').toBe(661)
  })
})

describe('una sola primitiva: predicado, conteo, ventana y segmentador coinciden', () => {
  for (const rate of RATES) {
    it(`a ${rate} Hz las cuatro rutas ven las MISMAS tramas de voz`, () => {
      const signal = mezcla(rate)
      const oraculo = referenceFrames(signal, rate)

      // 1) predicado por trama == oraculo
      const flags = []
      for (let i = 0; i < signal.length; i += oraculo.frame) {
        flags.push(isVoicedFrame(signal, i, Math.min(i + oraculo.frame, signal.length), FLOOR))
      }
      expect(flags).toEqual(oraculo.flags)

      // 2) conteo == oraculo
      expect(countVoicedSamples(signal, { sampleRate: rate, frameMs: FRAME_MS, rmsFloor: FLOOR })).toBe(
        oraculo.voicedSamples,
      )

      // 3) seleccion de ventana: el tramo devuelto es el bloque de voz (tono)
      const ventana = selectVoicedWindow(signal, { sampleRate: rate, frameMs: FRAME_MS, rmsFloor: FLOOR })
      const vozMs = (oraculo.voicedSamples / rate) * 1000
      const ventanaMs = (ventana.length / rate) * 1000
      expect(Math.abs(ventanaMs - vozMs)).toBeLessThanOrEqual((oraculo.frame / rate) * 1000 + 1)

      // 4) segmentador: abre y cierra en las mismas tramas
      const segmenter = createVoiceSegmenter(SEGMENTER_CFG, rate)
      const eventos = segmenter.push(signal)
      const inicio = eventos.find((e) => e.type === 'speech-start')
      const fin = eventos.find((e) => e.type === 'speech-end')
      expect(inicio, 'el segmentador no abrio turno donde el VAD ve voz').toBeTruthy()
      expect(fin, 'el segmentador no cerro el turno').toBeTruthy()
      const primerTramaVoz = oraculo.flags.indexOf(true)
      // El `atMs` del segmentador es pre-existente y puede ir una trama por
      // detras del primer frame vivo: se exige coincidencia dentro de UNA trama
      // (no se cambia la maquina de estados ni su metadata por este refactor).
      expect(
        Math.abs(Math.round((inicio as { atMs: number }).atMs / FRAME_MS) - primerTramaVoz),
      ).toBeLessThanOrEqual(1)
      expect((fin as { samples: Float32Array }).samples.length).toBeGreaterThanOrEqual(oraculo.voicedSamples)
      // `preRollMs: 0` se respeta: el segmento es voz + las tramas de silencio
      // que cierran el turno, SIN el pre-roll de 180 ms que se colaba antes.
      const tramasDeVoz = oraculo.flags.filter(Boolean).length
      const tramasDeCierre = Math.ceil(SEGMENTER_CFG.minSilenceMs / FRAME_MS)
      expect((fin as { samples: Float32Array }).samples.length).toBe((tramasDeVoz + tramasDeCierre) * oraculo.frame)
    })
  }

  it('silencio y ruido: 0 tramas de voz en las cuatro rutas', () => {
    for (const rate of RATES) {
      const ruido = whiteNoise(300, 0.005, rate)
      const oraculo = referenceFrames(ruido, rate)
      expect(oraculo.voicedSamples).toBe(0)
      expect(countVoicedSamples(ruido, { sampleRate: rate, frameMs: FRAME_MS, rmsFloor: FLOOR })).toBe(0)
      const segmenter = createVoiceSegmenter(SEGMENTER_CFG, rate)
      expect(segmenter.push(ruido)).toHaveLength(0)
    }
  })

  it('el ruido FUERTE es voz por ENERGIA en las cuatro rutas (misma verdad)', () => {
    for (const rate of RATES) {
      const ruido = whiteNoise(300, 0.3, rate)
      const oraculo = referenceFrames(ruido, rate)
      expect(oraculo.voicedSamples).toBeGreaterThan(0)
      expect(countVoicedSamples(ruido, { sampleRate: rate, frameMs: FRAME_MS, rmsFloor: FLOOR })).toBe(
        oraculo.voicedSamples,
      )
    }
  })

  it('frameRms y rmsOf son el MISMO calculo', () => {
    const signal = mezcla(16000)
    expect(frameRms(signal, 0, signal.length)).toBe(rmsOf(signal))
    expect(isVoicedFrame(signal, 0, 480, FLOOR)).toBe(frameRms(signal, 0, 480) >= FLOOR)
  })
})

// ------------------------------------------------------------------
// DETECTOR de duplicacion (exportado: la prueba de mutacion lo alimenta)
// ------------------------------------------------------------------

/** Quita comentarios de linea y de bloque para no marcar documentacion. */
export function sinComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Bucles de energia (RMS) escritos a mano: `sum += x*x` sobre audio. */
export function buclesDeEnergia(texto: string): number {
  return (sinComentarios(texto).match(/sum\s*\+=\s*[A-Za-z_$][\w$]*(?:\[[^\]]*\])?\s*\*\s*[A-Za-z_$][\w$]*(?:\[[^\]]*\])?/g) || []).length
}

/**
 * Archivos del VAD/ASR con una copia del predicado de trama.
 *
 * @param {Array<{ path: string, text: string }>} archivos
 * @param {{ permitido?: Record<string, number> }} [opts] bucles permitidos por archivo
 * @returns {string[]} rutas infractoras con el motivo.
 */
export function infractoresDePredicado(
  archivos: Array<{ path: string; text: string }>,
  { permitido = {} }: { permitido?: Record<string, number> } = {},
): string[] {
  const out: string[] = []
  for (const { path, text } of archivos) {
    const codigo = sinComentarios(text)
    const nombre = path.replace(/\\/g, '/').split('/').pop() || path
    const permitidos = Number(permitido[nombre] ?? 0)
    const bucles = buclesDeEnergia(codigo)
    if (bucles > permitidos) out.push(`${path}: ${bucles} bucle(s) de energia (permitidos ${permitidos})`)
    if (/\brootMeanSquare\b/.test(codigo)) out.push(`${path}: define/usa su propio rootMeanSquare`)
  }
  return out
}

describe('detector de duplicacion — falsable', () => {
  it('marca un archivo sintetico con su PROPIO rootMeanSquare', () => {
    const infractor = `
      function rootMeanSquare(samples) {
        let sum = 0
        for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
        return Math.sqrt(sum / samples.length)
      }
      export const esVoz = (x) => rootMeanSquare(x) >= 0.02
    `
    expect(infractoresDePredicado([{ path: 'sintetico.js', text: infractor }])).toHaveLength(2)
  })

  it('NO marca un archivo que importa el helper', () => {
    const correcto = `
      import { isVoicedFrame } from './voicedActivity.js'
      export const esVoz = (frame) => isVoicedFrame(frame, 0, frame.length, 0.02)
    `
    expect(infractoresDePredicado([{ path: 'sintetico.js', text: correcto }])).toEqual([])
  })

  it('permite el unico bucle de energia del dueño (frameRms)', () => {
    const dueno = 'for (let i = from; i < to; i += 1) sum += data[i] * data[i]'
    expect(infractoresDePredicado([{ path: 'voicedActivity.js', text: dueno }], { permitido: { 'voicedActivity.js': 1 } })).toEqual([])
    expect(infractoresDePredicado([{ path: 'voicedActivity.js', text: dueno }])).toHaveLength(1)
  })
})

describe('guard de fuente — el arbol real', () => {
  const leer = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

  it('voiceActivitySegmenter.js NO define rootMeanSquare y usa el helper', () => {
    const texto = leer('src/voice/lib/asr/voiceActivitySegmenter.js')
    expect(sinComentarios(texto)).not.toMatch(/\brootMeanSquare\b/)
    expect(texto).toContain('isVoicedFrame')
    expect(texto).toContain('frameSamplesFor')
  })

  it('voicedActivity.js tiene UN solo bucle de energia (frameRms)', () => {
    expect(buclesDeEnergia(leer('src/voice/lib/voicedActivity.js'))).toBe(1)
  })

  it('ningun archivo del VAD/ASR duplica el predicado', () => {
    const archivos = [
      'src/voice/lib/voicedActivity.js',
      'src/voice/lib/asr/voiceActivitySegmenter.js',
      'src/voice/lib/asr/whisperRecognitionEngine.js',
      'src/voice/lib/asr/asrConfig.js',
    ].map((rel) => ({ path: rel, text: leer(rel) }))
    expect(
      infractoresDePredicado(archivos, { permitido: { 'voicedActivity.js': 1 } }),
      'el predicado de trama volvio a duplicarse',
    ).toEqual([])
  })
})
