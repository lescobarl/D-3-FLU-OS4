// ============================================================
// vozRendimientoVozGuard - GUARD de los dos degradadores MEDIDOS (P9.6)
// ------------------------------------------------------------
// ANALISIS 2026-10-07 (peticion del dueno: "hay momentos que se alenta"):
//   (1) src/voice/lib/turnIdentityPipeline.js corria el tick cada 800 ms aunque el
//       habla del turno NO hubiera cambiado: se re-embebia la MISMA ventana
//       (log: `Preflight turn=7 ready=true vec=512` repetido cada ~3 s). WavLM-SV
//       sobre 1,8 s cada 800 ms durante toda la sesion es coste puro.
//   (2) src/voice/lib/speakerClusters.js flattenChunksWindow copiaba el buffer
//       ENTERO (hasta 30 s = 11250 chunks = ~1,44 M muestras) y luego tomaba su
//       cola; esa copia corria en cada tick y en cada commit.
//
// FIX (sin ruta nueva): (1) el tick lo gobierna la revision del habla viva
// (`getAudioRevision`): sin habla nueva, no hay nada que embeber. (2) la ventana
// se calcula ANTES y se copian SOLO sus muestras.
//
// Nace ROJO (getAudioRevision no gobernaba el tick y la ventana copiaba todo).
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  startContinuousIdentityPipeline,
  stopAllContinuousIdentityPipelines,
  resetTurnIdentityPipeline,
} from '../src/voice/lib/turnIdentityPipeline.js'
import { flattenChunksWindow } from '../src/voice/lib/speakerClusters.js'

describe('P9.6 (1) - el tick de identidad NO re-embebe sin habla nueva', () => {
  beforeEach(() => {
    resetTurnIdentityPipeline()
    vi.useFakeTimers()
  })
  afterEach(() => {
    stopAllContinuousIdentityPipelines()
    vi.useRealTimers()
  })

  it('con la MISMA revision no relanza el resolutor; con revision nueva, si', async () => {
    let revision = 'a'
    let runs = 0
    startContinuousIdentityPipeline(
      () => 1,
      () => {
        runs += 1
        return () => Promise.resolve({ speakerName: 'Hablante 1', signatureVector: [1, 0, 0] })
      },
      { getAudioRevision: () => revision },
    )
    expect(runs, 'el primer tick siempre corre').toBe(1)

    await vi.advanceTimersByTimeAsync(4000)
    expect(runs, 'sin habla nueva NO se re-embebe').toBe(1)

    revision = 'b'
    await vi.advanceTimersByTimeAsync(1000)
    expect(runs, 'con habla nueva SI se re-embebe').toBe(2)
  })
})

describe('P9.6 (2) - la ventana de audio copia SOLO la ventana', () => {
  it('con un buffer saturado de 30 s no copia el buffer entero', () => {
    const chunks = Array.from({ length: 11250 }, (_, i) => {
      const c = new Float32Array(128)
      c[0] = i
      return c
    })
    const w = flattenChunksWindow(chunks, {
      totalSamples: 1_440_000,
      sinceSample: 0,
      maxSamples: 86_400, // 1.8 s
      minSamples: 43_200,
    })
    expect(w.length).toBe(86_400)
    expect(w.buffer.byteLength, 'no debe copiar los 30 s (5,76 MB)').toBeLessThan(86_400 * 4 * 2)
  })
})

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('la ventana sigue siendo la COLA real del buffer (no recorta contenido)', () => {
    const chunks = [new Float32Array(10).fill(1), new Float32Array(10).fill(2), new Float32Array(10).fill(3)]
    const w = flattenChunksWindow(chunks, { totalSamples: 30, sinceSample: 0, maxSamples: 12, minSamples: 0 })
    expect(w.length).toBe(12)
    expect(Array.from(w).slice(-10).every((v) => v === 3)).toBe(true)
  })
})
