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
import { commitUserTurnRow, escribeFilaDeUsuario } from '../src/voice/lib/conversationTurnRow'
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

  it('FALSIFICACION: un fragmento con OTRO turno (10 -> 11) es DOS filas', () => {
    // Mandato del dueño (2026-10-23, 3.ª pasada): P9.67 ya NO cruza turnos. El turno es la
    // única identidad: el recorte se funde con SU fila (mismo turnId), no con la del anterior.
    commitUserTurnRow({ text: 'voy a decir el comando Okay flu Soy Luis', speakerName: 'Hablante 1', turnId: 10 })
    commitUserTurnRow({ text: 'voy a decir el comando', speakerName: 'Hablante 1', turnId: 11, replaceLast: true })

    expect(userRows()).toHaveLength(2)
  })

  it('el MISMO turno SÍ funde el recorte (una fila, gana la completa)', () => {
    commitUserTurnRow({ text: 'voy a decir el comando Okay flu Soy Luis', speakerName: 'Hablante 1', turnId: 10 })
    commitUserTurnRow({ text: 'voy a decir el comando', speakerName: 'Hablante 1', turnId: 10, replaceLast: true })

    expect(userRows()).toHaveLength(1)
  })

  it('dos turnos DISTINTOS con el mismo texto = dos filas', () => {
    commitUserTurnRow({ text: 'otra vez lo mismo', turnId: 10 })
    commitUserTurnRow({ text: 'otra vez lo mismo', turnId: 11 })

    expect(userRows()).toHaveLength(2)
  })
})

/**
 * LAS DOS PUERTAS DE COMMIT (`commitAndResolveTurn` del hook y `emitConversationLog` del
 * stream) se encuentran en el MISMO escritor (`commitUserTurnRow`): lo que decide si una
 * "escribe de más" es el payload, y eso es lo que se fija aquí con las funciones REALES.
 */
describe('las dos puertas de commit no escriben dos filas', () => {
  const hayTexto = (payload: { transcript?: string }) => Boolean(String(payload.transcript || '').trim())

  it('el commit TEMPRANO no escribe fila; el del stream sí (una sola vez)', () => {
    const temprano = { userCommitOnly: true, transcript: 'prepara la receta', turnId: 21 }
    expect(escribeFilaDeUsuario(temprano, { hayTexto: hayTexto(temprano), hablable: true })).toBe(false)

    const stream = { rawOnly: true, transcript: 'prepara la receta', turnId: 21 }
    expect(escribeFilaDeUsuario(stream, { hayTexto: hayTexto(stream), hablable: true })).toBe(true)
  })

  it('las dos puertas que SÍ escriben, con el mismo turno, dejan UNA fila', () => {
    const stream = { rawOnly: true, transcript: 'prepara la receta', speakerName: 'Hablante 1', turnId: 21 }
    const contrato = { rawOnly: false, transcript: 'prepara la receta', speakerName: 'Hablante 1', turnId: 21 }

    for (const payload of [stream, contrato]) {
      if (!escribeFilaDeUsuario(payload, { hayTexto: hayTexto(payload), hablable: true })) continue
      commitUserTurnRow({ text: payload.transcript, speakerName: payload.speakerName, turnId: payload.turnId })
    }

    expect(userRows()).toHaveLength(1)
  })

  it('un payload sin texto no escribe (ni el del stream ni el del contrato)', () => {
    for (const payload of [{ rawOnly: true, transcript: '   ', turnId: 22 }, { transcript: '', turnId: 22 }]) {
      expect(escribeFilaDeUsuario(payload, { hayTexto: hayTexto(payload), hablable: false })).toBe(false)
    }
    expect(userRows()).toHaveLength(0)
  })
})
