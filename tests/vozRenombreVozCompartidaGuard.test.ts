// ============================================================
// vozRenombreVozCompartidaGuard - P9.66: "soy <nombre>" debe renombrar la MISMA voz
// ------------------------------------------------------------
// DEFECTO MEDIDO (pantalla + log del dueno): al decir "Okay flu soy Luz", FLU
// respondia "Registrado Luz." y **ninguna** de las filas cambiaba: el reparto final
// seguia siendo (vacio)=35, luis=4, Hablante 1=1. Las etiquetas automaticas
// ('Hablante 1'..'Hablante 5') acuñadas para SU MISMA voz no se sustituian.
//
// CAUSA RAIZ: `findLabelsWithSharedVoice` (y `findSpeakerLabelsMatchingSignature`)
// traian el umbral de "misma voz" HARDCODEADO en 0.78, POR ENCIMA del techo de la
// banda MEDIDA de la misma voz (0.69-0.74, junto al 0.58 de una voz distinta). El
// predicado era INSATISFACIBLE para la clase que dice cubrir: dos clusters de la
// MISMA voz nunca llegan a 0.78, asi que la unificacion jamas se disparaba. El valor
// correcto ya existia y estaba documentado en UN sitio (productionClusterReuseThreshold
// = 0.66, usado por la consolidacion).
//
// FIX (un solo dueno, sin literal): las dos funciones leen el umbral del dueno unico
// `sameVoiceFloor()` (speakerClusters.js) = config `productionClusterReuseThreshold`;
// `turnSpeakerPreflight.clusterMergeFloor` delega en el mismo dueno (antes era una
// TERCERA copia del criterio).
//
// Nace ROJO con el literal 0.78 (banda 0.70 no se unifica: casos 1 y 2).
// ============================================================
import { describe, it, expect } from 'vitest'
import {
  findLabelsWithSharedVoice,
  findSpeakerLabelsMatchingSignature,
} from '../src/voice/lib/speakerClusters.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const thresholds =
  (FLU_CONFIG as any).voiceIdentity?.capture?.conversationSpeakerThresholds || {}

/** Vector con coseno EXACTO `c` respecto a la base [1,0,0]. */
function v(c: number): number[] {
  return [c, Math.sqrt(Math.max(0, 1 - c * c)), 0]
}
const ANCLA = [1, 0, 0]
const MISMA_VOZ = 0.70 // techo medido de la banda; por debajo del literal 0.78
const OTRA_VOZ = 0.58 // voz distinta medida

const clusters = [
  { label: 'luis', signature: ANCLA },
  { label: 'Hablante 1', signature: v(MISMA_VOZ) },
  { label: 'Hablante 2', signature: v(OTRA_VOZ) },
]

describe('P9.66 - "soy <nombre>" unifica la MISMA voz (banda medida), con el umbral por DEFECTO', () => {
  it('findLabelsWithSharedVoice une la MISMA voz (0.70) y descarta la distinta (0.58)', () => {
    const labels = findLabelsWithSharedVoice(clusters, 'luis')
    expect(labels, 'la MISMA voz del ancla no se unifico (umbral por encima de la banda)').toContain('Hablante 1')
    expect(labels).not.toContain('Hablante 2')
  })

  it('findSpeakerLabelsMatchingSignature une la MISMA voz por firma entrante', () => {
    const labels = findSpeakerLabelsMatchingSignature(clusters, ANCLA, ['Hablante 1', 'Hablante 2'])
    expect(labels).toContain('Hablante 1')
    expect(labels).not.toContain('Hablante 2')
  })

  it('el umbral de "misma voz" cae ENTRE las bandas medidas (ni sobre la misma, ni bajo la distinta)', () => {
    const floor = Number(thresholds.productionClusterReuseThreshold)
    expect(Number.isFinite(floor)).toBe(true)
    expect(floor, 'el umbral no puede superar el techo de la misma voz (0.74)').toBeLessThanOrEqual(0.74)
    expect(floor, 'el umbral no puede bajar del piso de una voz distinta (0.58)').toBeGreaterThan(OTRA_VOZ)
  })

  it('el detector no es decorativo: con el literal viejo (0.78) la MISMA voz NO se unifica', () => {
    expect(findLabelsWithSharedVoice(clusters, 'luis', 0.78)).not.toContain('Hablante 1')
  })
})
