// ============================================================
// vozLocucionConfirmadaNoSePierdeGuard - LA PERDIDA GARRAFAL del dueno (19:24).
// ------------------------------------------------------------
// MEDIDO (log del dueno 2026-10-10 19:20-19:29, analizador D5): 42 palabras de ASR FINAL
// y 98 interinos NO llegaron a NINGUNA fila. Caso concreto (t=26): la intervencion de la
// chica
//   "huele delicioso ... Ya estan listos los fideos"
// termino con un FINAL de Chrome; despues llegaron interinos de la locucion SIGUIENTE sin
// cierre; a los ~4.2 s de silencio el watchdog REBUILDA, y `flushListenStateBeforeRebuild`
// pregunta `hasConfirmedOpenLine`. Como los interinos posteriores tocan la linea
// (`openLineLastTouchMs > lastFinalAtMs`), el veredicto era "no confirmada" -> la linea se
// DESCARTA con la locucion dentro. La fila nunca se escribio.
//
// REGLA (corregida): la pregunta no es "la linea fue tocada despues?" sino "HAY UNA
// LOCUCION CONFIRMADA SIN FILA?" (`pendingFinal`, marcado por el ingress al confirmar un
// FINAL de segmento). El parcial EN VUELO se sigue descartando; la CONFIRMADA se sella.
// ============================================================
import { describe, expect, it } from 'vitest'
import { createConversationIngressRuntime } from '../src/voice/lib/conversationIngressBridge.js'
import { pushMicSpeechEvent, pushRecognitionEndEvent } from '../src/voice/lib/micEventProducer.js'
import { createActiveListenState, hasConfirmedOpenLine, readStreamDisplay } from '../src/voice/lib/activeListen.js'
import { handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js'

function chromeEvent(specs: Array<{ isFinal?: boolean; transcript: string }>, resultIndex = 0) {
  const results = specs.map((s) => ({
    isFinal: Boolean(s.isFinal),
    0: { transcript: s.transcript, confidence: 0.9 },
    length: 1,
  }))
  return { resultIndex, results }
}

function createHarness() {
  const rows: string[] = []
  const listenState = createActiveListenState()
  const bindings: Record<string, unknown> = {
    conversationActiveRef: { current: true },
    listenStateRef: { current: listenState },
    publishedLiveRef: { current: '' },
    lastStreamPreviewRef: { current: '' },
    logRowsTextRef: { current: rows },
    logRowSpeakersRef: { current: [] as string[] },
    lastEmittedTranscriptRef: { current: '' },
    lastLoggedSpeakerRef: { current: 'Hablante 2' },
    lastSpeakerRef: { current: 'Hablante 2' },
    lastCommitAtRef: { current: 0 },
    lastCommitPerfAtRef: { current: 0 },
    preflightScheduledForTurnRef: { current: false },
    openPreviewTurnRef: { current: false },
    speakerClustersRef: { current: [] },
    debugHotPath: false,
    fluDebugHot: () => {},
    getIngressVoiceContext: () => ({}),
    tryDispatchConversationAction: () => false,
    flushTranscriptOnFinal: () => {},
    flushPcmAfterTurnCommit: () => {},
    maybeSwitchRecognitionLocale: () => {},
    commitTurnToSessionRows: () => {},
    peekTurnBridgeText: () => '',
    stashTurnBridgeText: () => {},
    consumeTurnBridgeText: () => '',
    onTurnFinalized: () => {},
    markAudioSegmentStart: () => {},
    touchMeaningfulIngress: () => {},
    scheduleIdentityPreflight: () => {},
    getSpeakerLabel: () => 'Hablante 2',
    formatClock: () => '00:00',
    syncSpeakerIndexFromLabel: () => {},
    detectWakeIntroducedName: () => false,
    wakeWords: [] as string[],
    markCommitPerfNow: () => {},
    getLastCommitPerfAt: () => 0,
    clearTurnAudioSnapshot: () => {},
    renameSpeakerRows: () => {},
    setSpeakerClusters: () => {},
    getSpeakerClusters: () => [],
    getTurnAudioSnapshot: () => null,
    emitConversationLog: (text: string) => {
      rows.push(text)
      return true
    },
    syncConversationStream: (payload: any = {}) => handleConversationStreamSync(ctx, payload),
  }
  const ctx = new Proxy(bindings, {
    get: (t, k) => {
      if (k in t) return (t as any)[k]
      if (typeof k === 'string' && k.endsWith('Ref')) return { current: null }
      return () => null
    },
  }) as any
  const runtime = createConversationIngressRuntime({ getBindings: () => ctx })
  return {
    rows,
    listenState,
    result(event: unknown) {
      const pushed = pushMicSpeechEvent(event as never, runtime.queue)
      if (pushed) runtime.drainAll()
    },
    /** El watchdog ante SILENCIO (mismo `flushListenStateBeforeRebuild`): si hay locucion
     *  confirmada sin fila, sella por onend en vez de descartarla. */
    rebuildTrasSilencio() {
      const confirmada = hasConfirmedOpenLine(listenState)
      if (confirmada) {
        const pushed = pushRecognitionEndEvent(runtime.queue)
        if (pushed) runtime.drainAll()
      }
      return confirmada
    },
    lineaViva: () => readStreamDisplay(listenState),
  }
}

const CHICA =
  'huele delicioso aquí tenemos los fideos nuestra salsita y nuestro sazonador Entonces voy a ir a hacer los fideos y ahorita regreso Ya están listos los fideos'
const SIGUIENTE = 'su nombre lo dice pues es de alga casi no me gusta el sabor a pescado'

describe('la locucion CONFIRMADA sin fila no se pierde', () => {
  it('(util) FINAL + interinos posteriores + rebuild por silencio => la locucion queda en fila', () => {
    const h = createHarness()
    h.result(chromeEvent([{ isFinal: false, transcript: CHICA }], 0))
    h.result(chromeEvent([{ isFinal: true, transcript: CHICA }], 0))
    h.result(chromeEvent([{ isFinal: true, transcript: CHICA }, { isFinal: false, transcript: SIGUIENTE }], 1))
    expect(h.rebuildTrasSilencio(), 'hay una confirmada sin fila').toBe(true)
    expect(h.rows.join(' | '), 'filas=' + JSON.stringify(h.rows)).toContain('huele delicioso')
  })

  it('(util) el CIERRE sella la CONFIRMADA (ancla del turno), no un parcial suelto', () => {
    const h = createHarness()
    h.result(chromeEvent([{ isFinal: true, transcript: CHICA }], 0))
    h.result(chromeEvent([{ isFinal: true, transcript: CHICA }, { isFinal: false, transcript: 'la transcripcion desde' }], 1))
    h.rebuildTrasSilencio()
    const fila = h.rows.join(' | ')
    expect(fila, 'la confirmada se sella entera').toContain('huele delicioso')
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): sin la marca de confirmada, la linea se descarta', () => {
    const h = createHarness()
    // Un INTERINO en vuelo (sin FINAL): NO es captura confirmada -> se descarta (no se commitea).
    h.result(chromeEvent([{ isFinal: false, transcript: SIGUIENTE }], 0))
    expect(hasConfirmedOpenLine(h.listenState), 'interino en vuelo = no confirmada').toBe(false)
    expect(h.rebuildTrasSilencio()).toBe(false)
    expect(h.rows, 'nada que sellar: no hay fila de basura').toHaveLength(0)
  })
})
