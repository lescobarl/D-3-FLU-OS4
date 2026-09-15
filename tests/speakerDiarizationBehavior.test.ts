// ============================================================
// speakerDiarizationBehavior.test.ts — Guard de COMPORTAMIENTO
// ------------------------------------------------------------
// Ejecuta el núcleo puro (speakerCore.assignSpeaker) y el resolver
// único (speakerDiarization.resolveConversationSpeaker) y afirma 4
// invariantes de producto:
//   INV-1 — mismo vector → mismo hablante (no re-clusteriza).
//   INV-2 — voz distinta (coseno ~0) → nuevo hablante.
//   INV-3 — frase corta NO abre «Hablante N» nuevo (coalesce al histórico).
//   INV-4 — NUNCA devuelve hablante vacío ("sin hablante").
// ============================================================
import { describe, expect, it } from 'vitest'
import { assignSpeaker } from '../src/voice/lib/speakerCore.js'
import { resolveConversationSpeaker } from '../src/voice/lib/speakerDiarization.js'

const DIM = 64

function makeVector(pairs: Array<[number, number]>): number[] {
  const v: number[] = new Array(DIM).fill(0)
  for (const [index, value] of pairs) v[index] = value
  return v
}

// e0 = voz A; e2 = voz B ortogonal (coseno 0 con e0).
const E1 = makeVector([[0, 1]])
const E2 = makeVector([[2, 1]])

// q(sim) = sim·e0 + √(1−sim²)·e1 → coseno(q, e0) = sim.
function query(sim: number): number[] {
  return makeVector([[0, sim], [1, Math.sqrt(1 - sim * sim)]])
}

const WORKER_OPTS = {
  continuityThreshold: 0.7,
  newVoiceThreshold: 0.68,
  matchThresholdCluster: 0.76,
}

describe('diarización — comportamiento del núcleo puro', () => {
  it('INV-1: mismo vector → mismo hablante', () => {
    const clusters: any[] = [{ label: 'Hablante 1', signature: E1 }]
    const r = assignSpeaker(E1, {
      ...WORKER_OPTS,
      clusters,
      lastSpeaker: 'Hablante 1',
      lastSignature: E1,
    } as any)
    expect(r.speakerName).toBe('Hablante 1')
    expect(r.reason).toMatch(/cluster|continuity|coalesce/)
    expect(r.similarity).toBeCloseTo(1, 4)
  })

  it('INV-2: voz distinta (coseno 0) → nuevo hablante', () => {
    const clusters: any[] = [{ label: 'Hablante 1', signature: E1 }]
    const r = assignSpeaker(E2, {
      ...WORKER_OPTS,
      clusters,
      lastSpeaker: 'Hablante 1',
      lastSignature: E1,
    } as any)
    expect(r.speakerName).toBe('Hablante 2')
    expect(r.reason).toMatch(/new-voice|below-threshold/)
  })

  it('INV-3: frase corta NO abre «Hablante N» nuevo', () => {
    const clusters: any[] = [{ label: 'Hablante 1', signature: E1 }]
    const r = resolveConversationSpeaker({
      signatureVector: query(0.9),
      speakerClusters: clusters,
      lastSpeaker: 'Hablante 1',
      lastSignature: E1,
      utteranceText: 'hola',
      voicedSampleCount: 20000,
      sampleRate: 48000,
      thresholds: {
        shortUtteranceHistoricalMatch: 0.7,
        cosineMatchThreshold: 0.76,
        cosineContinuityThreshold: 0.7,
        cosineNewVoiceThreshold: 0.68,
      },
      atTurnBoundary: true,
      allowNewCluster: true,
    } as any)
    expect(r).toBe('Hablante 1')
    expect(clusters.map((c) => c.label)).toEqual(['Hablante 1'])
  })

  it('INV-4: nunca devuelve hablante vacío', () => {
    const emptyWorker = assignSpeaker([], {})
    expect(String(emptyWorker.speakerName).trim()).not.toBe('')
    expect(String(emptyWorker.speakerName).trim()).toBeTruthy()

    const emptyResolve = resolveConversationSpeaker({
      signatureVector: [],
      speakerClusters: [],
      voicedSampleCount: 0,
    } as any)
    expect(String(emptyResolve).trim()).not.toBe('')
    expect(String(emptyResolve).trim()).toBeTruthy()
  })
})
