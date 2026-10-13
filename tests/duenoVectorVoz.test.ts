// ============================================================
// duenoVectorVoz - La IDENTIDAD es el VECTOR de la voz; el nombre es su ETIQUETA.
// ------------------------------------------------------------
// Diseno del DUENO (2026-10-13): la diarizacion entrega, por hablante, una cadena de numeros
// que ES la identificacion de la voz (el vector). El nombre NO es la identidad:
//   1) "ok flu soy luis" -> se toma el VECTOR de esa voz y se guarda en la base de
//      participantes con DOS datos: participante + vector.
//   2) En otra sesion, la misma voz entra como "Hablante N <vector SIMILAR>"; se busca ese
//      vector en la base y, si coincide, deja de ser "Hablante N" y pasa a ser "luis".
//   3) Una voz DISTINTA (vector no similar) NUNCA hereda ese nombre.
//   4) El panel de participantes muestra SOLO los que participan en LA SESION; la base se
//      consulta aparte.
// NACE ROJO: hoy la base no guarda vector y no hay reconocimiento por voz.
// ============================================================
import { describe, expect, it, beforeEach } from 'vitest'
import { matchParticipantByVoice } from '../src/voice/lib/participantVoiceMatch.js'
import { resolveVoiceParticipants } from '../src/voice/lib/voiceParticipantsSource'

/** Vector de LUIS (la "cadena de numeros" de la diarizacion) y uno de OTRA voz. */
const VECTOR_LUIS = [0.9, 0.4, 0.05, 0.0]
const VECTOR_LUIS_SIMILAR = [0.88, 0.44, 0.06, 0.02]
const VECTOR_OTRA = [0.0, 0.05, 0.3, 0.95]

describe('V1 - la base guarda el VECTOR de la voz junto al participante', () => {
  it('un participante con vector se resuelve por SIMILITUD (la voz es la identidad)', () => {
    const base = [{ name: 'Luis', speakerLabel: 'Hablante 2', voiceVector: VECTOR_LUIS }]
    const match = matchParticipantByVoice(VECTOR_LUIS_SIMILAR, base)
    expect(match?.name, 'el mismo timbre (otra sesion) es Luis').toBe('Luis')
  })

  it('una voz DISTINTA no hereda el nombre (no se mezclan hablantes)', () => {
    const base = [{ name: 'Luis', voiceVector: VECTOR_LUIS }]
    expect(matchParticipantByVoice(VECTOR_OTRA, base), 'timbre distinto -> nadie').toBe(null)
  })

  it('sin vector de la voz no se afirma nada', () => {
    expect(matchParticipantByVoice([], [{ name: 'Luis', voiceVector: VECTOR_LUIS }])).toBe(null)
  })
})

// Prueba de DETECTOR: la marca discrimina (el detector no es decorativo).
describe('PRUEBA DE DETECTOR (el detector no es decorativo: la marca discrimina)', () => {
  it('mutacion: con el piso a 1.0 nada empareja; con el piso real, el mismo timbre SI', () => {
    const base = [{ name: 'Luis', voiceVector: VECTOR_LUIS }]
    expect(matchParticipantByVoice(VECTOR_LUIS_SIMILAR, base, { floor: 1 })?.name || null).toBe(null)
    expect(matchParticipantByVoice(VECTOR_LUIS_SIMILAR, base)?.name).toBe('Luis')
    expect(matchParticipantByVoice(VECTOR_OTRA, base)?.name || null).toBe(null)
  })
})

describe('V2 - el panel muestra SOLO los participantes de la SESION', () => {
  beforeEach(() => {
    // (no toca el store: es una funcion pura)
  })

  it('la base NO se vuelca entera en el panel; el que hablo SI aparece', () => {
    const lista = resolveVoiceParticipants({
      history: [{ speakerName: 'luis' }],
      profiles: [{ label: 'luis', id: 'p1' }],
      base: [{ name: 'Pedro' }, { name: 'Ana' }],
    })
    const labels = lista.map((r) => r.label)
    expect(labels, 'el que participo en la sesion').toContain('luis')
    expect(labels, 'los de la base que NO hablaron no se listan').not.toContain('Pedro')
    expect(labels).not.toContain('Ana')
  })
})
