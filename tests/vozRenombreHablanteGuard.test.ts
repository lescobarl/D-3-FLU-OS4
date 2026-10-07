// ============================================================
// vozRenombreHablanteGuard - GUARD del requisito del dueno (#8)
// ------------------------------------------------------------
// REQUISITO: "cuando identifique a un hablante especifico toda su participacion
// debe llevar ese nombre; ejemplo: soy Luis y todo lo que lleve mi hablante debe
// cambiar a Luis".
//
// DEFECTO: la bandera `roomCapture.renameSessionAutoLabelsOnRegister` estaba en
// true y los helpers (`findLabelsWithSharedVoice`, `mergeSpeakerClustersOnRename`)
// existian, pero NINGUN consumidor los usaba: la funcion solo estaba anunciada en
// config. Su participacion anterior conservaba "Hablante N".
//
// FIX: `renameSpeakerRows(labels, name)` (dueno unico de la escritura de filas) y
// el hook lo llama al identificar una persona (applyResolvedSpeaker): las etiquetas
// que son la MISMA voz las aporta el dueno de los clusters.
//
// Nace ROJO (renameSpeakerRows no existia).
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow, renameSpeakerRows, resetSpeakerAliases } from '../src/voice/lib/conversationTurnRow'

const userRows = () => useIntegrationStore.getState().conversationHistory.filter((r) => r.role === 'user')

function sembrar(filas: Array<{ text: string; speaker: string }>) {
  for (const f of filas) {
    commitUserTurnRow({ text: f.text, speakerName: f.speaker, turnId: `t-${f.text}` })
  }
}

describe('identificado el hablante, TODA su participacion lleva su nombre', () => {
  beforeEach(() => {
    useIntegrationStore.getState().resetConversationHistory()
    resetSpeakerAliases()
  })

  it('renombra las filas de su voz (etiquetas de la MISMA voz) y respeta a los demas', () => {
    sembrar([
      { text: 'hola hola como estan todos', speaker: 'Hablante 1' },
      { text: 'soy luis y estoy probando', speaker: 'Hablante 1' },
      { text: 'hoy me robo el estilo lolita', speaker: 'Hablante 2' },
      { text: 'radicado desde hace muchos anos en andorra', speaker: 'Hablante 2' },
    ])
    const cambiadas = renameSpeakerRows(['Hablante 1', 'luis'], 'luis')
    expect(cambiadas).toBe(2)
    const speakers = userRows().map((r) => r.speakerName)
    expect(speakers).toEqual(['luis', 'luis', 'Hablante 2', 'Hablante 2'])
  })

  it('las filas ya nombradas no se tocan (no reescribe de mas)', () => {
    sembrar([{ text: 'ya con nombre', speaker: 'luis' }])
    expect(renameSpeakerRows(['luis'], 'luis')).toBe(0)
    expect(userRows()[0].speakerName).toBe('luis')
  })
})

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  beforeEach(() => {
    useIntegrationStore.getState().resetConversationHistory()
    resetSpeakerAliases()
  })

  it('NO renombra a un hablante ajeno (discrimina por etiqueta)', () => {
    sembrar([
      { text: 'uno', speaker: 'Hablante 1' },
      { text: 'dos', speaker: 'Hablante 3' },
    ])
    renameSpeakerRows(['Hablante 1'], 'luis')
    expect(userRows().map((r) => r.speakerName)).toEqual(['luis', 'Hablante 3'])
  })

  it('sin etiquetas no cambia nada (no borra el hablante)', () => {
    sembrar([{ text: 'uno', speaker: 'Hablante 1' }])
    expect(renameSpeakerRows([], 'luis')).toBe(0)
    expect(userRows()[0].speakerName).toBe('Hablante 1')
  })
})
