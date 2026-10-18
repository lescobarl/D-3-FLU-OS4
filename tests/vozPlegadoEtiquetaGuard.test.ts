// ============================================================
// vozPlegadoEtiquetaGuard - Plegado luis/Luis: UNA identidad, UN cluster; el renombre
// cubre las DOS grafias.
// ------------------------------------------------------------
// MEDIDO (2026-10-10, log del dueno 14:00-14:08): la sesion acumulaba `['luis']` y
// despues `['luis','Luis']`: la busqueda de cluster (`findClusterByLabel`) y el cosido
// (`sameVoiceLabelGroup`) comparaban la etiqueta CRUDA, asi que 'Luis' no era 'luis' ->
// segundo cluster de la MISMA voz y el renombre de una grafia no tocaba la otra.
//
// REGLA: el plegado de etiquetas lo decide UN dueno (`speakerLabels.foldSpeakerKey`);
// las comparaciones de identidad de voz lo usan.
// ============================================================
import { beforeEach, describe, expect, it } from 'vitest'
import {
  consolidateSpeakerClusters,
  ensureClusterForLabel,
  findClusterByLabel,
  sameVoiceLabelGroup,
} from '../src/voice/lib/speakerClusters.js'
import { foldSpeakerKey } from '../src/voice/lib/speakerLabels.js'
import { useIntegrationStore } from '../src/store/integrationStore'
import {
  commitUserTurnRow,
  renameSpeakerRows,
} from '../src/voice/lib/conversationTurnRow'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow'
import { resetVoiceDirectory } from '../src/voice/lib/speakerDirectory.js'

const clusters = () => [
  { label: 'luis', signature: [1, 0, 0] },
  { label: 'Luis', signature: [1, 0, 0] },
]

/** Etiqueta VISIBLE de cada fila: se resuelve AL MOSTRAR por la VOZ (`speakerId`). */
function filas(): string[] {
  return useIntegrationStore
    .getState()
    .conversationHistory.filter((e) => e.role === 'user')
    .map((e) => resolveRowSpeakerLabel(e))
}

describe('plegado luis/Luis: una identidad, un cluster', () => {
  beforeEach(() => {
    useIntegrationStore.setState({ conversationHistory: [], activePersonId: undefined })
    resetVoiceDirectory()
  })

  it('(util) la MISMA voz case-insensitive es UN cluster y UN grupo de cosido', () => {
    expect(foldSpeakerKey(findClusterByLabel(clusters(), 'Luis')?.label || ''), 'la busqueda pliega').toBe('luis')
    expect(foldSpeakerKey(findClusterByLabel(clusters(), 'luis')?.label || '')).toBe('luis')
    expect(sameVoiceLabelGroup(clusters(), 'Luis').map(foldSpeakerKey), 'un solo grupo').toEqual(['luis'])
    // Dos grafias con timbres DISTINTOS y piso alto: la fusion por NOMBRE las une igual
    // (no depende del coseno: es la misma persona).
    const distintas = [
      { label: 'luis', signature: [1, 0, 0] },
      { label: 'Luis', signature: [0, 1, 0] },
    ]
    expect(consolidateSpeakerClusters(distintas, 0.99), 'una sola identidad').toHaveLength(1)
    // Y la creacion NO abre un segundo cluster para la variante de caja.
    const uno = [{ label: 'luis', signature: [1, 0, 0] }]
    const reusado = ensureClusterForLabel(uno, 'Luis', [0, 1, 0])
    expect(reusado.label).toBe('luis')
    expect(uno).toHaveLength(1)
  })

  it('(util) el renombre cubre las DOS grafias de la fila (misma VOZ plegada)', () => {
    commitUserTurnRow({ text: 'hola que tal', speakerName: 'luis', evidenciaAcustica: true, turnId: 1 } as never)
    commitUserTurnRow({ text: 'vamos a comer', speakerName: 'Luis', evidenciaAcustica: true, turnId: 2 } as never)
    // Las DOS grafias dan el MISMO id de VOZ (plegado case-insensitive): con freeze, la primera
    // fila que se congela puede conservar su grafia escrita. Lo verificable: ambas salen como nombres.
    expect(filas().every((x) => ['Luis', 'luis'].includes(x))).toBe(true)
    // Mandato del dueno 2026-10-13: el registro va por VOZ (DIRECTORIO), NO reescribe filas:
    // UNA sola VOZ cubre las DOS grafias.
    const cambiadas = renameSpeakerRows(['Luis'], 'Luis Perez')
    expect(cambiadas, 'una sola VOZ cubre las dos grafias').toBe(1)
    expect(filas()).toEqual(['Luis Perez', 'Luis Perez'])
  })

  it('(util) el plegado vive en el dueno de la IDENTIDAD: "luis" y "Luis" son el MISMO cluster', () => {
    const c = clusters()
    expect(foldSpeakerKey(findClusterByLabel(c, 'Luis')?.label || ''), 'el plegado lo decide foldSpeakerKey').toBe('luis')
    expect(sameVoiceLabelGroup(c, 'luis'), 'las DOS grafias son UNA identidad (clave plegada)').toHaveLength(1)
    // Y el cosido por FIRMA junta etiquetas que NO son la misma grafia:
    const otro = [
      { label: 'Hablante 1', signature: [1, 0, 0] },
      { label: 'Hablante 2', signature: [0.99, Math.sqrt(1 - 0.99 * 0.99), 0] },
    ]
    expect(sameVoiceLabelGroup(otro, 'Hablante 1'), 'misma voz, etiquetas distintas').toHaveLength(2)
    expect(consolidateSpeakerClusters(c, 0.99), 'misma voz = un cluster').toHaveLength(1)
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): la comparacion cruda NO pliega', () => {
    // El defecto medido: comparar la etiqueta cruda da dos clusters para una voz.
    const crudo = new Set(clusters().map((c) => String(c.label).trim()))
    expect(crudo.size, 'comparacion cruda = 2 clusters para UNA voz').toBe(2)
    const plegado = new Set(clusters().map((c) => foldSpeakerKey(c.label)))
    expect(plegado.size, 'con el dueno del plegado = 1').toBe(1)
  })
})
