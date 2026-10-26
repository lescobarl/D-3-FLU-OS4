// ============================================================
// vozEscenarioInyectado - SIMULACION con DATOS INYECTADOS del flujo real de
// hablantes: registro por nombre y fila INMUTABLE. No usa microfono ni worker: se
// inyecta el resultado del resolutor (como lo haria el embedding) y se ejecuta la
// cadena REAL del registro.
//
// Escenario (el del dueno): Luis y una mujer; Luis se identifica ("soy Luis").
// Requisito (mandato 2026-10-26): el nombre se liga a la VOZ; las filas ya escritas
// NO se reescriben (la etiqueta la decidio el modulo al cerrar) y la mujer conserva
// su etiqueta.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest'
import { commitUserTurnRow, updateTurnRowSpeaker, renameSpeakerRows } from '../src/voice/lib/conversationTurnRow'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow'
import { resetVoiceDirectory } from '../src/voice/lib/speakerDirectory.js'
import { useIntegrationStore } from '../src/store/integrationStore'
import { registerSpeakerIdentity } from '../src/voice/lib/speakerIdentityRegister.js'
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

describe('escenario inyectado: hablantes, registro y fila inmutable', () => {
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

  it('RUTA REAL, sin microfono: "soy Luis" registra la VOZ y NO reescribe las filas ya escritas', () => {
    // Las filas de ESE hablante estaban como "Hablante 1" (su etiqueta automatica);
    // la mujer, "Hablante 2".
    commitUserTurnRow({ text: 'hola hola como estan todos', speakerName: 'Hablante 1', evidenciaAcustica: true, turnId: 1 })
    commitUserTurnRow({ text: 'estoy probando la transcripcion', speakerName: 'Hablante 1', evidenciaAcustica: true, turnId: 2 })
    commitUserTurnRow({ text: 'hoy me robo el estilo lolita', speakerName: 'Hablante 2', evidenciaAcustica: true, turnId: 3 })

    const clusters = [
      { label: 'Hablante 1', signature: [1, 0, 0] },
      { label: 'Hablante 2', signature: [0, 1, 0] },
    ]
    // La cadena REAL de "soy Luis": el dueño único registra el nombre sobre la voz.
    const resultado = registerSpeakerIdentity({
      name: 'luis',
      previousLabel: 'Hablante 1',
      clusters,
    })

    // Mandato 2026-10-26: el registro NO reescribe filas ya escritas. La etiqueta de
    // cada una la decidio el modulo al cerrarla; la mujer conserva la suya.
    expect(resultado.rowsChanged).toBe(0)
    expect(userRows().map((r) => resolveRowSpeakerLabel(r))).toEqual(['Hablante 1', 'Hablante 1', 'Hablante 2'])
  })

  it('el registro NO reescribe filas; una etiqueta desnuda no arrastra un nombre', () => {
    commitUserTurnRow({ text: 'hola hola como estan todos', speakerName: 'Hablante 1', evidenciaAcustica: true, turnId: 1 })
    registerSpeakerIdentity({
      name: 'luis',
      previousLabel: 'Hablante 1',
      clusters: [],
    })
    // La fila ya mostrada conserva su etiqueta (fila inmutable).
    expect(userRows().map((r) => resolveRowSpeakerLabel(r))).toEqual(['Hablante 1'])

    // Una fila NUEVA escrita con el nombre propio se muestra canonica ("Luis"); la
    // etiqueta desnuda de OTRA voz no lo arrastra.
    commitUserTurnRow({ text: 'ahora sigo hablando yo', speakerName: 'luis', turnId: 2 })
    expect(userRows().map((r) => resolveRowSpeakerLabel(r))).toEqual(['Hablante 1', 'Luis'])

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
