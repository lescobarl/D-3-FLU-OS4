// ============================================================
// vozNombrePorVozTodosLosTurnosGuard - EL NOMBRE SE LIGA A LA VOZ (firma), NO A LA ETIQUETA.
// ------------------------------------------------------------
// Spec del dueno (2026-10-11): "Ligar el nombre por VOZ (firma del hablante), NO por etiqueta.
// Aplicarlo en TODOS los turnos de esa voz (no solo el primero). Puede salir de la base y
// actualizarse cuando cambies el nombre en participantes."
//
// INVARIANTE: N turnos de la MISMA voz => N filas con el NOMBRE; 0 genericas (salvo cambio de
// hablante real).
//
// PRUEBA DE DETECTOR (mutacion): si el nombre vuelve a depender de la ETIQUETA (o solo del primer
// turno), el caso de la voz con DOS etiquetas historicas deja filas genericas y cae.
// ============================================================
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow } from '../src/voice/lib/conversationTurnRow'
import { isNameBoundToVoice, findLabelsWithSharedVoice } from '../src/voice/lib/speakerClusters.js'
import { registerSpeakerIdentity } from '../src/voice/lib/speakerIdentityRegister.js'

const STREAM = readFileSync('src/voice/lib/conversationStreamCommit.js', 'utf8')

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
        .map((e) => String(e.speakerName || ''))

beforeEach(() => {
    useIntegrationStore.setState({ conversationHistory: [] })
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

    it('N turnos de la MISMA voz => N filas con el nombre; 0 genericas (y la otra voz intacta)', () => {
        commitUserTurnRow({ text: 'turno uno', speakerName: 'Hablante 1', turnId: 1 } as never)
        commitUserTurnRow({ text: 'turno dos', speakerName: 'Hablante 2', turnId: 2 } as never)
        commitUserTurnRow({ text: 'turno tres', speakerName: 'Hablante 1', turnId: 3 } as never)
        commitUserTurnRow({ text: 'otra voz', speakerName: 'Hablante 3', turnId: 4 } as never)
        expect(filas()).toEqual(['Hablante 1', 'Hablante 2', 'Hablante 1', 'Hablante 3'])

        // Registro del comando: liga el nombre a la VOZ (dueno unico) y reescribe la BASE.
        registerSpeakerIdentity({ name: 'Luis', previousLabel: 'Hablante 1', clusters, refs: {} as never })

        expect(filas(), 'todos los turnos de esa voz').toEqual(['Luis', 'Luis', 'Luis', 'Hablante 3'])
    })

    it('la VOZ ligada mantiene su nombre en los turnos NUEVOS aunque la medida no llegue', () => {
        // El commit decide con el nombre LIGADO a la voz (cluster con firma), no por etiqueta.
        expect(
            STREAM.includes('isNameBoundToVoice(speakerClustersRef.current, crudo)'),
            'el commit consulta el vinculo voz->nombre',
        ).toBe(true)
        expect(STREAM.includes('nombreLigado'), 'y lo usa para no degradar el nombre').toBe(true)
    })
})

describe('el NOMBRE sustituye a la PERSONA (no da de alta una identidad nueva)', () => {
  it('las filas del PARTICIPANTE/primerio pasan al nombre nuevo', () => {
    useIntegrationStore.setState({ conversationHistory: [] })
    commitUserTurnRow({ text: 'antes', speakerName: 'Hablante 1', evidenciaAcustica: false, turnId: 1 } as never)
    commitUserTurnRow({ text: 'participante', speakerName: 'luis', evidenciaAcustica: false, turnId: 2 } as never)
    const refs = { sessionPrimarySpeakerRef: { current: 'luis' } }
    registerSpeakerIdentity({
      name: 'Juan',
      previousLabel: 'Hablante 1',
      clusters: [{ label: 'Hablante 1', signature: [1, 0, 0] }],
      refs,
    })
    expect(
      useIntegrationStore.getState().conversationHistory.filter((e: any) => e.role === 'user').map((e: any) => e.speakerName).sort(),
      'la persona entera pasa a su nombre nuevo (incluida su etiqueta de participante)',
    ).toEqual(['Juan', 'Juan'])
  })
})
