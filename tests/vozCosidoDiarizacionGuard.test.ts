// ============================================================
// vozCosidoDiarizacionGuard - A3 RE-DERIVADO (dueno, 2026-10-11): UN piso para
// "misma voz". Antes exigia DOS: 0.66 (reutilizacion) y 0.64 (voz nueva) como pisos
// del cosido -> dos valores para el MISMO concepto.
// ------------------------------------------------------------
// DUENO UNICO: `sameVoiceLabelGroup` + `sameVoiceFloor` (speakerClusters.js), piso
// CONFIG (`productionClusterReuseThreshold`, el de la diarizacion, 0.66). La copia
// `sameVoiceCosidoFloor` (que leia `cosineNewVoiceThreshold` = 0.64) esta ELIMINADA:
// el 0.64 queda SOLO para la puerta de "voz NUEVA" de la diarizacion, jamas como piso
// de "misma voz".
// BANDA MEDIDA (2026-10-07): misma voz 0.69-0.74, voz distinta 0.58 -> el piso unico
// (0.66) cae entre las dos bandas y NO necesita un segundo valor.
// ============================================================
import { describe, expect, it } from 'vitest'
import {
  findLabelsWithSharedVoice,
  sameVoiceFloor,
  sameVoiceLabelGroup,
} from '../src/voice/lib/speakerClusters.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const thresholds = (FLU_CONFIG as any).voiceIdentity?.capture?.conversationSpeakerThresholds || {}

/** Vector con coseno EXACTO `c` respecto al ancla [1,0,0]. */
function v(c: number): number[] {
  return [c, Math.sqrt(Math.max(0, 1 - c * c)), 0]
}
const ANCLA = [1, 0, 0]
const MISMA_MEDIA = 0.70 // banda medida de la MISMA voz
const MISMA_ALTA = 0.743 // techo de la banda medida
const BAJO_EL_PISO = 0.649 // por DEBAJO del piso unico: no es la misma voz para el cosido
const OTRA_VOZ = 0.58 // voz distinta medida

const CLUSTERS = [
  { label: 'Luz', signature: ANCLA },
  { label: 'Hablante 1', signature: v(BAJO_EL_PISO) },
  { label: 'Hablante 3', signature: v(MISMA_MEDIA) },
  { label: 'Hablante 4', signature: v(MISMA_ALTA) },
  { label: 'Hablante 2', signature: v(OTRA_VOZ) },
]

describe('A3 - "misma voz": UN piso (el de la diarizacion), no dos', () => {
  it('hay UN solo piso y es CONFIG (productionClusterReuseThreshold)', () => {
    expect(sameVoiceFloor()).toBe(Number(thresholds.productionClusterReuseThreshold))
    expect(MISMA_MEDIA).toBeGreaterThan(sameVoiceFloor())
    expect(OTRA_VOZ).toBeLessThan(sameVoiceFloor())
  })

  it('una voz partida en la banda medida se cose a UNA (el nombre)', () => {
    expect(findLabelsWithSharedVoice(CLUSTERS, 'Luz')).toEqual(['Luz', 'Hablante 3', 'Hablante 4'])
  })

  it('la voz DISTINTA nunca entra, ni la etiqueta por debajo del piso unico', () => {
    const grupo = sameVoiceLabelGroup(CLUSTERS, 'Luz')
    expect(grupo).not.toContain('Hablante 2')
    expect(grupo).not.toContain('Hablante 1')
  })

  it('el 0.64 es la puerta de VOZ NUEVA, jamas el piso de "misma voz"', () => {
    const vozNueva = Number(thresholds.cosineNewVoiceThreshold)
    expect(vozNueva).toBeLessThan(sameVoiceFloor())
    // Si alguien volviera a usarlo como piso del cosido, 'Hablante 1' (0.649) entraria.
    expect(sameVoiceLabelGroup(CLUSTERS, 'Luz', vozNueva)).toContain('Hablante 1')
  })

  it('P9.85 - el cosido es ESTRELLA, no cadena: una 3.a etiqueta que solo se parece a la 2.a NO entra', () => {
    // A(ancla) --0.70-- B --0.70-- C, con C vs A = 0.60 (por DEBAJO del piso 0.66).
    // El encadenamiento transitivo metería C (via B) y con ello fusionaría voces
    // distintas (en esta geometria C queda a ~0.99 de B): se PREFIERE el cosido parcial
    // a la fusion falsa. El contrato se corrigio para declarar la regla ESTRELLA.
    const B = [0.7, Math.sqrt(1 - 0.49), 0]
    const C = [0.6, 0.3922, 0.6974]
    const cadena = [
      { label: 'Luz', signature: ANCLA },
      { label: 'Hablante 2', signature: B },
      { label: 'Hablante 3', signature: C },
    ]
    expect(sameVoiceLabelGroup(cadena, 'Luz')).toEqual(['Luz', 'Hablante 2'])
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): el piso discrimina', () => {
    expect(sameVoiceLabelGroup(CLUSTERS, 'Luz', 0.99)).toEqual(['Luz'])
    expect(sameVoiceLabelGroup(CLUSTERS, 'Luz', 0.1)).toContain('Hablante 2')
    expect(sameVoiceLabelGroup(CLUSTERS, '', 0.66)).toEqual([])
  })
})
