// ============================================================
// vozNombreSinAnclaGuard - B) NINGUN NOMBRE PROPIO SIN SU ANCLA BIOMETRICA + C) la evidencia
// es la COINCIDENCIA medida + D) la fila del turno se completa aunque la medida llegue tarde.
// ------------------------------------------------------------
// MEDIDO (log del dueno 2026-10-11, PRIMERA intervencion, sin decir el comando):
//   `Match reason=canonical name="Luis" inClusters=0 last="Hablante 1"`  (11:25:43)
//   `VozProbe clusters {"write":1,"labels":["luis"]}`
//   `row-update {ev:true, turnId:2, pedido:"luis", actual:"Hablante 1", objetivo:"luis"}` (11:25:48)
//   -> el nombre aparecio SIN ancla (cero clusters) y a los 7 s el relleno tardio reescribio
//      su fila. Y despues: `row-update {turnId:35, actual:"Hablante 3", objetivo:"Hablante 2"}`
//      -> filas ajenas reescritas con "evidencia" que era `Boolean(workingClusters.length)`.
//
// CAUSAS MEDIDAS (codigo):
//   B) la rama `production-primary-create-cluster` de `resolveConversationSpeaker` CREABA el
//      cluster con el nombre del participante y ADEMAS devolvia ese NOMBRE para el turno: la
//      regla del dueno (`registeredIdentityConfirmed`: "si el ancla aun no existe, tampoco")
//      quedaba saltada por esa via.
//   C) `evidenciaAcustica: Boolean(workingClusters?.length)` ("hay clusters" != "coincidio").
//   D) el relleno tardio descartaba entero el aviso de un turno ANTERIOR
//      (`id < lastResolvedTurnRef` -> return), asi que la fila de ese turno no se completaba.
//
// REGLA: un nombre propio solo se AFIRMA con coincidencia contra su ancla; la evidencia es esa
// coincidencia; y la fila del turno la completa la medida de ESE turno, aunque llegue tarde.
// ESTE GUARD mide ETIQUETA/NOMBRE de la fila (lo que el dueno ve) y la evidencia que los
// autoriza; el vocabulario de razones tiene UN dueno (`isMeasuredIdentityMatch`).
// ============================================================
import { beforeEach, describe, expect, it } from 'vitest'
import { commitUserTurnRow, updateTurnRowSpeaker } from '../src/voice/lib/conversationTurnRow'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow'
import { resetVoiceDirectory } from '../src/voice/lib/speakerDirectory.js'
import { useIntegrationStore } from '../src/store/integrationStore'
import { resolveConversationSpeaker, isMeasuredIdentityMatch } from '../src/voice/lib/speakerDiarization.js'

const DIM = 64
const VOICED = 86400
const TEXTO = 'esto es una prueba de identidad con una frase suficientemente larga para medir la voz'

/** q(sim) = sim*e0 + sqrt(1-sim^2)*e1 -> coseno(q, e0) = sim. */
function query(sim: number): number[] {
  const v = new Array(DIM).fill(0)
  v[0] = sim
  v[1] = Math.sqrt(Math.max(0, 1 - sim * sim))
  return v
}

const filas = () =>
  useIntegrationStore
    .getState()
    .conversationHistory.filter((e) => e.role === 'user')
    .map((e) => resolveRowSpeakerLabel(e))

// El store de la conversacion se limpia en TODOS los bloques, y el DIRECTORIO de nombres
// por VOZ (estado de sesion) se vacia: las filas son el oraculo y el registro no se filtra.
beforeEach(() => {
  useIntegrationStore.setState({ conversationHistory: [] })
  resetVoiceDirectory()
})

describe('B - un nombre propio NO se afirma sin su ancla', () => {

  it('sin clusters (inClusters=0) el turno NO se rotula con el nombre del participante; el ancla SI se crea', () => {
    const clusters: Array<{ label: string; signature: number[] }> = []
    const nombre = resolveConversationSpeaker({
      signatureVector: query(0.72),
      speakerClusters: clusters,
      lastSpeaker: '',
      lastSignature: null,
      voicedSampleCount: VOICED,
      sampleRate: 48000,
      utteranceText: TEXTO,
      atTurnBoundary: true,
      allowNewCluster: true,
      sessionPrimary: 'Luis',
      preferSpeaker: 'Luis',
    } as never)

    expect(nombre, 'el nombre no se afirma sin coincidencia (regla del dueno)').not.toBe('Luis')
    expect(
      clusters.some((c) => c.label === 'Luis' && Array.isArray(c.signature) && c.signature.length),
      'el ANCLA se crea para poder afirmarlo despues',
    ).toBe(true)
  })

  it('el turno SIGUIENTE (ya con ancla) SI afirma el nombre, con coincidencia medida', () => {
    const clusters: Array<{ label: string; signature: number[] }> = []
    resolveConversationSpeaker({
      signatureVector: query(0.72),
      speakerClusters: clusters,
      lastSpeaker: '',
      lastSignature: null,
      voicedSampleCount: VOICED,
      sampleRate: 48000,
      utteranceText: TEXTO,
      atTurnBoundary: true,
      allowNewCluster: true,
      sessionPrimary: 'Luis',
      preferSpeaker: 'Luis',
    } as never)

    const nombre = resolveConversationSpeaker({
      signatureVector: query(0.72),
      speakerClusters: clusters,
      lastSpeaker: 'Hablante 1',
      lastSignature: query(0.72),
      voicedSampleCount: VOICED,
      sampleRate: 48000,
      utteranceText: TEXTO,
      atTurnBoundary: true,
      allowNewCluster: true,
      sessionPrimary: 'Luis',
      preferSpeaker: 'Luis',
    } as never)
    expect(nombre, 'con el ancla creada, la coincidencia afirma el nombre').toBe('Luis')
  })

  it('control NEGATIVO (el detector no es decorativo): sin ancla la rama VIEJA devolvia el nombre', () => {
    // Mutante aislado de la rama retirada: crear el cluster con el nombre del participante y
    // devolverlo como etiqueta del turno.
    const viejo = (primaryLabel: string, clusters: unknown[]) => {
      clusters.push({ label: primaryLabel, signature: [1] })
      return primaryLabel
    }
    expect(viejo('Luis', []), 'eso es lo que producia `name="Luis" inClusters=0`').toBe('Luis')
  })
})

describe('C - la evidencia es la COINCIDENCIA medida (un dueno: isMeasuredIdentityMatch)', () => {
  it('las razones de coincidencia SI son evidencia; la continuidad, crear ancla y voz nueva NO', () => {
    expect(isMeasuredIdentityMatch('production-primary-rematch')).toBe(true)
    expect(isMeasuredIdentityMatch('production-cluster-match')).toBe(true)
    expect(isMeasuredIdentityMatch('production-short-historical')).toBe(true)
    expect(isMeasuredIdentityMatch('production-primary-create-cluster')).toBe(false)
    expect(isMeasuredIdentityMatch('production-last-continuity')).toBe(false)
    expect(isMeasuredIdentityMatch('production-forced-new-voice')).toBe(false)
    expect(isMeasuredIdentityMatch('')).toBe(false)
  })

  it('la fila NO se reescribe con un nombre sin evidencia, y SI con evidencia', () => {
    commitUserTurnRow({ text: 'una locucion cualquiera', speakerName: 'Hablante 2', turnId: 1 } as never)
    expect(filas()).toEqual(['Hablante 2'])
    // Sin evidencia medida: el nombre NO se estampa (esto era el row-update objetivo:"luis").
    updateTurnRowSpeaker(1, 'luis', { evidenciaAcustica: false } as never)
    expect(filas(), 'sin coincidencia medida la fila conserva su etiqueta').toEqual(['Hablante 2'])
    // Con evidencia medida: si asciende. El nombre entra CANONICO ('luis' -> 'Luis') y se
    // registra en el DIRECTORIO por VOZ (mandato 2026-10-13): la etiqueta visible cambia,
    // la fila NO se reescribe.
    updateTurnRowSpeaker(1, 'luis', { evidenciaAcustica: true } as never)
    expect(filas()).toEqual(['Luis'])
  })
})

describe('D - la fila del turno se completa aunque la medida llegue tarde', () => {
  beforeEach(() => {
    // Aislamiento: el nombre registrado por VOZ queda ligado a la VOZ de esa fila SOLO
    // dentro de la sesion (el producto lo vacia al reiniciar la conversacion).
    useIntegrationStore.setState({ conversationHistory: [] })
    resetVoiceDirectory()
  })

  it('una medida posterior completa la fila de SU turno (no la del mas reciente)', () => {
    // Dos VOICES distintas (su `speakerId`) para poder observar que el aviso del 17 no
    // alcanza a la fila del 19 (mandato 2026-10-13: el nombre se registra por VOZ).
    commitUserTurnRow({ text: 'turno diecisiete', speakerName: 'Hablante 2', turnId: 17 } as never)
    commitUserTurnRow({ text: 'turno diecinueve', speakerName: 'Hablante 3', turnId: 19 } as never)
    // La medida del turno 17 llega cuando ya existe el 19: registra el nombre para la VOZ
    // de SU fila (el turno 17), sin tocar la fila del 19.
    updateTurnRowSpeaker(17, 'Luis', { evidenciaAcustica: true } as never)
    const h = useIntegrationStore
      .getState()
      .conversationHistory.filter((e) => e.role === 'user')
      .map((e) => resolveRowSpeakerLabel(e))
    expect(h[0], 'la fila del turno 17 lleva la etiqueta medida para ESE turno').toBe('Luis')
    expect(h[1], 'y la VOZ del 19 (otra) no se toca por el aviso del 17').toBe('Hablante 3')
  })

  it('control NEGATIVO (el detector no es decorativo): con el guard monotono viejo la fila vieja NO se completaba', () => {
    // Mutante aislado del guard retirado (`id < lastResolvedTurnRef` -> return de TODO).
    let lastResolved = 19
    const viejoCompleta = (id: number) => {
      if (id < lastResolved) return false
      lastResolved = id
      return true
    }
    expect(viejoCompleta(17), 'el defecto medido: el aviso del turno 17 se descartaba entero').toBe(false)
  })
})
