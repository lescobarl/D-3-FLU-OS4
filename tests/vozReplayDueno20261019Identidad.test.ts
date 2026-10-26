// ============================================================
// vozReplayDueno20261019Identidad - REPLAY de los defectos 3 y 4 del dueno (2026-10-19)
// ------------------------------------------------------------
// DEFECTOS REPORTADOS:
//   3. "ok flu soy luis" NO se aplico a TODA la conversacion: las primeras
//      intervenciones del dueno siguieron como "Hablante 1".
//   4. Diarizacion MAL: a la mujer se le puso "Luis" y la MISMA mujer quedo partida
//      como "Hablante 1" / "Hablante 3".
//
// DATOS (log preservado del dueno `flu-session-20261019-102115.log`, 1.182.806 bytes):
//   - 15:45:54 `identity-register {"name":"Luis","anchor":"Hablante 1",
//     "turnMeasured":0,"baseVector":512,"signatures":0,"rows":20,"registeredInBase":true}`
//     -> el nombre se anclo SIN vector medido del turno y la BASE quedo sembrada con la
//     firma de un CLUSTER (512-D): cualquier voz parecida paso a ser "Luis".
//   - Turnos con las similitudes exactas del log: t56 Hablante 2 0.41 / Luis 0.313;
//     t65 Luis 0.832 / Hablante 2 0.634; t67 Hablante 3 1.0 / Hablante 2 0.607 /
//     Luis 0.17; t70 Hablante 2 0.958 / Luis 0.529 / Hablante 3 0.514; t74 Hablante 2
//     0.785 / Luis 0.759 / Hablante 3 0.189. La misma voz aparece con DOS etiquetas
//     (Luis/Hablante 1 y Hablante 3) y la mujer (Hablante 2) queda aparte.
//
// LIMITACION HONESTA: el log NO guarda PCM ni los vectores de 512-D; este replay
// reconstruye vectores con las MISMAS similitudes (la voz partida mide coseno 0.99 con
// su otra etiqueta; la mujer, coseno 0 con ambas) y ejecuta la cadena REAL de registro
// y de fila. No se simula embedding ni audio.
//
// QUE SE FIJA:
//   A. La identidad se ancla a la VOZ MEDIDA del turno, no a `previousLabel` (la voz
//      anterior puede ser la TV o la mujer).
//   B. El registro liga el nombre a TODAS las etiquetas de ESA voz (la partida en
//      Hablante 1 y Hablante 3) en la VOZ, y jamas a la voz distinta. Las filas ya
//      escritas NO se reescriben (mandato 2026-10-26).
//   C. SIN vector medido no se escribe ni el DIRECTORIO ni la BASE (el `baseVector:512`
//      del log era exactamente el defecto).
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commitUserTurnRow } from '../src/voice/lib/conversationTurnRow'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow'
import { resetVoiceDirectory, resolveVoiceIdentity, voiceVectorModel } from '../src/voice/lib/speakerDirectory.js'
import { registerSpeakerIdentity } from '../src/voice/lib/speakerIdentityRegister.js'
import { findLabelsWithSharedVoice } from '../src/voice/lib/speakerClusters'
import { useIntegrationStore } from '../src/store/integrationStore'

/** Vectores reconstruidos de las similitudes del log: misma voz (0.99) vs mujer (0). */
const VOZ_LUIS = [1, 0, 0, 0]
const VOZ_LUIS_PARTIDA = [0.99, 0.12, 0, 0] // cos 0.9927 con VOZ_LUIS (misma voz partida)
const VOZ_MUJER = [0, 1, 0, 0]

const userRows = () => useIntegrationStore.getState().conversationHistory.filter((r) => r.role === 'user')

/** Filas del escenario del log: dueno (dos etiquetas por re-cluster) + mujer. */
function sembrarFilasDelLog() {
  // El dueno habla con dos etiquetas de la MISMA voz (Hablante 1 y Hablante 3).
  commitUserTurnRow({ text: 'hola hola como estan todos', speakerName: 'Hablante 1', evidenciaAcustica: true, turnId: 56 })
  commitUserTurnRow({ text: 'estoy probando la transcripcion', speakerName: 'Hablante 1', evidenciaAcustica: true, turnId: 57 })
  // La mujer.
  commitUserTurnRow({ text: 'hoy me robo el estilo lolita', speakerName: 'Hablante 2', evidenciaAcustica: true, turnId: 58 })
  // El dueno vuelve, ya re-clusterizado como Hablante 3 (defecto 4: misma voz partida).
  commitUserTurnRow({ text: 'radicado desde hace muchos anos en andorra', speakerName: 'Hablante 3', evidenciaAcustica: true, turnId: 59 })
  commitUserTurnRow({ text: 'eso es un problema de la transcripcion', speakerName: 'Hablante 2', evidenciaAcustica: true, turnId: 60 })
}

/** Clusters vivos del log: la voz del dueno partida en 1 y 3; la mujer en 2. */
function clustersDelLog() {
  return [
    { label: 'Hablante 1', signature: [...VOZ_LUIS], signatureHistory: [[...VOZ_LUIS]] },
    { label: 'Hablante 2', signature: [...VOZ_MUJER], signatureHistory: [[...VOZ_MUJER]] },
    { label: 'Hablante 3', signature: [...VOZ_LUIS_PARTIDA], signatureHistory: [[...VOZ_LUIS_PARTIDA]] },
  ]
}

function refsDeSesion() {
  const registerParticipant = vi.fn()
  const setClusters = vi.fn()
  return {
    registerParticipant,
    setClusters,
    refs: {
      sessionPrimarySpeakerRef: { current: '' },
      setClusters,
      registerParticipant,
    },
  }
}

const etiquetasMostradas = () => userRows().map((row) => resolveRowSpeakerLabel(row))

beforeEach(() => {
  useIntegrationStore.getState().resetConversationHistory()
  resetVoiceDirectory()
})

describe('replay 2026-10-19 · defecto 4: la misma voz partida en dos etiquetas', () => {
  it('el detector del grupo: Hablante 1 y Hablante 3 son la MISMA voz; la mujer queda fuera', () => {
    const labels = findLabelsWithSharedVoice(clustersDelLog(), 'Hablante 1')
    expect(labels).toContain('Hablante 3')
    expect(labels).not.toContain('Hablante 2')
  })

  it('"soy Luis" con la voz MEDIDA liga el nombre a TODA la voz partida sin reescribir filas', () => {
    sembrarFilasDelLog()
    const { refs, registerParticipant, setClusters } = refsDeSesion()

    const resultado = registerSpeakerIdentity({
      name: 'Luis',
      clusters: clustersDelLog(),
      previousLabel: 'Hablante 3', // la voz re-clusterizada que dice su nombre
      signatureVector: VOZ_LUIS_PARTIDA,
      refs,
    })

    // Mandato 2026-10-26: las filas ya escritas conservan su etiqueta; el nombre queda
    // en la VOZ (clusters unidos + directorio) para las locuciones que el modulo cierre.
    expect(etiquetasMostradas()).toEqual([
      'Hablante 1',
      'Hablante 1',
      'Hablante 2', // la mujer NO hereda
      'Hablante 3',
      'Hablante 2',
    ])
    expect(resultado.rowsChanged).toBe(0)

    // Los clusters de la misma voz quedan UNIDOS; el de la mujer sigue intacto.
    const publicados = setClusters.mock.calls.at(-1)?.[0] || []
    const etiquetasCluster = publicados.map((c: any) => c.label)
    expect(etiquetasCluster).toContain('Luis')
    expect(etiquetasCluster).toContain('Hablante 2')
    expect(etiquetasCluster).not.toContain('Hablante 1')
    expect(etiquetasCluster, 'el cluster de la mujer no puede absorberse: ' + JSON.stringify(etiquetasCluster))
      .not.toContain('Hablante 3')

    // La BASE recibe SOLO el vector MEDIDO del turno (no una firma de cluster).
    expect(registerParticipant).toHaveBeenCalledTimes(1)
    expect(registerParticipant).toHaveBeenCalledWith('Luis', 'Luis', VOZ_LUIS_PARTIDA)

    // El DIRECTORIO responde por VOZ: la del dueno es Luis; la de la mujer NO.
    expect(resolveVoiceIdentity(VOZ_LUIS)?.name).toBe('Luis')
    expect(resolveVoiceIdentity(VOZ_MUJER), 'la mujer no puede resolver a Luis').toBeNull()
  })
})

describe('replay 2026-10-19 · defecto 3: el nombre se pega a la VOZ, no al ultimo hablante', () => {
  it('previousLabel es la MUJER, pero la voz medida es el dueno: solo el dueno cambia', () => {
    sembrarFilasDelLog()
    const { refs, registerParticipant } = refsDeSesion()

    // Turno 56 del log: el nombre llega con la etiqueta heredada de la mujer
    // (continuidad por ultimo hablante); la MEDIDA del turno es la voz del dueno.
    const resultado = registerSpeakerIdentity({
      name: 'Luis',
      clusters: clustersDelLog(),
      previousLabel: 'Hablante 2',
      signatureVector: VOZ_LUIS,
      refs,
    })

    expect(etiquetasMostradas(), 'ninguna fila ya escrita se reescribe').toEqual([
      'Hablante 1',
      'Hablante 1',
      'Hablante 2',
      'Hablante 3',
      'Hablante 2',
    ])
    expect(resultado.labels).not.toContain('Hablante 2')
    expect(registerParticipant).toHaveBeenCalledWith('Luis', 'Luis', VOZ_LUIS)
    expect(resolveVoiceIdentity(VOZ_MUJER)).toBeNull()
  })

  it('la comparacion es sobre VECTORES: un candidato de la base casa por timbre y la mujer no', () => {
    const model = voiceVectorModel()
    const base = [{ name: 'Luis', vector: [...VOZ_LUIS], model }]
    expect(resolveVoiceIdentity(VOZ_LUIS, { candidates: base })?.name).toBe('Luis')
    expect(resolveVoiceIdentity(VOZ_MUJER, { candidates: base }), 'coseno 0 no es identidad').toBeNull()
  })
})

describe('replay 2026-10-19 · el baseVector:512 del log no puede volver', () => {
  it('SIN vector medido: no se escribe la BASE, no se nombra el DIRECTORIO y la mujer no hereda', () => {
    sembrarFilasDelLog()
    const { refs, registerParticipant } = refsDeSesion()

    // La linea del log: turnMeasured:0. El nombre se afirma por CONTINUIDAD de una
    // etiqueta automatica; no hay vector del turno que demuestre de quien es la voz.
    const resultado = registerSpeakerIdentity({
      name: 'Luis',
      clusters: clustersDelLog(),
      previousLabel: 'Hablante 1',
      signatureVector: null,
      refs,
    })

    // El grupo por FIRMA (Hablante 1 + Hablante 3) es la misma voz re-clusterizada: el
    // registro lo devuelve en `labels`. Lo que NO se hace sin medida es afirmar la
    // IDENTIDAD en la base ni en el directorio, NI reescribir las filas ya escritas.
    expect(etiquetasMostradas()).toEqual([
      'Hablante 1',
      'Hablante 1',
      'Hablante 2',
      'Hablante 3',
      'Hablante 2',
    ])
    expect(resultado.rowsChanged).toBe(0)
    expect(resultado.labels).toEqual(['Hablante 1', 'Hablante 3'])

    // LO QUE EL LOG MEDIA MAL: `baseVector:512` y `registeredInBase:true`.
    expect(registerParticipant, 'sin vector medido NO se siembra la base').not.toHaveBeenCalled()
    // Y el directorio queda sin nombre para esa voz (no se afirma identidad sin medida).
    expect(resolveVoiceIdentity(VOZ_LUIS)).toBeNull()
    expect(resolveVoiceIdentity(VOZ_MUJER)).toBeNull()
  })

  it('un nombre SIN vector no borra ni pisa el timbre que la voz ya tenia', () => {
    const { refs } = refsDeSesion()
    registerSpeakerIdentity({
      name: 'Luis',
      clusters: clustersDelLog(),
      previousLabel: 'Hablante 1',
      signatureVector: VOZ_LUIS,
      refs,
    })
    // Una segunda ruta (renombre del panel / resolucion tardia) llega SIN medida.
    registerSpeakerIdentity({
      name: 'Luis',
      clusters: clustersDelLog(),
      previousLabel: 'Hablante 1',
      signatureVector: null,
      refs: refsDeSesion().refs,
    })
    // El timbre de la voz sigue registrado: la identidad entre turnos no se pierde.
    expect(resolveVoiceIdentity(VOZ_LUIS)?.name).toBe('Luis')
    expect(resolveVoiceIdentity(VOZ_MUJER)).toBeNull()
  })
})
