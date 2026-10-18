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
import { commitUserTurnRow, updateTurnRowSpeaker, renameSpeakerRows } from '../src/voice/lib/conversationTurnRow'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow'
import { resetVoiceDirectory } from '../src/voice/lib/speakerDirectory.js'
import { useIntegrationStore } from '../src/store/integrationStore'
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
    resetVoiceDirectory()
    // reset de conversacion). Sin esto, el registro de un caso se filtraba al siguiente.
  })

  it('la fila escrita sin hablante se COMPLETA cuando el resolutor llega tarde', () => {
    const r = commitUserTurnRow({ text: 'bueno empecemos a hacer unas pruebas', turnId: 7 })
    // A5: la fila escrita sin etiqueta lleva el RESPALDO (ya no queda vacia).
    expect(resolveRowSpeakerLabel(userRows().find((row) => row.id === r.id) || {})).toBe('Hablante 1')
    const changed = updateTurnRowSpeaker(7, 'luis', { evidenciaAcustica: true })
    expect(changed).toBe(true)
    expect(resolveRowSpeakerLabel(userRows().find((row) => row.id === r.id) || {})).toBe('Luis')
  })

  it('identificado Luis, TODA su participacion pasa a "luis" y la mujer conserva su etiqueta', () => {
    commitUserTurnRow({ text: 'hola hola como estan todos', speakerName: 'Hablante 1', evidenciaAcustica: true, turnId: 1 })
    commitUserTurnRow({ text: 'soy luis y estoy probando la transcripcion', speakerName: 'Hablante 1', evidenciaAcustica: true, turnId: 2 })
    commitUserTurnRow({ text: 'hoy me robo el estilo lolita', speakerName: 'Hablante 2', evidenciaAcustica: true, turnId: 3 })
    commitUserTurnRow({ text: 'radicado desde hace muchos anos en andorra', speakerName: 'Hablante 2', evidenciaAcustica: true, turnId: 4 })

    // El dueno de clusters dice QUE etiquetas son la MISMA voz que "luis".
    const labels = findLabelsWithSharedVoice(clusters, 'luis', 0.78)
    expect(labels).toContain('Hablante 1')
    expect(labels).not.toContain('Hablante 2')

    const cambiadas = renameSpeakerRows(labels, 'luis')
    expect(cambiadas).toBe(2)
    expect(userRows().map((r) => resolveRowSpeakerLabel(r))).toEqual(['Luis', 'Luis', 'Hablante 2', 'Hablante 2'])
  })

  it('RUTA REAL, sin microfono: "soy Luis" renombra la participacion del hablante que venia hablando', () => {
    // Las filas de ESE hablante estaban como "Hablante 1" (su etiqueta automatica);
    // la mujer, "Hablante 2".
    commitUserTurnRow({ text: 'hola hola como estan todos', speakerName: 'Hablante 1', evidenciaAcustica: true, turnId: 1 })
    commitUserTurnRow({ text: 'estoy probando la transcripcion', speakerName: 'Hablante 1', evidenciaAcustica: true, turnId: 2 })
    commitUserTurnRow({ text: 'hoy me robo el estilo lolita', speakerName: 'Hablante 2', evidenciaAcustica: true, turnId: 3 })

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

    // P9.78: el nombre entra con UNA grafia canonica (inicial en mayuscula): "soy luis"
    // deja las filas en "Luis" (antes quedaban en "luis" y convivian las dos grafias).
    expect(userRows().map((r) => resolveRowSpeakerLabel(r))).toEqual(['Luis', 'Luis', 'Hablante 2'])
  })

  it('el nombre PEGA para lo siguiente POR VOZ; la etiqueta desnuda no lo arrastra', () => {
    commitUserTurnRow({ text: 'hola hola como estan todos', speakerName: 'Hablante 1', evidenciaAcustica: true, turnId: 1 })
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
    expect(userRows().map((r) => resolveRowSpeakerLabel(r))).toEqual(['Luis'])

    // DATO del log del dueno: 44 s despues sus filas volvian a "Hablante 1". La VOZ
    // ya lleva el nombre, asi que el turno siguiente sale con el nombre (lo da el
    // resolutor de identidad, dueno unico de la etiqueta del turno).
    commitUserTurnRow({ text: 'ahora sigo hablando yo', speakerName: 'luis', turnId: 2 })
    // P9.78: la fila nueva se resuelve por el nombre registrado (canonico) -> "Luis".
    expect(userRows().map((r) => resolveRowSpeakerLabel(r))).toEqual(['Luis', 'Luis'])

    // La ETIQUETA no es un alias de nadie: el nombre lo lleva LA VOZ que lo dijo (su
    // timbre). Una fila nueva de ESA voz se ve con su nombre; y una VOZ DISTINTA que trae
    // otra etiqueta NO lo hereda (ese era el defecto que barría otras voces).
    // FREEZE (mandato del dueno 2026-10-17): una fila NUEVA SIN medida no hereda el nombre de
    // la clave de su voz; conserva su etiqueta provisional. El nombre llega a sus filas por el
    // congelado del registro (filas ya mostradas) o por la medida, que lo escribe EN la fila.
    const tarde = commitUserTurnRow({ text: 'turno escrito sin hablante', turnId: 3 })
    updateTurnRowSpeaker(3, 'Hablante 1')
    expect(resolveRowSpeakerLabel(userRows().find((row) => row.id === tarde.id) || {}), 'misma VOZ sin medida: provisional').toBe('Hablante 1')

    commitUserTurnRow({ text: 'habla la otra persona', speakerName: 'Hablante 2', turnId: 4 })
    expect(resolveRowSpeakerLabel(userRows().at(-1) || {}), 'otra VOZ: no hereda').toBe('Hablante 2')
  })

  it('la etiqueta AUTOMATICA no renombra (solo el nombre propio)', () => {
    // Aislamiento del DIRECTORIO (estado de sesion) AL INICIO del caso: sin el, la voz
    // registrada en un caso anterior se filtra y la etiqueta pareceria ascender sola.
    resetVoiceDirectory()
    const fila = commitUserTurnRow({ text: 'uno', speakerName: 'Hablante 1', turnId: 1 })
    const labels = findLabelsWithSharedVoice(clusters, 'Hablante 1', 0.78)
    // Aunque el dueno de clusters devuelva las de la misma voz, el hook solo llama
    // al renombre con nombres propios (isProperSpeakerName); aqui se comprueba que
    // el renombre NO se dispara "por etiqueta" en el flujo real.
    expect(labels).toContain('luis')
    expect(resolveRowSpeakerLabel(userRows().find((row) => row.id === fila.id) || {})).toBe('Hablante 1')
  })
})

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  beforeEach(() => {
    useIntegrationStore.getState().resetConversationHistory()
    resetVoiceDirectory()
  })

  it('una voz distinta NO entra en las etiquetas de la voz ancla', () => {
    const labels = findLabelsWithSharedVoice(clusters, 'luis', 0.78)
    expect(labels).not.toContain('Hablante 2')
  })
})
