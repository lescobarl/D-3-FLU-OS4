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

  it('INV-5: ventana SIN VOZ (vector degenerado) NO abre A�Hablante NA� nuevo', () => {
    // RUTA DOBLE MEDIDA (2026-10-08): la MISMA decision "esta ventana trae VOZ" esta
    // escrita en DOS resolvedores vivos: `speakerCore.assignSpeaker` (worker) SI la
    // protege (empty-vector/no-vector) y `resolveProductionSpeakerAtBoundary`
    // (hilo principal, la rama que corre con atTurnBoundary) NO: con un vector de
    // ceros compara coseno 0 con todo y abre `production-forced-new-voice`
    // (medido en el log del dueno: Identity label="Hablante 3" reason=
    // production-forced-new-voice lastSim=0.000, con la MISMA voz). Un vector
    // degenerado NO es "voz distinta": es AUSENCIA de medida -> conservar hablante.
    const clusters: any[] = [{ label: 'Hablante 1', signature: E1 }]
    const r = resolveConversationSpeaker({
      signatureVector: new Array(DIM).fill(0),
      speakerClusters: clusters,
      lastSpeaker: 'Hablante 1',
      lastSignature: E1,
      utteranceText: 'mientras tanto la tele seguia encendida',
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
})

// ---- Prueba de DETECTOR del propio guard (no es decorativo) ----------------
// Predicado EXPORTADO para poder falsificarlo: ¿el nucleo marca esta firma como
// un hablante NUEVO respecto a la de 'Hablante 1'?
export function detectsNewVoice(vec: number[]): boolean {
  const r = assignSpeaker(vec, {
    ...WORKER_OPTS,
    clusters: [{ label: 'Hablante 1', signature: E1 }],
    lastSpeaker: 'Hablante 1',
    lastSignature: E1,
  } as any)
  return r.speakerName === 'Hablante 2'
}

describe('el detector no es decorativo (prueba de mutacion del propio guard)', () => {
  it('marca la ENTRADA INFRACTORA (voz distinta) y NO la legitima (misma voz)', () => {
    // Entrada infractora sintetica: una voz distinta DEBE marcar hablante nuevo.
    expect(detectsNewVoice(E2), 'voz ortogonal debe marcar nuevo hablante').toBe(true)
    expect(detectsNewVoice(query(0.0)), 'voz a coseno 0 debe marcar nuevo hablante').toBe(true)
    // Entrada legitima: la MISMA voz NO debe marcar hablante nuevo.
    expect(detectsNewVoice(E1), 'la misma voz no debe marcar nuevo hablante').toBe(false)
    expect(detectsNewVoice(query(0.9)), 'la misma voz (coseno 0.9) no debe marcar nuevo').toBe(false)
  })
})

// ---- Prueba de DETECTOR del INV-5 (resolvedor del HILO PRINCIPAL) -----------
// El mismo par discriminante: AUSENCIA de medida (degenerado) vs VOZ distinta
// real. El resolvedor del hilo principal debe tratarlas distinto.
export function opensNewVoiceFromMainThread(vec: number[]): boolean {
  const clusters: any[] = [{ label: 'Hablante 1', signature: E1 }]
  const r = resolveConversationSpeaker({
    signatureVector: vec,
    speakerClusters: clusters,
    lastSpeaker: 'Hablante 1',
    lastSignature: E1,
    utteranceText: 'mientras tanto la tele seguia encendida',
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
  return r !== 'Hablante 1'
}

describe('INV-5 - el detector no es decorativo (ausencia de medida != voz distinta)', () => {
  it('el vector degenerado NO abre etiqueta; una voz distinta real SI', () => {
    expect(opensNewVoiceFromMainThread(new Array(DIM).fill(0)), 'sin VOZ no abre etiqueta').toBe(false)
    expect(opensNewVoiceFromMainThread(E2), 'voz distinta real SI abre etiqueta').toBe(true)
  })
})
