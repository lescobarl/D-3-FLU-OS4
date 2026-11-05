// @vitest-environment node
// ============================================================
// voiceSilentDegrade - RU 2026-10-20: una pausa con ruido NO enciende Whisper
// ------------------------------------------------------------
// Regresion real: la degradacion por "SR mudo con VOZ en el PCM" comparaba solo
// RMS contra 0,02 y disparaba a los 3,5 s, ANTES del rebuild de Chrome (4,2 s).
// Una pausa normal con ruido/TV bajaba al motor local, que alucina con audio sin
// habla ("¡Y si!", "¡Tuna suma! ..."). Aqui se fija la decision con senales:
//   - ruido/DC con RMS alto y SIN habla  -> NO degrada;
//   - 3,6 s de pausa con ruido           -> NO degrada (ventana larga);
//   - Chrome mudo PROLONGADO con habla y N rebuilds -> SI degrada;
//   - la ventana no puede adelantarse al rebuild de Chrome (invariante).
// ============================================================
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import {
  getLocalFallbackRuntimeConfig,
  getSilentDegradeConfig,
  resolveSilentDegrade,
  shouldDegradeSilentRecognition,
} from '../src/voice/lib/voiceLocalFallback.js'
import { dc, RATE, silence, speech, tone, whiteNoise } from './_speechSignals'

const NOW = 10_000_000

/** Chunks de 200 ms (como los entrega el AudioWorklet). */
function blocks(signal: Float32Array, blockMs = 200): Float32Array[] {
  const size = Math.round((blockMs / 1000) * RATE)
  const out: Float32Array[] = []
  for (let i = 0; i < signal.length; i += size) out.push(signal.subarray(i, Math.min(i + size, signal.length)))
  return out
}

function degrade(chunks: Float32Array[], { sinceMs = 12_000, rebuilds = 2 } = {}) {
  return resolveSilentDegrade({
    chunks,
    sampleRate: RATE,
    now: NOW,
    lastSrResultAt: NOW - sinceMs,
    eligibleSince: 0,
    failedRebuilds: rebuilds,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('config: la degradacion NO se adelanta al rebuild de Chrome', () => {
  it('la ventana por defecto es mayor que el stall de Chrome y exige N rebuilds', () => {
    const cfg = getSilentDegradeConfig()
    const stall = FLU_CONFIG.activeListen.restart.conversationStallMs
    expect(cfg.silentMs).toBeGreaterThan(stall)
    expect(cfg.silentMs).toBeGreaterThanOrEqual(10_000)
    expect(cfg.rebuilds).toBe(2)
    expect(cfg.minSpeechLikeMs).toBeGreaterThan(0)
  })

  it('si la config intenta adelantarla (3500 < 4200), el valor efectivo la corrige', () => {
    const original = FLU_CONFIG.voiceIdentity.capture.recognition.silentDegradeMs
    // Config inyectada a proposito (mutacion del test): `Object.assign` evita que el
    // tipo literal del default congele el valor.
    Object.assign(FLU_CONFIG.voiceIdentity.capture.recognition, { silentDegradeMs: 3500 })
    try {
      const cfg = getSilentDegradeConfig()
      expect(cfg.silentMs).toBeGreaterThan(FLU_CONFIG.activeListen.restart.conversationStallMs)
      expect(shouldDegradeSilentRecognition({ sinceSrResultMs: 3600, speechLikeMs: 1000, failedRebuilds: 5 })).toBe(false)
    } finally {
      Object.assign(FLU_CONFIG.voiceIdentity.capture.recognition, { silentDegradeMs: original })
    }
  })

  it('los finales y parciales se gatean con sus umbrales configurados', () => {
    const runtime = getLocalFallbackRuntimeConfig()
    expect(runtime.finalMinSpeechLikeMs).toBeGreaterThan(0)
    expect(runtime.partialMinSpeechLikeMs).toBeGreaterThan(0)
    expect(runtime.recoveryMs).toBeGreaterThan(0)
    expect(runtime.recoverySegments).toBeGreaterThan(0)
  })
})

describe('resolveSilentDegrade — HABLA, no energia', () => {
  it('ruido con RMS alto y sin habla NO degrada (el defecto medido)', () => {
    const ruido = whiteNoise(12_000, 0.1)
    const out = degrade(blocks(ruido))
    expect(out.speechLikeMs).toBe(0)
    expect(out.voicedMs).toBeGreaterThan(0) // el RMS SI lo ve: por eso no basta
    expect(out.rms).toBeGreaterThan(0.02)
    expect(out.degrade).toBe(false)
  })

  it('un DC fuerte tampoco degrada (energia sin cruces = no es voz)', () => {
    const out = degrade(blocks(dc(12_000)))
    expect(out.speechLikeMs).toBe(0)
    expect(out.degrade).toBe(false)
  })

  it('un tono sostenido no degrada (sin modulacion no es habla)', () => {
    const out = degrade(blocks(tone(12_000)))
    expect(out.speechLikeMs).toBe(0)
    expect(out.degrade).toBe(false)
  })

  it('una pausa de 3,6 s con ruido NO degrada aunque el RMS sea alto', () => {
    const out = degrade(blocks(whiteNoise(3_600, 0.1)), { sinceMs: 3_600 })
    expect(out.degrade).toBe(false)
  })

  it('Chrome mudo PROLONGADO con habla y N rebuilds SI degrada', () => {
    const out = degrade(blocks(speech(12_000)))
    expect(out.speechLikeMs).toBeGreaterThanOrEqual(600)
    expect(out.degrade).toBe(true)
    expect(out.log).toContain('HABLA')
  })

  it('con habla pero MENOS rebuilds de los exigidos NO degrada', () => {
    const out = degrade(blocks(speech(12_000)), { rebuilds: 1 })
    expect(out.degrade).toBe(false)
  })

  it('silencio real con SR mudo no degrada (es la pausa normal)', () => {
    const out = degrade(blocks(silence(12_000)))
    expect(out.degrade).toBe(false)
  })
})
