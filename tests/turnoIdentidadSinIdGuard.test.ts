// @vitest-environment node
/**
 * GUARD: SIN IDENTIDAD DE TURNO NO SE REUTILIZA UNA FILA.
 *
 * Mandato del dueño (auditoria 2026-10-23, 2.ª pasada): `filaPuedeSerDeEsteTurno` devolvía
 * `true` cuando faltaba el id de la fila o el del commit, así que un commit SIN turno podía
 * completar/renombrar la fila de OTRO turno (P9.67 incluido). El id se acuña ANTES del commit;
 * si aun así falta, la respuesta segura es escribir fila nueva.
 *
 * También fija la propiedad que sostiene las DOS puertas de escritura (stream `rawOnly` y
 * resolución del contrato): con el MISMO `turnId` solo puede existir UNA fila.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow } from '../src/voice/lib/conversationTurnRow'
import { resetVoiceDirectory } from '../src/voice/lib/speakerDirectory.js'

const userRows = () => useIntegrationStore.getState().conversationHistory.filter((row) => row.role === 'user')

beforeEach(() => {
  useIntegrationStore.getState().resetConversationHistory()
  resetVoiceDirectory()
})

describe('una locución = una fila, por identidad de turno', () => {
  it('las DOS puertas con el MISMO turnId escriben UNA sola fila', () => {
    // Puerta 1: el stream emite la transcripción cruda (`rawOnly`).
    commitUserTurnRow({ text: 'prepara la receta', speakerName: 'Hablante 1', turnId: 7 })
    // Puerta 2: la resolución del contrato consolida la MISMA locución.
    commitUserTurnRow({ text: 'prepara la receta', speakerName: 'Hablante 1', turnId: 7 })

    expect(userRows()).toHaveLength(1)
  })

  it('SIN turno NUNCA se reutiliza: dos commits sin id = dos filas', () => {
    commitUserTurnRow({ text: 'primera locucion', turnId: null })
    commitUserTurnRow({ text: 'segunda locucion', turnId: null })

    expect(userRows()).toHaveLength(2)
  })

  it('FALSIFICACION: un commit sin turno no toca la fila de otro turno', () => {
    commitUserTurnRow({ text: 'locucion del turno uno', speakerName: 'Hablante 1', turnId: 1 })
    const antes = userRows()[0]

    // Texto que es TROZO del anterior, `replaceLast` y SIN id: antes reutilizaba/renombraba la
    // fila del turno 1 (rama P9.67) porque `null` se leia como "puede ser de este turno".
    commitUserTurnRow({ text: 'locucion del turno', speakerName: 'Hablante 2', turnId: null, replaceLast: true })

    const filas = userRows()
    expect(filas).toHaveLength(2)
    expect(filas[0].id).toBe(antes.id)
    expect(filas[0].text).toBe('locucion del turno uno')
    expect(String(filas[0].speakerName || '')).toBe(String(antes.speakerName || ''))
  })

  it('dos turnos DISTINTOS con el mismo texto = dos filas', () => {
    commitUserTurnRow({ text: 'otra vez lo mismo', turnId: 10 })
    commitUserTurnRow({ text: 'otra vez lo mismo', turnId: 11 })

    expect(userRows()).toHaveLength(2)
  })
})
