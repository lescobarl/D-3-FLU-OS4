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
    publishedLiveRef,
    lastCommitAtRef,
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

// ============================================================
// HUECO DE FIDELIDAD MEDIDO (2026-10-10): este harness (y los demas de voz) usa un
// `syncConversationStream` PROPIO que empuja la fila con solo `turnCommit: true`. La
// produccion NO escribe la fila asi: en `conversationStreamCommit.js` el gate real es
// `if (refreshNeeded && settlesTurn)` (lineas 495 y 556). En el log del dueno (sesion
// 10:09-10:12) hubo 23 commits con `refresh=true` y SOLO 11 filas: los 12 sin fila son
// justo los que NO declaran cierre (`settlesTurn=false`). El harness no reproduce ese
// gate, asi que estos tests pueden estar VERDES mientras la app pierde texto.
// ============================================================
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

describe('turno VIEJO (stale): el srGap NO puede dejar el texto solo en ULTIMA FRASE', () => {
  it('ASR reciente (no silencio) + turno abierto hace rato -> la fila se escribe igual', () => {
    const h = createHarness()
    for (const texto of INTERINOS) {
      h.inject(chromeEvent([{ isFinal: false, transcript: texto }], 0))
    }
    // El turno lleva ABIERTO mas de srGapCommitMs (10 s) sin cerrar, pero el ASR
    // acaba de entregar un resultado (800 ms): el TRIGGER dispara por STALE y el
    // EVAL tiene que aceptar esa misma condicion, o el texto se pierde.
    h.lastCommitAtRef.current = Date.now() - 12000
    h.srGap(800)
    const filas = h.logRowsTextRef.current
    expect(filas.length, 'no se escribio ninguna fila: el texto queda en ULTIMA FRASE').toBeGreaterThanOrEqual(1)
    expect(filas.join(' ').length).toBeGreaterThan(60)
  })

  it('turno viejo SIN contenido nuevo NO duplica la fila (guarda conservada)', () => {
    const h = createHarness()
    for (const texto of INTERINOS) {
      h.inject(chromeEvent([{ isFinal: false, transcript: texto }], 0))
    }
    h.lastCommitAtRef.current = Date.now() - 12000
    h.srGap(800)
    const trasPrimero = h.logRowsTextRef.current.length
    h.lastCommitAtRef.current = Date.now() - 12000
    h.srGap(800)
    expect(h.logRowsTextRef.current.length).toBe(trasPrimero)
  })
})

// ============================================================
// REPLAY CON DATOS REALES DEL LOG DEL DUENO (2026-10-09 17:19:51).
// Textos y tiempos tomados 1:1 del trazo de esa sesion (VozProbe asrFinal +
// srGap{sinceResult:237,sinceCommit:10272}). Antes del arreglo, ese cierre NO
// escribia fila: la cola se quedaba en ULTIMA FRASE y se perdia.
// ============================================================
describe('REPLAY REAL del log: el cierre por turno viejo escribe la cola', () => {
  const COLA = 'conoces una transcripci\u00f3n larga se pierde otra vez es una chingadera neta'
  const ESCRITO_ANTES = 'conoce una transcripci\u00f3n larga se pierde otra vez'

  it('turno VIEJO (sinceResult=237ms / sinceCommit=10272ms): la fila lleva la cola completa', () => {
    const h = createHarness()
    h.inject(chromeEvent([{ isFinal: false, transcript: 'conoces una transcripci\u00f3n larga' }], 0))
    h.inject(chromeEvent([{ isFinal: false, transcript: 'conoces una transcripci\u00f3n larga se pierde otra vez' }], 0))
    h.inject(chromeEvent([{ isFinal: false, transcript: COLA }], 0))
    h.lastCommitAtRef.current = Date.now() - 10272
    h.srGap(237)
    const filas = h.logRowsTextRef.current
    const todo = filas.join(' ')
    expect(todo, 'la cola del turno se quedo en ULTIMA FRASE').toContain('es una chingadera neta')
    expect(todo.length).toBeGreaterThan(ESCRITO_ANTES.length)
  })

  it('control negativo REAL: turno RECIEN commiteado (sin turno viejo) no vuelca', () => {
    const h = createHarness()
    h.inject(chromeEvent([{ isFinal: false, transcript: COLA }], 0))
    h.lastCommitAtRef.current = Date.now() - 300
    h.srGap(237)
    expect(h.logRowsTextRef.current.length).toBe(0)
  })
})

// ============================================================
// PATRON REAL del dueno (debug.log 2026-10-10 10:09:00): un FINAL de Chrome con
// texto LARGO (la cuenta 1..30 ~316 chars) seguido del cierre por silencio. En su
// sesion el commit de ese final NO escribio fila (`src=sticky-preflight-pending`,
// refresh=true y 0 filas) y el texto se perdio: 23 commits -> 11 filas y 28 palabras
// del asrFinal en NINGUNA fila (D5).
// ============================================================
describe('final de Chrome + cierre: la fila lleva el texto del final', () => {
  const TEXTO =
    'vamos a hacer pruebas de transcripcion diarizacion este aqui estamos haciendo las primeras pruebas voy a contar ahora 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 18 19 20'

  it('el texto del FINAL acaba en alguna fila (no solo en ULTIMA FRASE)', () => {
    const h = createHarness()
    h.inject(chromeEvent([{ isFinal: true, transcript: TEXTO }], 0))
    h.srGap(12000)
    const todo = h.logRowsTextRef.current.join(' ')
    expect(todo, `filas=${JSON.stringify(h.logRowsTextRef.current)}`).toContain('vamos a hacer pruebas')
    expect(todo.length, `filas=${JSON.stringify(h.logRowsTextRef.current)}`).toBeGreaterThan(60)
  })
  it('final A -> silencio -> final B -> silencio: NINGUNA de las dos se pierde', () => {
    const h = createHarness()
    h.inject(chromeEvent([{ isFinal: true, transcript: TEXTO }], 0))
    h.srGap(12000)
    h.inject(chromeEvent([{ isFinal: true, transcript: 'sigue igual mal se perdio la transcripcion' }], 0))
    h.srGap(12000)
    const todo = h.logRowsTextRef.current.join(' | ')
    expect(todo, 'filas=' + JSON.stringify(h.logRowsTextRef.current)).toContain('vamos a hacer pruebas')
    expect(todo, 'filas=' + JSON.stringify(h.logRowsTextRef.current)).toContain('sigue igual mal')
  })
})


