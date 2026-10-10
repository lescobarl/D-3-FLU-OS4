// ============================================================
// vozCosidoDiarizacionGuard - A3: el cosido de una voz partida usa el criterio de la
// DIARIZACION, no un umbral propio (0.66).
// ------------------------------------------------------------
// DEFECTO MEDIDO (2026-10-10): `findLabelsWithSharedVoice` cosia las etiquetas de la
// MISMA voz con un piso PROPIO (productionClusterReuseThreshold = 0.66, "reutilizacion
// de cluster") distinto del criterio con el que la diarizacion decide que una voz NO es
// nueva: `cosineNewVoiceThreshold` = 0.64 (banda MEDIDA 2026-10-07: misma voz 0.69-0.74,
// voz distinta 0.58 -> 0.64 cae ENTRE las dos bandas). Con 0.66, una voz partida en
// etiquetas con similitudes 0.649/0.70/0.74 dejaba FUERA la de 0.649: la voz seguia con
// dos etiquetas aunque la diarizacion las considerase la misma.
//
// DUENO UNICO: `sameVoiceLabelGroup` + `sameVoiceCosidoFloor` (speakerClusters.js); el
// piso es CONFIG (`cosineNewVoiceThreshold`), no un literal. `findLabelsWithSharedVoice`
// delega en el dueno.
//
// NACE ROJO: hoy la etiqueta a 0.649 del ancla no entra (0.649 < 0.66).
// ============================================================
import { describe, expect, it } from 'vitest'
import { findLabelsWithSharedVoice, sameVoiceLabelGroup } from '../src/voice/lib/speakerClusters.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const thresholds = (FLU_CONFIG as any).voiceIdentity?.capture?.conversationSpeakerThresholds || {}

/** Vector con coseno EXACTO `c` respecto al ancla [1,0,0]. */
function v(c: number): number[] {
  return [c, Math.sqrt(Math.max(0, 1 - c * c)), 0]
}
const ANCLA = [1, 0, 0]
const MISMA_CERCA = 0.649 // misma voz, por DEBAJO del piso viejo (0.66)
const MISMA_MEDIA = 0.70 // banda medida de la misma voz
const MISMA_ALTA = 0.743 // techo de la banda medida
const OTRA_VOZ = 0.58 // voz distinta medida

const CLUSTERS = [
  { label: 'Luz', signature: ANCLA },
  { label: 'Hablante 1', signature: v(MISMA_CERCA) },
  { label: 'Hablante 3', signature: v(MISMA_MEDIA) },
  { label: 'Hablante 4', signature: v(MISMA_ALTA) },
  { label: 'Hablante 2', signature: v(OTRA_VOZ) },
]

describe('A3 - el cosido usa el criterio de la diarizacion', () => {
  it('el piso del cosido es el de la diarizacion (cosineNewVoiceThreshold), no el 0.66', () => {
    expect(sameVoiceLabelGroup(CLUSTERS, 'Luz')).toContain('Hablante 1')
    expect(Number(thresholds.cosineNewVoiceThreshold)).toBeLessThan(0.66)
    expect(MISMA_CERCA).toBeGreaterThan(Number(thresholds.cosineNewVoiceThreshold))
  })

  it('una voz partida en N etiquetas se cose a UNA (el nombre)', () => {
    expect(findLabelsWithSharedVoice(CLUSTERS, 'Luz')).toEqual([
      'Luz',
      'Hablante 1',
      'Hablante 3',
      'Hablante 4',
    ])
  })

  it('la voz DISTINTA nunca entra (no se cuela por el piso mas bajo)', () => {
    expect(OTRA_VOZ).toBeLessThan(Number(thresholds.cosineNewVoiceThreshold))
    expect(sameVoiceLabelGroup(CLUSTERS, 'Luz')).not.toContain('Hablante 2')
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): con el piso viejo (0.66) la etiqueta NO entra', () => {
    expect(sameVoiceLabelGroup(CLUSTERS, 'Luz', 0.66)).not.toContain('Hablante 1')
    expect(sameVoiceLabelGroup(CLUSTERS, 'Luz', 0.99)).toEqual(['Luz'])
    expect(sameVoiceLabelGroup(CLUSTERS, 'Luz', 0.1)).toContain('Hablante 2')
  })
})
