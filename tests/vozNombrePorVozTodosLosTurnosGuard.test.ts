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
import { commitUserTurnRow, renameSpeakerRows } from '../src/voice/lib/conversationTurnRow'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow'
import { resetVoiceDirectory } from '../src/voice/lib/speakerDirectory.js'
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
        .map((e) => resolveRowSpeakerLabel(e))

beforeEach(() => {
    useIntegrationStore.setState({ conversationHistory: [] })
    // El DIRECTORIO de nombres por VOZ es estado de sesion: se vacia por caso (mandato
    // 2026-10-13: el nombre vive en la VOZ, no en la fila).
    resetVoiceDirectory()
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
        // La VOZ es la CLAVE de la fila (mandato 2026-10-13): se mide por FIRMA, asi que las
        // DOS etiquetas historicas de la misma voz caen en la MISMA clave de fila.
        commitUserTurnRow({ text: 'turno uno', speakerName: 'Hablante 1', signature: VOZ_A, turnId: 1 } as never)
        commitUserTurnRow({ text: 'turno dos', speakerName: 'Hablante 2', signature: MISMA_VOZ, turnId: 2 } as never)
        commitUserTurnRow({ text: 'turno tres', speakerName: 'Hablante 1', signature: VOZ_A, turnId: 3 } as never)
        commitUserTurnRow({ text: 'otra voz', speakerName: 'Hablante 3', signature: VOZ_B, turnId: 4 } as never)
        expect(filas()).toEqual(['Hablante 1', 'Hablante 1', 'Hablante 1', 'Hablante 3'])

        // Registro del comando: liga el nombre a la VOZ (dueno unico). NO reescribe filas.
        const result = registerSpeakerIdentity({ name: 'Luis', previousLabel: 'Hablante 1', clusters, refs: {} as never })

        expect(filas(), 'todos los turnos de esa voz').toEqual(['Luis', 'Luis', 'Luis', 'Hablante 3'])
        expect(result.rowsChanged, 'el registro CONGELA filas ya mostradas de esa voz (freeze 2026-10-17)').toBeGreaterThanOrEqual(2)
    })

    it('el NOMBRE solo se estampa con EVIDENCIA; sin medida la fila cae a generica (P9.81)', () => {
        // Spec del dueno (2026-10-12): reuso del CLUSTER si; herencia del NOMBRE sin evidencia NO.
        // El commit levanta el nombre con la MEDIDA (preflight) o con el DATO del mandato ("soy X");
        // sin ninguna de las dos, el duenio de la regla (`blindSpeakerFallback`, speakerPolicy)
        // degrada un nombre propio a etiqueta generica (evita "Luis pegado a una voz distinta").
        expect(STREAM.includes('preflightEvidenceMeasured(preflight)'), 'la evidencia es la MEDIDA').toBe(true)
        expect(STREAM.includes('FUENTES_CON_IDENTIDAD'), 'y el dato del mandato').toBe(true)
        expect(STREAM.includes('blindSpeakerFallback(crudo)'), 'el nombre sin evidencia degrada').toBe(true)
        // Y NO queda el atajo que estampaba el nombre LIGADO sin evidencia del turno (P9.81).
        expect(STREAM.includes('nombreLigado'), 'sin atajo de nombre sin evidencia').toBe(false)
    })
})

describe('el NOMBRE sustituye a la PERSONA (no da de alta una identidad nueva)', () => {
  it('las filas del PARTICIPANTE/primerio se VEN con el nombre nuevo', () => {
    useIntegrationStore.setState({ conversationHistory: [] })
    // Mandato del dueño 2026-10-13: la MISMA voz (misma FIRMA) del participante liga sus
    // dos filas a la misma clave; el nombre se registra por VOZ y NINGUNA fila se reescribe.
    commitUserTurnRow({ text: 'antes', speakerName: 'Hablante 1', evidenciaAcustica: false, signature: [1, 0, 0], turnId: 1 } as never)
    commitUserTurnRow({ text: 'participante', speakerName: 'luis', evidenciaAcustica: false, signature: [1, 0, 0], turnId: 2 } as never)
    const refs = { sessionPrimarySpeakerRef: { current: 'luis' } }
    registerSpeakerIdentity({
      name: 'Juan',
      previousLabel: 'Hablante 1',
      clusters: [{ label: 'Hablante 1', signature: [1, 0, 0] }],
      refs,
    })
    expect(
      useIntegrationStore.getState().conversationHistory.filter((e) => e.role === 'user').map((e) => resolveRowSpeakerLabel(e)).sort(),
      'la persona entera pasa a su nombre nuevo (sus filas se ven con el nombre)',
    ).toEqual(['Juan', 'Juan'])
  })
})

describe('sustitucion por la VOZ: las etiquetas ya EXTINTAS se VEN con el nombre', () => {
  it('N filas de la misma voz (etiquetas que ya no estan en los clusters) => N con el nombre', () => {
    useIntegrationStore.setState({ conversationHistory: [] })
    const VOZ = [1, 0, 0]
    commitUserTurnRow({ text: 'uno', speakerName: 'Hablante 1', evidenciaAcustica: false, turnId: 1, signature: VOZ } as never)
    commitUserTurnRow({ text: 'dos', speakerName: 'Hablante 4', evidenciaAcustica: false, turnId: 2, signature: [0.99, Math.sqrt(1 - 0.99 * 0.99), 0] } as never)
    commitUserTurnRow({ text: 'otra voz', speakerName: 'Hablante 7', evidenciaAcustica: false, turnId: 3, signature: [0, 0, 1] } as never)
    // `renameSpeakerRows` recibe 2 argumentos (sin `anchorSignature`): registra el nombre
    // en el DIRECTORIO por la VOZ de esa etiqueta y NO toca ninguna fila (mandato 2026-10-13).
    const registradas = renameSpeakerRows(['Hablante 1'], 'Luis')
    expect(registradas, 'una sola VOZ registrada (ya no cuenta "filas cambiadas")').toBe(1)
    expect(
      useIntegrationStore.getState().conversationHistory.filter((e) => e.role === 'user').map((e) => resolveRowSpeakerLabel(e)),
      'las DOS filas de esa voz (una por etiqueta, otra solo por firma) se VEN con el nombre; la voz distinta NO',
    ).toEqual(['Luis', 'Luis', 'Hablante 7'])
  })
})
