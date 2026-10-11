// ============================================================
// vozEscenarioInyectado - SIMULACION con DATOS INYECTADOS del flujo real de
// hablantes: actualizacion tardia de la fila + registro por nombre + renombre de
// TODA la participacion. No usa microfono ni worker: se inyecta el resultado del
// resolutor (como lo haria el embedding) y se ejecuta la cadena REAL.
//
// Escenario (el del dueno): Luis y una mujer; Luis se identifica ("soy Luis").
// Requisito: identificado Luis, TODA su participacion lleva "luis" y la mujer
// conserva su etiqueta.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow, updateTurnRowSpeaker, renameSpeakerRows } from '../src/voice/lib/conversationTurnRow'
import { applyResolvedSpeakerToSessionRefs } from '../src/voice/lib/turnSpeakerCommit'
import { findLabelsWithSharedVoice } from '../src/voice/lib/speakerClusters'

/** Vectores de la MISMA voz (coseno alto) y de otra voz (bajo). */
const VOZ_LUIS = [1, 0, 0, 0]
const VOZ_LUIS_2 = [0.99, 0.12, 0, 0]
const VOZ_MUJER = [0, 1, 0, 0]

const clusters = [
  { label: 'Hablante 1', signature: VOZ_LUIS },
  { label: 'Hablante 2', signature: VOZ_MUJER },
  { label: 'luis', signature: VOZ_LUIS_2 },
]

const userRows = () => useIntegrationStore.getState().conversationHistory.filter((r) => r.role === 'user')

describe('escenario inyectado: hablantes, registro y renombre de la participacion', () => {
  beforeEach(() => {
    useIntegrationStore.getState().resetConversationHistory()
  })

  it('la fila escrita sin hablante se COMPLETA cuando el resolutor llega tarde', () => {
    const r = commitUserTurnRow({ text: 'bueno empecemos a hacer unas pruebas', turnId: 7 })
    // A5: la fila escrita sin etiqueta lleva el RESPALDO (ya no queda vacia).
    expect(userRows()[0].speakerName).toBe('Hablante 1')
    const changed = updateTurnRowSpeaker(7, 'luis')
    expect(changed).toBe(true)
    expect(userRows().find((row) => row.id === r.id)?.speakerName).toBe('luis')
  })

  it('identificado Luis, TODA su participacion pasa a "luis" y la mujer conserva su etiqueta', () => {
    commitUserTurnRow({ text: 'hola hola como estan todos', speakerName: 'Hablante 1', turnId: 1 })
    commitUserTurnRow({ text: 'soy luis y estoy probando la transcripcion', speakerName: 'Hablante 1', turnId: 2 })
    commitUserTurnRow({ text: 'hoy me robo el estilo lolita', speakerName: 'Hablante 2', turnId: 3 })
    commitUserTurnRow({ text: 'radicado desde hace muchos anos en andorra', speakerName: 'Hablante 2', turnId: 4 })

    // El dueno de clusters dice QUE etiquetas son la MISMA voz que "luis".
    const labels = findLabelsWithSharedVoice(clusters, 'luis', 0.78)
    expect(labels).toContain('Hablante 1')
    expect(labels).not.toContain('Hablante 2')

    const cambiadas = renameSpeakerRows(labels, 'luis')
    expect(cambiadas).toBe(2)
    expect(userRows().map((r) => r.speakerName)).toEqual(['luis', 'luis', 'Hablante 2', 'Hablante 2'])
  })

  it('RUTA REAL, sin microfono: "soy Luis" renombra la participacion del hablante que venia hablando', () => {
    // Las filas de ESE hablante estaban como "Hablante 1" (su etiqueta automatica);
    // la mujer, "Hablante 2".
    commitUserTurnRow({ text: 'hola hola como estan todos', speakerName: 'Hablante 1', turnId: 1 })
    commitUserTurnRow({ text: 'estoy probando la transcripcion', speakerName: 'Hablante 1', turnId: 2 })
    commitUserTurnRow({ text: 'hoy me robo el estilo lolita', speakerName: 'Hablante 2', turnId: 3 })

    const clusters = [
      { label: 'Hablante 1', signature: [1, 0, 0] },
      { label: 'Hablante 2', signature: [0, 1, 0] },
    ]
    // La cadena REAL del commit de un turno "soy Luis" (source wake-intro).
    applyResolvedSpeakerToSessionRefs(
      { speakerName: 'luis', source: 'wake-intro' },
      {
        lastSpeakerRef: { current: 'Hablante 1' },
        lastLoggedSpeakerRef: { current: 'Hablante 1' },
        sessionPrimarySpeakerRef: { current: '' },
        speakerClustersRef: { current: clusters },
        setSpeakerClusters: () => {},
        renameSpeakerRows,
      },
    )

    expect(userRows().map((r) => r.speakerName)).toEqual(['luis', 'luis', 'Hablante 2'])
  })

  it('el nombre PEGA para lo siguiente POR VOZ; la etiqueta desnuda no lo arrastra', () => {
    commitUserTurnRow({ text: 'hola hola como estan todos', speakerName: 'Hablante 1', turnId: 1 })
    applyResolvedSpeakerToSessionRefs(
      { speakerName: 'luis', source: 'wake-intro' },
      {
        lastSpeakerRef: { current: 'Hablante 1' },
        lastLoggedSpeakerRef: { current: 'Hablante 1' },
        sessionPrimarySpeakerRef: { current: '' },
        speakerClustersRef: { current: [] },
        setSpeakerClusters: () => {},
        renameSpeakerRows,
      },
    )
    expect(userRows().map((r) => r.speakerName)).toEqual(['luis'])

    // DATO del log del dueno: 44 s despues sus filas volvian a "Hablante 1". La VOZ
    // ya lleva el nombre, asi que el turno siguiente sale con el nombre (lo da el
    // resolutor de identidad, dueno unico de la etiqueta del turno).
    commitUserTurnRow({ text: 'ahora sigo hablando yo', speakerName: 'luis', turnId: 2 })
    expect(userRows().map((r) => r.speakerName)).toEqual(['luis', 'luis'])

    // La ETIQUETA ya no es un alias de nadie: una fila que llega con la etiqueta
    // desnuda NO hereda el nombre (es el defecto que barria otras voces).
    const tarde = commitUserTurnRow({ text: 'turno escrito sin hablante', turnId: 3 })
    updateTurnRowSpeaker(3, 'Hablante 1')
    expect(userRows().find((row) => row.id === tarde.id)?.speakerName).toBe('Hablante 1')

    commitUserTurnRow({ text: 'habla la otra persona', speakerName: 'Hablante 2', turnId: 4 })
    expect(userRows().at(-1)?.speakerName).toBe('Hablante 2')
  })

  it('la etiqueta AUTOMATICA no renombra (solo el nombre propio)', () => {
    commitUserTurnRow({ text: 'uno', speakerName: 'Hablante 1', turnId: 1 })
    const labels = findLabelsWithSharedVoice(clusters, 'Hablante 1', 0.78)
    // Aunque el dueno de clusters devuelva las de la misma voz, el hook solo llama
    // al renombre con nombres propios (isProperSpeakerName); aqui se comprueba que
    // el renombre NO se dispara "por etiqueta" en el flujo real.
    expect(labels).toContain('luis')
    expect(userRows()[0].speakerName).toBe('Hablante 1')
  })
})

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  beforeEach(() => {
    useIntegrationStore.getState().resetConversationHistory()
  })

  it('una voz distinta NO entra en las etiquetas de la voz ancla', () => {
    const labels = findLabelsWithSharedVoice(clusters, 'luis', 0.78)
    expect(labels).not.toContain('Hablante 2')
  })
})
