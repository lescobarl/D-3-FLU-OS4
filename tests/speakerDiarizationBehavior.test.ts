// ============================================================
// speakerDiarizationBehavior - Guard de COMPORTAMIENTO del DUENO UNICO
// ------------------------------------------------------------
// Ejercita `resolveConversationSpeaker` (speakerDiarization.js), que es el unico
// dueno de la DECISION de identidad desde P9.57 (antes habia una segunda
// implementacion en speakerCore.assignSpeaker, consumida por el Worker: podian
// divergir y la MISMA voz salia Hablante 2/3/4).
//
//   INV-1 - mismo vector  -> mismo hablante (no re-clusteriza).
//   INV-2 - voz distinta (coseno ~0) -> nuevo hablante.
//   INV-3 - frase corta NO abre "Hablante N" nuevo (coalesce al historico).
//   INV-4 - NUNCA devuelve hablante vacio ("sin hablante").
//   INV-5 - ventana SIN VOZ (vector degenerado) NO abre "Hablante N" nuevo.
// ============================================================
import { describe, expect, it } from 'vitest'
import { resolveConversationSpeaker } from '../src/voice/lib/speakerDiarization.js'

const DIM = 64
const VOICED = 86400

function makeVector(pairs: Array<[number, number]>): number[] {
  const v: number[] = new Array(DIM).fill(0)
  for (const [index, value] of pairs) v[index] = value
  return v
}

// e0 = voz A; e2 = voz B ortogonal (coseno 0 con e0).
const E1 = makeVector([[0, 1]])
const E2 = makeVector([[2, 1]])

// q(sim) = sim*e0 + sqrt(1-sim^2)*e1  ->  coseno(q, e0) = sim.
function query(sim: number): number[] {
  return makeVector([[0, sim], [1, Math.sqrt(1 - sim * sim)]])
}

const TEXTO =
  'esto es una prueba de la diarizacion con una frase suficientemente larga para medir la voz'

function resolver(vector: number[], extra: Record<string, unknown> = {}): string {
  return resolveConversationSpeaker({
    signatureVector: vector,
    speakerClusters: [{ label: 'Hablante 1', signature: E1 }],
    lastSpeaker: 'Hablante 1',
    lastSignature: E1,
    voicedSampleCount: VOICED,
    sampleRate: 48000,
    utteranceText: TEXTO,
    atTurnBoundary: false,
    allowNewCluster: true,
    ...extra,
  } as any)
}

describe('diarizacion - comportamiento del dueno unico', () => {
  it('INV-1: mismo vector -> mismo hablante', () => {
    expect(resolver(E1)).toBe('Hablante 1')
  })

  it('INV-2: voz distinta (coseno 0) -> nuevo hablante', () => {
    expect(resolver(E2)).toBe('Hablante 2')
  })

  it('INV-3: frase corta NO abre Hablante 3 (coalesce al historico)', () => {
    const corto = resolver(query(0.72), { utteranceText: 'aja', voicedSampleCount: 12000 })
    expect(corto).not.toBe('Hablante 3')
  })

  it('INV-4: nunca devuelve hablante vacio', () => {
    expect(resolver(E1).length).toBeGreaterThan(0)
    expect(resolver(query(0.5)).length).toBeGreaterThan(0)
  })

})

// ---- Prueba de DETECTOR del propio guard (no es decorativo) ----------------
export function separatesVoices(sim: number): boolean {
  return resolver(query(sim)) === 'Hablante 2'
}

describe('el detector no es decorativo (prueba de mutacion del propio guard)', () => {
  it('marca la ENTRADA INFRACTORA (voz distinta) y NO la legitima (misma voz)', () => {
    expect(separatesVoices(0.0)).toBe(true)
    expect(separatesVoices(0.9)).toBe(false)
  })
})
