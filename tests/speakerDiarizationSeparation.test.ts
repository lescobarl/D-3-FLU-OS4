// ============================================================
// speakerDiarizationSeparation.test.ts — Guard de SEPARACIÓN multihablante
// ------------------------------------------------------------
// Ejecuta el núcleo puro con LOS VALORES REALES DE CONFIG (sin thresholds
// explícitos) y afirma que voces distintas (hombre/mujer, adulto/niño) se
// separan en etiquetas distintas, mientras que la misma voz se conserva.
// ============================================================
import { describe, expect, it } from 'vitest'
import { assignSpeaker } from '../src/voice/lib/speakerCore.js'

const DIM = 64

function makeVector(pairs: Array<[number, number]>): number[] {
  const v: number[] = new Array(DIM).fill(0)
  for (const [index, value] of pairs) v[index] = value
  return v
}

// e0 = voz A (hombre adulto). e2 = voz B ortogonal (coseno 0 con A).
const E_A = makeVector([[0, 1]])
const E_B = makeVector([[2, 1]])

// query(sim) = sim·e0 + √(1−sim²)·e1 → coseno(query(sim), e0) = sim.
function query(sim: number): number[] {
  return makeVector([[0, sim], [1, Math.sqrt(1 - sim * sim)]])
}

// Clusters con la forma que espera el núcleo puro (JS sin tipos).
type Cluster = { label: string; signature: number[] }

describe('diarización — separación multihablante (config real, sin thresholds explícitos)', () => {
  it('voz distinta (coseno 0.50, p. ej. hombre vs mujer) → hablante distinto', () => {
    const clusters: Cluster[] = [{ label: 'Hablante 1', signature: E_A }]
    const r = assignSpeaker(query(0.5), {
      clusters,
      lastSpeaker: 'Hablante 1',
      lastSignature: E_A,
    } as any)
    expect(r.speakerName).toBe('Hablante 2')
    expect(r.reason).toMatch(/new-voice|below-threshold/)
  })

  it('voz ortogonal (coseno 0) → hablante distinto', () => {
    const clusters: Cluster[] = [{ label: 'Hablante 1', signature: E_A }]
    const r = assignSpeaker(E_B, {
      clusters,
      lastSpeaker: 'Hablante 1',
      lastSignature: E_A,
    } as any)
    expect(r.speakerName).toBe('Hablante 2')
  })

  it('misma voz (coseno 0.90) → mismo hablante (no se parte)', () => {
    const clusters: Cluster[] = [{ label: 'Hablante 1', signature: E_A }]
    const r = assignSpeaker(query(0.9), {
      clusters,
      lastSpeaker: 'Hablante 1',
      lastSignature: E_A,
    } as any)
    expect(r.speakerName).toBe('Hablante 1')
    expect(r.reason).toMatch(/cluster|continuity|prefer/)
  })
})
