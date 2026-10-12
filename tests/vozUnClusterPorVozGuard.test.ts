// ============================================================
// vozUnClusterPorVozGuard - A6: UNA VOZ = UN CLUSTER (tope + fusion por el criterio de la
// diarizacion).
// ------------------------------------------------------------
// MEDIDO (2026-10-10, antes de tocar):
//   - "N turnos de una voz -> 1 cluster" YA se cumple con la banda medida (0.60-0.72):
//     el resolver de la diarizacion mantiene la etiqueta (production-cluster-match).
//   - El TOPE estaba INERTE: los tres valores de config estan a 0
//     (`conversationMaxAutoSpeakers`, `maxAutoSpeakersSoftCap`, `maxAutoSpeakersInRoom`) y
//     `nextAutoSpeakerLabel` trata el 0 como SIN tope (limite 9999): una sala podia
//     acumular etiquetas automaticas sin freno (la inflacion medida H1..H5 con 2 personas).
//   - La FUSION por criterio existe (`consolidateSpeakerClusters` + `sameVoiceFloor`) pero
//     NO estaba unida al tope en UN dueno: se consolidaba por un lado y el tope vivia en otro.
//
// DUENO UNICO: `capAndFuseSpeakerClusters` (speakerClusters.js) = fusiona por el criterio de
// la diarizacion y despues aplica el tope de etiquetas AUTOMATICAS (fusionando el exceso en
// el cluster mas parecido). Lo consume el preflight de identidad al escribir los clusters.
// ============================================================
import { describe, expect, it } from 'vitest'
import {
  capAndFuseSpeakerClusters,
  sameVoiceFloor,
  autoSpeakerCount,
} from '../src/voice/lib/speakerClusters.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import { resolveConversationSpeaker } from '../src/voice/lib/voiceIdentity.js'

function v(cos: number, dim = 64): number[] {
  const out = new Array(dim).fill(0)
  out[0] = cos
  out[1] = Math.sqrt(Math.max(0, 1 - cos * cos))
  return out
}

const topeConfig = () =>
  Number((FLU_CONFIG as never as { voiceIdentity: { capture: { conversationMaxAutoSpeakers: number } } }).voiceIdentity.capture.conversationMaxAutoSpeakers)

describe('A6 - una voz = un cluster (tope + fusion)', () => {
  it('el TOPE esta configurado (no 0 = sin tope)', () => {
    expect(topeConfig()).toBeGreaterThan(0)
  })

  it('la voz PARTIDA en varios clusters se fusiona con el criterio de la diarizacion', () => {
    // La voz DISTINTA vive en OTRO plano: si no, la geometria de 2-D hace que todo se
    // parezca (leccion de A3) y el guard mediria un artefacto del fixture.
    const otraVoz = (c: number, dim = 64): number[] => {
      const out = new Array(dim).fill(0)
      out[0] = c
      out[2] = Math.sqrt(Math.max(0, 1 - c * c))
      return out
    }
    const clusters = [
      { label: 'Hablante 1', signature: v(1) },
      { label: 'Hablante 2', signature: v(0.7) },
      { label: 'Hablante 3', signature: v(0.71) },
      { label: 'Hablante 4', signature: otraVoz(0.58) },
    ]
    const out = capAndFuseSpeakerClusters(clusters, { maxAuto: topeConfig(), floor: sameVoiceFloor() })
    expect(out.map((c) => c.label)).toEqual(['Hablante 1', 'Hablante 4'])
  })

  it('con el tope, las etiquetas AUTOMATICAS no pasan del tope (fusion del exceso)', () => {
    const tope = 3
    const clusters = Array.from({ length: 7 }, (_, i) => ({
      label: `Hablante ${i + 1}`,
      signature: v(0.2 + i * 0.01),
    }))
    const out = capAndFuseSpeakerClusters(clusters, { maxAuto: tope, floor: sameVoiceFloor() })
    expect(autoSpeakerCount(out)).toBeLessThanOrEqual(tope)
  })

  it('N turnos de una voz => 1 cluster (fijado con el resolver real)', () => {
    const clusters: any[] = []
    for (let turn = 0; turn < 8; turn += 1) {
      resolveConversationSpeaker({
        speakerClusters: clusters,
        sessionPrimary: '',
        signatureVector: v(0.70 + turn * 0.002),
        voicedSampleCount: 96000,
        minVoicedSamples: 12000,
        sampleRate: 48000,
        utteranceText: 'esta es una frase de prueba para voz',
        atTurnBoundary: true,
        allowNewCluster: true,
      } as never)
    }
    expect(clusters.length).toBe(1)
  })


  it('PRUEBA DE DETECTOR (el detector no es decorativo): el criterio y el tope discriminan', () => {
    const clusters = [
      { label: 'Hablante 1', signature: v(1) },
      { label: 'Hablante 2', signature: v(0.70) },
    ]
    // Sin piso no hay fusion; sin tope no hay cap.
    expect(capAndFuseSpeakerClusters(clusters, { maxAuto: 0, floor: 0.99 })).toHaveLength(2)
    expect(capAndFuseSpeakerClusters(clusters, { maxAuto: 0, floor: sameVoiceFloor() })).toHaveLength(1)
  })
})


describe('REPRO del dueno 2026-10-11 - sin evidencia medida NO se abre voz nueva', () => {
  it('misma voz a coseno 0.5 del cluster, lastSpeaker = esa voz => conserva la anterior (Hablante 1)', () => {
    const clusters: any[] = [{ label: 'Hablante 1', signature: v(1) }]
    const out = resolveConversationSpeaker({
      speakerClusters: clusters,
      sessionPrimary: '',
      signatureVector: v(0.5),
      lastSpeaker: 'Hablante 1',
      lastSignature: v(1),
      voicedSampleCount: 96000,
      minVoicedSamples: 12000,
      sampleRate: 48000,
      utteranceText: 'esta es una frase de prueba para voz',
      atTurnBoundary: true,
      allowNewCluster: true,
    } as never)
    expect(out, 'sin evidencia no se acuna una etiqueta nueva').toBe('Hablante 1')
    expect(clusters.length, 'un cluster por voz, no dos').toBe(1)
  })
})
