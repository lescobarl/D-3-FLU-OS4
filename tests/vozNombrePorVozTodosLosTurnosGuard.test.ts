// ============================================================
// vozNombrePorVozTodosLosTurnosGuard - EL NOMBRE SE LIGA A LA VOZ (firma), NO A LA ETIQUETA.
// ------------------------------------------------------------
// Spec del dueno (2026-10-11): "Ligar el nombre por VOZ (firma del hablante), NO por etiqueta.
// Aplicarlo en TODOS los turnos de esa voz (no solo el primero). Puede salir de la base y
// actualizarse cuando cambies el nombre en participantes."
//
// INVARIANTE (P9.81 + spec del dueno 2026-10-12: "si al CLUSTER, NO al nombre sin evidencia"):
// N turnos CON evidencia de esa firma => N filas con el NOMBRE; un turno SIN evidencia =>
// etiqueta GENERICA. NUNCA el nombre del hablante anterior por el solo hecho de estar ligado.
//
// PRUEBA DE DETECTOR (mutacion): si el nombre vuelve a depender de la ETIQUETA (o solo del primer
// turno), el caso de la voz con DOS etiquetas historicas deja filas genericas y cae.
// ============================================================
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow } from '../src/voice/conversation'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow'
import { resetVoiceDirectory, voiceVectorModel } from '../src/voice/lib/speakerDirectory.js'
import { setParticipantAnchorsProvider } from '../src/voice/lib/participantVoiceAnchors'
import { isNameBoundToVoice, findLabelsWithSharedVoice } from '../src/voice/lib/speakerClusters.js'
import { isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'
import { registerSpeakerIdentity } from '../src/voice/lib/speakerIdentityRegister.js'
import { resolverEtiqueta } from '../src/voice/conversation/fila'

// El despacho REAL vive ahora en el hook (el compose delega en el modulo nuevo): el
// dato del mandato ("soy X") y la prohibicion del atajo de nombre sin evidencia se
// miden sobre el archivo vivo, no sobre el compose que ya no los nombra.
const HOOK = readFileSync('src/voice/hooks/useFluVoiceAssistant.js', 'utf8')

const VOZ_A = [1, 0, 0, 0]
const VOZ_B = [0, 1, 0, 0]
const MISMA_VOZ = [1, 0.01, 0, 0]

/** 'Hablante 1' y 'Hablante 2' son la MISMA voz (A); 'Hablante 3' es otra voz. */
const clusters = [
    { label: 'Hablante 1', signature: VOZ_A, count: 3 },
    { label: 'Hablante 2', signature: MISMA_VOZ, count: 2 },
    { label: 'Hablante 3', signature: VOZ_B, count: 2 },
]

const filas = () =>
    useIntegrationStore
        .getState()
        .conversationHistory.filter((e) => e.role === 'user')
        .map((e) => resolveRowSpeakerLabel(e))

beforeEach(() => {
    useIntegrationStore.setState({ conversationHistory: [] })
    // El DIRECTORIO de nombres por VOZ es estado de sesion: se vacia por caso (mandato
    // 2026-10-13: el nombre vive en la VOZ, no en la fila).
    resetVoiceDirectory()
    // La BASE de anclas se inyecta por su dueno (useParticipants); sin inyeccion la
    // lectura es vacia (el provider por defecto devuelve []).
    setParticipantAnchorsProvider(null)
})

describe('el nombre se liga a la VOZ y vale en TODOS sus turnos', () => {
    it('la VOZ agrupa sus DOS etiquetas por FIRMA (no por etiqueta)', () => {
        const grupo = findLabelsWithSharedVoice(clusters, 'Hablante 1', 0.6)
        expect(grupo).toContain('Hablante 1')
        expect(grupo).toContain('Hablante 2')
        expect(grupo).not.toContain('Hablante 3')
        // El nombre LIGADO vive en el cluster con firma de esa voz.
        expect(isNameBoundToVoice(clusters, 'Hablante 1')).toBe(true)
        expect(isNameBoundToVoice(clusters, 'Luis')).toBe(false)
        const ligados = clusters.map((c) => (c.label === 'Hablante 1' || c.label === 'Hablante 2' ? { ...c, label: 'Luis' } : c))
        expect(isNameBoundToVoice(ligados, 'Luis')).toBe(true)
    })

    it('N turnos de la MISMA voz => N filas conservan su etiqueta (el modulo la decide al cerrar)', () => {
        // La VOZ es la CLAVE de la fila (mandato 2026-10-13): se mide por FIRMA, asi que las
        // DOS etiquetas historicas de la misma voz caen en la MISMA clave de fila. La
        // etiqueta VISIBLE la escribe el modulo con la que aporta el cierre (sin coser
        // clusters: la diarizacion se retiro); el nombre llega al registrar la voz.
    commitUserTurnRow({ text: 'turno uno', speakerName: 'Hablante 1', evidenciaAcustica: true, signature: VOZ_A, turnId: 1 })
    commitUserTurnRow({ text: 'turno dos', speakerName: 'Hablante 2', evidenciaAcustica: true, signature: MISMA_VOZ, turnId: 2 })
    commitUserTurnRow({ text: 'turno tres', speakerName: 'Hablante 1', evidenciaAcustica: true, signature: VOZ_A, turnId: 3 })
    commitUserTurnRow({ text: 'otra voz', speakerName: 'Hablante 3', evidenciaAcustica: true, signature: VOZ_B, turnId: 4 })
        expect(filas()).toEqual(['Hablante 1', 'Hablante 2', 'Hablante 1', 'Hablante 3'])

        // Registro del comando: liga el nombre a la VOZ (dueno unico). NO reescribe filas.
        const result = registerSpeakerIdentity({ name: 'Luis', previousLabel: 'Hablante 1', clusters, refs: {} as never })

        expect(filas(), 'ninguna fila ya escrita se reescribe').toEqual(['Hablante 1', 'Hablante 2', 'Hablante 1', 'Hablante 3'])
        expect(result.rowsChanged, 'el registro liga el nombre a la VOZ, no a las filas').toBe(0)
    })

    it('el NOMBRE solo se estampa con EVIDENCIA; sin medida la fila cae a generica (P9.81)', () => {
        // Spec del dueno (2026-10-12): reuso del CLUSTER si; herencia del NOMBRE sin evidencia NO.
        // El dato del mandato ("soy X") se resuelve en el DESPACHO del hook (el compose ya solo
        // delega en el modulo nuevo); la etiqueta del modulo usa el nombre SOLO si viene
        // CONFIRMADO. Sin ninguna de las dos, cae a continuidad o semilla: nunca al nombre ligado.
        expect(HOOK.includes('resolveSpeakerNameFromUtterance('), 'el dato del mandato vive en el despacho').toBe(true)
        expect(
            resolverEtiqueta({
                voz: { nombre: 'Luis', nombreConfirmado: false, hablante: '', continuidad: false },
                anterior: 'Luis',
                semilla: 'Hablante 1',
                esEtiquetaAnonima: isAutoSpeakerLabel,
            }),
            'sin medida ni mandato, el nombre ligado NO se estampa',
        ).toEqual({ etiqueta: 'Hablante 1', evidencia: 'semilla' })
        // Y NO queda el atajo que estampaba el nombre LIGADO sin evidencia del turno (P9.81).
        expect(HOOK.includes('nombreLigado'), 'sin atajo de nombre sin evidencia').toBe(false)
    })
})

describe('el NOMBRE no reescribe filas ya escritas (un solo dueno de la fila)', () => {
  it('las filas del PARTICIPANTE/primario conservan la etiqueta que escribio el modulo', () => {
    useIntegrationStore.setState({ conversationHistory: [] })
    // Mandato del dueño 2026-10-13: la MISMA voz (misma FIRMA) del participante liga sus
    // dos filas a la misma clave; el nombre se registra por VOZ y NINGUNA fila se reescribe.
    commitUserTurnRow({ text: 'antes', speakerName: 'Hablante 1', evidenciaAcustica: false, signature: [1, 0, 0], turnId: 1 })
    commitUserTurnRow({ text: 'participante', speakerName: 'luis', evidenciaAcustica: false, signature: [1, 0, 0], turnId: 2 })
    const refs = { sessionPrimarySpeakerRef: { current: 'luis' } }
    registerSpeakerIdentity({
      name: 'Juan',
      previousLabel: 'Hablante 1',
      clusters: [{ label: 'Hablante 1', signature: [1, 0, 0] }],
      refs,
    })
    expect(
      useIntegrationStore.getState().conversationHistory.filter((e) => e.role === 'user').map((e) => resolveRowSpeakerLabel(e)).sort(),
      'ninguna fila ya escrita se reescribe con el nombre',
    ).toEqual(['Hablante 1', 'Luis'])
  })
})

describe('sustitucion por la VOZ: las etiquetas ya EXTINTAS se VEN con el nombre', () => {
  it('N filas de la misma voz (etiquetas que ya no estan en los clusters) => N con el nombre', () => {
    useIntegrationStore.setState({ conversationHistory: [] })
    const VOZ = [1, 0, 0]
    commitUserTurnRow({ text: 'uno', speakerName: 'Hablante 1', evidenciaAcustica: true, turnId: 1, signature: VOZ })
    commitUserTurnRow({ text: 'dos', speakerName: 'Hablante 4', evidenciaAcustica: true, turnId: 2, signature: [0.99, Math.sqrt(1 - 0.99 * 0.99), 0] })
    // La tercera es OTRA voz MEDIDA: sin medida (evidenciaAcustica false) el modulo
    // aplicaria la CONTINUIDAD (heredaria la etiqueta del anterior); medida, conserva
    // SU etiqueta y el display la resuelve por timbre.
    commitUserTurnRow({ text: 'otra voz', speakerName: 'Hablante 7', evidenciaAcustica: true, turnId: 3, signature: [0, 0, 1] })
    // El nombre queda en la BASE por VOZ (dueno unico: participantVoiceAnchors, inyectado
    // por useParticipants). El display lo resuelve al MOSTRAR por el TIMBRE de la fila y NO
    // se toca ninguna fila (mandato 2026-10-13; `renameSpeakerRows` era la ruta retirada).
    setParticipantAnchorsProvider(() => [{ name: 'Luis', vector: VOZ, model: voiceVectorModel(), verified: true }])
    expect(
      useIntegrationStore.getState().conversationHistory.filter((e) => e.role === 'user').map((e) => resolveRowSpeakerLabel(e)),
      'las DOS filas de esa voz (una por etiqueta, otra solo por firma) se VEN con el nombre; la voz distinta NO',
    ).toEqual(['Luis', 'Luis', 'Hablante 7'])
  })
})
