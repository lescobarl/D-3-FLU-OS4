// ============================================================
// vozLocucionVivaLargaGuard - SIMULACION + GUARD del defecto MEDIDO
// ------------------------------------------------------------
// EVIDENCIA (debug.log del dueno, 2026-10-07 15:37:15-15:38:31 UTC):
//   El micro capturo SIN parar (MicPcm crecio hasta el tope de 30 s y se quedo
//   saturado 46 s) y NO hubo NI UN commit durante 76 segundos; despues llego un
//   final de UNA palabra ("mientras") y esa fue TODA la fila. El texto de esos
//   76 s vivia en ULTIMA FRASE (interinos) y nunca paso a la conversacion.
//
// CAUSA: Chrome puede emitir interinos durante minutos sin entregar un `final`.
// El unico cierre por `srGap` exigia `srGapCommitMs` SIN onresult, y los interinos
// refrescan ese reloj -> nunca disparaba. La locucion viva se quedaba colgada.
//
// FIX (sin ruta nueva): el MISMO cierre por `srGap` gana un segundo disparador,
// la LOCUCION VIVA estancada (`resolveSrGapTrigger`, fluTranscriptPause.js). El
// hook ya no pregunta "¿silencio?" sino "¿silencio O locucion sin cerrar?".
//
// Nace ROJO (resolveSrGapTrigger no existia). Verde con el disparador.
// ============================================================
import { describe, it, expect } from 'vitest'
import { resolveSrGapTrigger } from '../src/voice/lib/fluTranscriptPause.js'
import { createConversationIngressRuntime } from '../src/voice/lib/conversationIngressBridge.js'
import { pushMicSpeechEvent, pushRecognitionEndEvent } from '../src/voice/lib/micEventProducer.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'

function chromeEvent(specs: Array<{ isFinal?: boolean; transcript: string }>, resultIndex = 0) {
  const results = specs.map((s) => ({
    isFinal: Boolean(s.isFinal),
    0: { transcript: s.transcript, confidence: 0.9 },
    length: 1,
  }))
  return { resultIndex, results }
}

function createHarness() {
  const listenStateRef = { current: createActiveListenState() }
  const publishedLiveRef = { current: '' }
  const lastStreamPreviewRef = { current: '' }
  const logRowsTextRef = { current: [] as string[] }
  const logRowSpeakersRef = { current: [] as string[] }
  const lastEmittedTranscriptRef = { current: '' }
  const lastLoggedSpeakerRef = { current: 'Hablante 1' }
  const lastCommitAtRef = { current: 0 }
  const preflightScheduledForTurnRef = { current: false }
  const openPreviewTurnRef = { current: false }
  const bindings = {
    conversationActiveRef: { current: true },
    listenStateRef,
    publishedLiveRef,
    lastStreamPreviewRef,
    logRowsTextRef,
    logRowSpeakersRef,
    lastEmittedTranscriptRef,
    lastLoggedSpeakerRef,
    lastCommitAtRef,
    preflightScheduledForTurnRef,
    openPreviewTurnRef,
    debugHotPath: false,
    fluDebugHot: () => {},
    getIngressVoiceContext: () => ({}),
    tryDispatchConversationAction: () => false,
    flushTranscriptOnFinal: () => {},
    flushPcmAfterTurnCommit: () => {},
    maybeSwitchRecognitionLocale: () => {},
    commitTurnToSessionRows: () => {},
    syncConversationStream: (payload: any = {}) => {
      const capture = payload?.capture || ''
      if (!capture) return
      if (payload?.turnCommit) {
        logRowsTextRef.current.push(capture)
        lastEmittedTranscriptRef.current = capture
        publishedLiveRef.current = capture
        lastCommitAtRef.current = Date.now()
      } else {
        publishedLiveRef.current = capture
      }
    },
    markAudioSegmentStart: () => {},
    touchMeaningfulIngress: () => {},
    scheduleIdentityPreflight: () => {},
    peekTurnBridgeText: () => '',
    stashTurnBridgeText: () => {},
    consumeTurnBridgeText: () => '',
    onTurnFinalized: () => {},
  }
  const runtime = createConversationIngressRuntime({ getBindings: () => bindings })
  return {
    runtime,
    logRowsTextRef,
    inject(event: unknown) {
      pushMicSpeechEvent(event as never, runtime.queue)
      runtime.drainAll()
    },
    end() {
      pushRecognitionEndEvent(runtime.queue)
      runtime.drainAll()
    },
    srGap(sinceLastResultMs: number) {
      runtime.pushSrGapEvent({ sinceLastResultMs })
      runtime.drainAll()
    },
  }
}

// Locucion larga que Chrome entrega como interinos ACUMULATIVOS (nunca un final).
const INTERINOS = [
  'estoy hablando durante mucho rato sin que el reconocedor cierre la frase',
  'estoy hablando durante mucho rato sin que el reconocedor cierre la frase y sigo hablando',
  'estoy hablando durante mucho rato sin que el reconocedor cierre la frase y sigo hablando todavia mas',
]

describe('locucion viva sin cerrar: el texto NO puede quedarse solo en ULTIMA FRASE', () => {
  it('resolveSrGapTrigger dispara con la locucion estancada aunque el ASR entregue interinos', () => {
    const estancada = resolveSrGapTrigger({ sinceLastResultMs: 800, sinceLastCommitMs: 12000 })
    expect(estancada.fire).toBe(true)
    expect(estancada.sinceLastResultMs).toBeGreaterThanOrEqual(10000)
  })

  it('escenario real: interinos largos + srGap -> la fila conserva el texto (no "mientras")', () => {
    const h = createHarness()
    for (const texto of INTERINOS) {
      h.inject(chromeEvent([{ isFinal: false, transcript: texto }], 0))
    }
    h.srGap(12000)
    const filas = h.logRowsTextRef.current
    expect(filas.length).toBeGreaterThanOrEqual(1)
    expect(filas.join(' ').length).toBeGreaterThan(60)
  })
})

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('NO dispara cuando el ASR esta activo y la locucion es reciente', () => {
    expect(resolveSrGapTrigger({ sinceLastResultMs: 2000, sinceLastCommitMs: 2000 }).fire).toBe(false)
  })
  it('SI dispara por silencio del ASR (comportamiento previo, conservado)', () => {
    expect(resolveSrGapTrigger({ sinceLastResultMs: 12000, sinceLastCommitMs: 12000 }).fire).toBe(true)
  })
})
