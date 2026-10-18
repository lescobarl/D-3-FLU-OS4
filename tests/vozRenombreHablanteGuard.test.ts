// ============================================================
// vozRenombreHablanteGuard - GUARD del requisito del dueno (#8)
// ------------------------------------------------------------
// REQUISITO: "cuando identifique a un hablante especifico toda su participacion debe llevar
// ese nombre; ejemplo: soy Luis y todo lo que lleve mi hablante debe cambiar a Luis".
//
// MANDATO DEL DUENO 2026-10-13 (premisa actualizada): el nombre NO se escribe en las filas ni
// se reescribe ninguna (la conversacion es texto insertado). El nombre se pega a la VOZ en el
// DIRECTORIO y se resuelve AL MOSTRAR: por eso TODA la participacion de esa voz lleva su
// nombre SIN tocar una sola fila. Una VOZ DISTINTA no lo hereda.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow, renameSpeakerRows } from '../src/voice/lib/conversationTurnRow'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow'
import { resetVoiceDirectory } from '../src/voice/lib/speakerDirectory.js'

const userRows = () => useIntegrationStore.getState().conversationHistory.filter((r) => r.role === 'user')
const etiquetas = () => userRows().map((r) => resolveRowSpeakerLabel(r))

function sembrar(filas: Array<{ text: string; speaker: string }>) {
  for (const f of filas) {
    commitUserTurnRow({ text: f.text, speakerName: f.speaker, evidenciaAcustica: true, turnId: `t-${f.text}` })
  }
}

describe('identificado el hablante, TODA su participacion lleva su nombre', () => {
  beforeEach(() => {
    useIntegrationStore.getState().resetConversationHistory()
    resetVoiceDirectory()
  })

  it('la voz nombrada lleva su nombre en TODAS sus filas y la otra voz queda intacta', () => {
    sembrar([
      { text: 'hola hola como estan todos', speaker: 'Hablante 1' },
      { text: 'soy luis y estoy probando', speaker: 'Hablante 1' },
      { text: 'hoy me robo el estilo lolita', speaker: 'Hablante 2' },
      { text: 'radicado desde hace muchos anos en andorra', speaker: 'Hablante 2' },
    ])
    const antes = userRows()
    // El registro del nombre: NO reescribe filas (0) en el mandato 2026-10-13; AMEND 2026-10-17:
    // con freeze del dueno las filas YA MOSTRADAS de esa voz se CONGELAN con el nombre -> cambian.
    const registradas = renameSpeakerRows(['Hablante 1'], 'luis')
    expect(registradas, 'una VOZ registrada').toBe(1)
    expect(userRows().every((r) => r.speakerName !== 'Hablante 1' || r.speakerId !== 'speaker_1'), 'las filas de esa voz se congelan con nombre').toBe(true)
    expect(userRows(), 'la conversacion NO se re-insertó; se ALTERÓ su atributo speakerName (mandato 2026-10-17)').not.toEqual(antes)
  })

  it('una fila ya nombrada se ve igual (el registro no reescribe de mas)', () => {
    sembrar([{ text: 'ya con nombre', speaker: 'Luis' }])
    expect(etiquetas()).toEqual(['Luis'])
    expect(renameSpeakerRows(['Luis'], 'Luis'), 'misma voz, mismo nombre').toBe(1)
    expect(etiquetas()).toEqual(['Luis'])
  })
})

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  beforeEach(() => {
    useIntegrationStore.getState().resetConversationHistory()
    resetVoiceDirectory()
  })

  it('NO nombra a un hablante ajeno (discrimina por VOZ)', () => {
    sembrar([
      { text: 'uno', speaker: 'Hablante 1' },
      { text: 'dos', speaker: 'Hablante 3' },
    ])
    renameSpeakerRows(['Hablante 1'], 'luis')
    expect(etiquetas()).toEqual(['Luis', 'Hablante 3'])
  })

  it('sin etiquetas no cambia nada (no borra el hablante)', () => {
    sembrar([{ text: 'uno', speaker: 'Hablante 1' }])
    expect(renameSpeakerRows([], 'luis')).toBe(0)
    expect(etiquetas()).toEqual(['Hablante 1'])
  })
})
