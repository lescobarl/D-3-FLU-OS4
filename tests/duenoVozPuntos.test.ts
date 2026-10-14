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
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow, escribeFilaDeUsuario, updateTurnRowSpeaker } from '../src/voice/lib/conversationTurnRow'
import { registerSpeakerIdentity } from '../src/voice/lib/speakerIdentityRegister.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import { getCommandSpeech } from '../src/voice/lib/voiceCommands.js'
import { resolveTurnSpeakerAtCommit } from '../src/voice/lib/turnSpeakerCommit'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow'
import { resetVoiceDirectory, registerVoiceName, resolveVoiceName, resolveVoiceIdentity } from '../src/voice/lib/speakerDirectory.js'
import { resolveVoiceParticipants } from '../src/voice/lib/voiceParticipantsSource'
import { isNavSettlePending, setNavSettlePending } from '../src/voice/lib/navSettleFlag.js'

const filas = () => useIntegrationStore.getState().conversationHistory.filter((e) => e.role === 'user')

beforeEach(() => {
    useIntegrationStore.setState({ conversationHistory: [] })
    // El DIRECTORIO (nombre por VOZ) es estado de SESION.
    resetVoiceDirectory()
})

describe('P1 - la conversacion solo se INSERTA (no se reescribe)', () => {
    it('una fila ya escrita NO se muta cuando la locucion crece', () => {
        commitUserTurnRow({ text: 'soy luis', speakerName: 'Hablante 1', turnId: 1 } as never)
        const id1 = filas()[0]?.id
        commitUserTurnRow({ text: 'soy luis okay flu', speakerName: 'Luis', turnId: 1, replaceLast: true } as never)
        const fila = useIntegrationStore.getState().conversationHistory.find((e) => e.id === id1)
        expect(fila?.text, 'la fila insertada NO se reescribe (append-only)').toBe('soy luis')
    })

    // Punto 1 del dueno: "la conversacion solo lleva datos consolidados una vez que termina
    // la ultima frase". El COMMIT TEMPRANO (visibilidad inmediata) NO escribe la conversacion:
    // mientras se habla, el texto vive en ULTIMA FRASE; la fila entra al cerrar.
    it('el commit TEMPRANO no escribe la conversacion (solo el cierre)', () => {
        expect(
            escribeFilaDeUsuario({ userCommitOnly: true }, { hayTexto: true, hablable: true }),
            'el commit temprano NO inserta fila',
        ).toBe(false)
        expect(
            escribeFilaDeUsuario({ rawOnly: true }, { hayTexto: true, hablable: true }),
            'el cierre SI inserta la fila consolidada',
        ).toBe(true)
    })
})

describe('P5 - el nombre registrado alcanza TODOS los turnos de esa voz', () => {
    it('un turno NUEVO de la misma voz (sin medida) sigue llevando el nombre', () => {
        commitUserTurnRow({ text: 'uno', speakerName: 'Hablante 1', turnId: 1 } as never)
        commitUserTurnRow({ text: 'dos', speakerName: 'Hablante 1', turnId: 2 } as never)
        registerSpeakerIdentity({ name: 'Luis', previousLabel: 'Hablante 1', clusters: [], refs: {} as never })
        commitUserTurnRow({ text: 'tres', speakerName: 'Hablante 1', turnId: 3, evidenciaAcustica: false } as never)
        expect(filas().map((e) => resolveRowSpeakerLabel(e)), 'solo hablo una voz: todas "Luis"').toEqual([
            'Luis',
            'Luis',
            'Luis',
        ])
    })

    // Punto 5 del dueno: "le dije ok flu soy luis y no actualizo todos los Hablante 1 que en
    // todos era yo". Sus filas viejas se escribieron con la etiqueta provisional; el nombre
    // tiene que alcanzarlas TAMBIEN (no solo los turnos siguientes).
    it('el nombre alcanza las filas escritas con la etiqueta PROVISIONAL anterior', () => {
        commitUserTurnRow({ text: 'uno', speakerName: 'Hablante 1', turnId: 1 } as never)
        commitUserTurnRow({ text: 'dos', speakerName: 'Hablante 1', turnId: 2 } as never)
        commitUserTurnRow({ text: 'tres', speakerName: 'Hablante 1', turnId: 3 } as never)
        // La identidad llega por AUDIO en un turno: queda registrada la etiqueta de esa voz.
        updateTurnRowSpeaker(3, 'Luis', { evidenciaAcustica: true })
        // El dueno DICE su nombre con la wake: el registro renombra TODA su participacion.
        registerSpeakerIdentity({ name: 'Luis', previousLabel: 'Luis', clusters: [], refs: {} as never })
        expect(filas().map((e) => resolveRowSpeakerLabel(e)), 'todas las filas de esa voz').toEqual([
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

// ------------------------------------------------------------
// PRUEBA DE DETECTOR: la marca discrimina. Se alimenta una entrada INFRACTORA
// sintetica y se comprueba que el detector la marca; y una entrada sana, que no.
// Sin esto, un detector sordo pasaria el mismo test que un codigo limpio.
// ------------------------------------------------------------
describe('PRUEBA DE DETECTOR (el detector no es decorativo: la marca discrimina)', () => {
    const emisoresDeRegistro = (src: string) =>
        src.match(/getCommandSpeech\([^\n]*REGISTRAR|getCommandSpeech\(command,|getCommandSpeech\(directCommand,/g) || []

    it('mutacion: DOS emisores se marcan; UNO (o un solo constructor) no', () => {
        expect(emisoresDeRegistro('getCommandSpeech(command, L)\ngetCommandSpeech(directCommand, L)').length).toBe(2)
        expect(emisoresDeRegistro('buildCommandSpeech(command, L)').length).toBe(0)
    })

    it('mutacion: el commit temprano marcado como escritor de la conversacion', () => {
        expect(escribeFilaDeUsuario({ userCommitOnly: true }, { hayTexto: true })).toBe(false)
        expect(escribeFilaDeUsuario({ rawOnly: true }, { hayTexto: true, hablable: true })).toBe(true)
    })
})

// ------------------------------------------------------------
// P3 - UNA SOLA VOZ ⇒ UNA SOLA ETIQUETA. El dictado que MENCIONA el cue de cambio de
// hablante no abre un hablante nuevo (defecto medido: `explicit-next` a mitad del dictado).
// ------------------------------------------------------------
describe('P3 - una sola voz: el dictado no inventa hablante', () => {
    it('mencionar el cambio de hablante NO cambia la etiqueta del turno', () => {
        const r = resolveTurnSpeakerAtCommit({
            phrase: 'en la ultima frase no hay ni cambio de hablante ni ni silencio para que lo escriba',
            knownSpeakerLabels: ['Hablante 1'],
            stickyFallback: 'Hablante 1',
            lastLogged: 'Hablante 1',
        } as never)
        expect(r.source, 'no es una orden').not.toBe('explicit-next')
        expect(r.speakerName, 'la voz sigue siendo la misma').toBe('Hablante 1')
    })
})

// ------------------------------------------------------------
// P2 - LA BASE DE PARTICIPANTES SE MUESTRA en la seccion de participantes.
// ------------------------------------------------------------
describe('P2 - la base de participantes se ve en el panel', () => {
    it('el panel lista SOLO a quien participo en la SESION (la base no se vuelca)', () => {
        // Definicion del dueno (2026-10-13): el panel muestra los participantes de ESTA
        // sesion; la base de participantes se consulta aparte. Quien hablo aparece porque
        // SUS filas llevan su etiqueta/nombre.
        const sinHablar = resolveVoiceParticipants({
            history: [],
            profiles: [],
            base: [{ name: 'Luis', speakerLabel: 'Luis' }],
        })
        expect(sinHablar.map((r) => r.label), 'la base entera NO se lista').toEqual([])
        const hablo = resolveVoiceParticipants({ history: [{ speakerName: 'luis' }] })
        expect(hablo.map((r) => r.label), 'el que participo SI').toEqual(['luis'])
    })

    it('historial y perfiles siguen apareciendo (no se pierde nada)', () => {
        const lista = resolveVoiceParticipants({
            history: [{ speakerName: 'Hablante 1' }],
            profiles: [{ label: 'voz A', id: 'p1' }],
            base: [{ name: 'Luis' }],
        })
        expect(lista.map((r) => r.label).sort()).toEqual(['Hablante 1', 'voz A'])
        expect(lista.find((r) => r.label === 'voz A')?.profileId).toBe('p1')
    })

    it('el registro por VOZ entra en la base por el puente de la sesion', () => {
        const altas: string[] = []
        registerSpeakerIdentity({
            name: 'Luis',
            previousLabel: 'Hablante 1',
            clusters: [],
            refs: {
                registerParticipant: (name: string) => {
                    altas.push(name)
                },
            } as never,
        })
        expect(altas, 'el nombre dicho por voz entra en la base').toEqual(['Luis'])
    })
})

// ------------------------------------------------------------
// P4 - NO CONGELAMIENTO. Una bandera de bloqueo del pipeline NO puede sobrevivir a su
// plazo: si su temporizador se retrasa (pestaña en segundo plano), el pipeline se queda
// mudo y luego "pone todo de un solo golpe" (medido por el dueno 2026-10-12 21:16).
// ------------------------------------------------------------
describe('P4 - la bandera de bloqueo vence sola (no congela)', () => {
    it('el asentamiento deja de bloquear aunque su temporizador nunca llegue', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-10-12T21:16:00Z'))
        setNavSettlePending(true, 2800)
        expect(isNavSettlePending(), 'armado').toBe(true)
        vi.setSystemTime(new Date('2026-10-12T21:16:02Z'))
        expect(isNavSettlePending(), 'dentro de su plazo').toBe(true)
        vi.setSystemTime(new Date('2026-10-12T21:17:00Z'))
        expect(isNavSettlePending(), 'VENCIDO: no bloquea mas capturas').toBe(false)
        setNavSettlePending(false)
        vi.useRealTimers()
    })
})

// ------------------------------------------------------------
// P5b - UNA ETIQUETA AUTOMATICA NO ES UN NOMBRE (medido en su log 2026-10-14 16:34-16:38):
// row-update voz=speaker_1 "Luis" -> "Hablante 1" -> "Hablante 3" y sus filas (ya con su
// nombre) acabaron mostrando "Hablante 3". El dueno: "no esta alineado a ninguna definicion
// del hablante", "esta renombrando todos los hablantes y eso provoca problemas de performance".
// Regla: "Hablante N" es la AUSENCIA de nombre; el dueno unico del nombre (speakerDirectory)
// no la registra y no pisa un nombre ya afirmado. El TIMBRE de la voz SI se registra (liga
// sus turnos aunque todavia no sea nadie).
// ------------------------------------------------------------
describe('P5b - la etiqueta automatica no degrada el nombre de la VOZ', () => {
    beforeEach(() => {
        resetVoiceDirectory()
        useIntegrationStore.setState({ conversationHistory: [] })
    })

    it('registrar "Hablante N" NO cambia el nombre ya afirmado de esa VOZ', () => {
        registerVoiceName('speaker_1', 'Luis')
        registerVoiceName('speaker_1', 'Hablante 1')
        registerVoiceName('speaker_1', 'Hablante 3')
        expect(resolveVoiceName('speaker_1'), 'la voz conserva su nombre').toBe('Luis')
    })

    it('el camino REAL (medida tardia de un turno) tampoco degrada el nombre', () => {
        commitUserTurnRow({ text: 'uno', speakerName: 'Hablante 1', turnId: 21 } as never)
        updateTurnRowSpeaker(21, 'Luis', { evidenciaAcustica: true })
        expect(resolveVoiceName('speaker_1')).toBe('Luis')
        commitUserTurnRow({ text: 'dos', speakerName: 'Hablante 1', turnId: 22 } as never)
        updateTurnRowSpeaker(22, 'Hablante 1', { evidenciaAcustica: true })
        commitUserTurnRow({ text: 'tres', speakerName: 'Hablante 1', turnId: 23 } as never)
        updateTurnRowSpeaker(23, 'Hablante 3', { evidenciaAcustica: true })
        expect(resolveVoiceName('speaker_1'), 'el nombre no se degrada a etiqueta').toBe('Luis')
    })

    it('sin nombre pero CON timbre, la VOZ queda registrada (liga sus turnos)', () => {
        registerVoiceName('speaker_9', '', { vector: [1, 0, 0] })
        expect(resolveVoiceName('speaker_9')).toBe('')
        expect(resolveVoiceIdentity([1, 0, 0])?.voiceId).toBe('speaker_9')
    })
})

// PRUEBA DE DETECTOR (el detector no es decorativo): un NOMBRE PROPIO si se registra.
describe('P5b - el detector no es decorativo: el nombre propio manda', () => {
    it('un nombre propio SI se registra; el vacio no inventa nada', () => {
        resetVoiceDirectory()
        registerVoiceName('speaker_1', 'Jorge')
        expect(resolveVoiceName('speaker_1')).toBe('Jorge')
        registerVoiceName('speaker_2', '   ')
        expect(resolveVoiceName('speaker_2')).toBe('')
    })
})
