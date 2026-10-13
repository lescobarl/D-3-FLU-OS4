// ============================================================
// duenoVozPuntos - Barrera RED de los PUNTOS DEL DUENO (voz).
// ------------------------------------------------------------
// Nace ROJA: fija el comportamiento QUE EL DUENO EXIGE, no el que hay hoy.
// Cada caso cita el punto. Goose pone verde cambiando el CODIGO, no el test.
//   1) La conversacion SOLO se inserta al cerrar la ultima frase (no se reescribe).
//   5) Registrado el nombre, TODOS los turnos de esa voz lo llevan.
//   6bis) El registro NUNCA emite el literal "{name}" (y tiene UN solo emisor).
// P2 (participantes en su seccion), P3/P6 (diarizacion al 100%) y P4 (congelamiento)
// NO son unitarios: van en la barrera de integracion/log (pendientes, verledger).
// ============================================================
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow } from '../src/voice/lib/conversationTurnRow'
import { registerSpeakerIdentity } from '../src/voice/lib/speakerIdentityRegister.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import { getCommandSpeech } from '../src/voice/lib/voiceCommands.js'

const filas = () => useIntegrationStore.getState().conversationHistory.filter((e) => e.role === 'user')

beforeEach(() => {
    useIntegrationStore.setState({ conversationHistory: [] })
})

describe('P1 - la conversacion solo se INSERTA (no se reescribe)', () => {
    it('una fila ya escrita NO se muta cuando la locucion crece', () => {
        commitUserTurnRow({ text: 'soy luis', speakerName: 'Hablante 1', turnId: 1 } as never)
        const id1 = filas()[0]?.id
        commitUserTurnRow({ text: 'soy luis okay flu', speakerName: 'Luis', turnId: 1, replaceLast: true } as never)
        const fila = useIntegrationStore.getState().conversationHistory.find((e) => e.id === id1)
        expect(fila?.text, 'la fila insertada NO se reescribe (append-only)').toBe('soy luis')
    })
})

describe('P5 - el nombre registrado alcanza TODOS los turnos de esa voz', () => {
    it('un turno NUEVO de la misma voz (sin medida) sigue llevando el nombre', () => {
        commitUserTurnRow({ text: 'uno', speakerName: 'Hablante 1', turnId: 1 } as never)
        commitUserTurnRow({ text: 'dos', speakerName: 'Hablante 1', turnId: 2 } as never)
        registerSpeakerIdentity({ name: 'Luis', previousLabel: 'Hablante 1', clusters: [], refs: {} as never })
        commitUserTurnRow({ text: 'tres', speakerName: 'Hablante 1', turnId: 3, evidenciaAcustica: false } as never)
        expect(filas().map((e) => e.speakerName), 'solo hablo una voz: todas "Luis"').toEqual([
            'Luis',
            'Luis',
            'Luis',
        ])
    })
})

describe('P6bis - el registro de nombre emite UNA vez y sin el literal {name}', () => {
    it('getCommandSpeech no devuelve "{name}" cuando no hay nombre', () => {
        const sin = getCommandSpeech('REGISTRAR_PARTICIPANTE', 'es', FLU_CONFIG, { name: '' })
        const con = getCommandSpeech('REGISTRAR_PARTICIPANTE', 'es', FLU_CONFIG, { name: 'Luis' })
        expect(con).toBe('Registrado Luis.')
        expect(sin, 'nunca el literal que el dueno vio en pantalla').not.toContain('{name}')
    })

    it('HAY UN solo emisor de la respuesta de registro en el hook', () => {
        const hook = readFileSync('src/voice/hooks/useFluVoiceAssistant.js', 'utf8')
        const emisores = hook.match(/getCommandSpeech\([^\n]*REGISTRAR|getCommandSpeech\(command,|getCommandSpeech\(directCommand,/g) || []
        expect(emisores.length, 'una sola ruta que HABLA "Registrado <nombre>."').toBeLessThanOrEqual(1)
    })
})
