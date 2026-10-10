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
  registerSpeakerAlias,
  renameSpeakerRows,
  resetSpeakerAliases,
  resolveSpeakerAlias,
} from '../src/voice/lib/conversationTurnRow'

const clusters = () => [
  { label: 'luis', signature: [1, 0, 0] },
  { label: 'Luis', signature: [1, 0, 0] },
]

function filas(): string[] {
  return useIntegrationStore
    .getState()
    .conversationHistory.filter((e) => e.role === 'user')
    .map((e) => String(e.speakerName || ''))
}

describe('plegado luis/Luis: una identidad, un cluster', () => {
  beforeEach(() => {
    resetSpeakerAliases()
    useIntegrationStore.setState({ conversationHistory: [], activePersonId: undefined })
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

  it('(util) el renombre cubre las DOS grafias de la fila', () => {
    commitUserTurnRow({ text: 'hola que tal', speakerName: 'luis', evidenciaAcustica: false, turnId: 1 } as never)
    commitUserTurnRow({ text: 'vamos a comer', speakerName: 'Luis', evidenciaAcustica: false, turnId: 2 } as never)
    expect(filas()).toEqual(['luis', 'Luis'])
    const cambiadas = renameSpeakerRows(['Luis'], 'Luis Perez')
    expect(cambiadas, 'las dos grafias son la misma voz').toBe(2)
    expect(filas()).toEqual(['Luis Perez', 'Luis Perez'])
  })

  it('(util) el alias de sesion pliega: "luis" y "Luis" resuelven igual', () => {
    expect(registerSpeakerAlias('luis', 'Luis')).toBe(0)
    registerSpeakerAlias('Hablante 2', 'Luis')
    expect(resolveSpeakerAlias('Hablante 2')).toBe('Luis')
    expect(resolveSpeakerAlias('hablante 2')).toBe('Luis')
    expect(resolveSpeakerAlias('HABLANTE 2')).toBe('Luis')
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): la comparacion cruda NO pliega', () => {
    // El defecto medido: comparar la etiqueta cruda da dos clusters para una voz.
    const crudo = new Set(clusters().map((c) => String(c.label).trim()))
    expect(crudo.size, 'comparacion cruda = 2 clusters para UNA voz').toBe(2)
    const plegado = new Set(clusters().map((c) => foldSpeakerKey(c.label)))
    expect(plegado.size, 'con el dueno del plegado = 1').toBe(1)
  })
})
