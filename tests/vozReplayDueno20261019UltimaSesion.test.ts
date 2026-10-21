// ============================================================
// vozReplayDueno20261019UltimaSesion - REPLAY de la ULTIMA prueba del dueno (2026-10-19)
// ------------------------------------------------------------
// DATOS MEDIDOS (log preservado de la ultima sesion, `$TEMP/flu-session-live.log`,
// 21:18:49-21:21:27). No hay PCM ni vectores en el log: este replay reconstruye la
// SECUENCIA REAL de Chrome (interims que crecen, finales de tramo y silencio) con los
// textos LITERALES medidos. Se declara HONESTO: no se simula audio ni embedding.
//
// DEFECTO 1 MEDIDO (21:18:52.065): la fila del dictado se escribio con len=430
//   = 315 chars dichos + 112 chars de la locucion SIGUIENTE ("voy a hacer un alto...").
//   Causa: el volcado de `pendingFinal` (P9.68-b) reconciliaba el texto CERRADO contra
//   la linea viva, que ya contenia el interino de la locucion nueva.
// DEFECTO 4 MEDIDO (21:18:55.734): esos mismos 112 chars se escribian OTRA vez como
//   fila propia ("perdida de transcripcion" / partes duplicadas).
// DEFECTO 5 MEDIDO (21:20:48-21:21:22): un COMANDO con wake INLINE
//   ("digo el comando para que le ponga nombre Okay flu soy Luis") se recortaba a su
//   prefijo pasivo (40 chars) y no cerraba la linea: la locucion siguiente (316 chars)
//   se le pegaba y el srGap la descartaba reescribiendo la fila con esos 40.
//
// HARNESS FIEL: el sink del ingress es el COMMIT REAL (`handleConversationStreamSync`),
// igual que en produccion (`useFluVoiceAssistant.js` -> `syncConversationStream`), y la
// caja es la REAL (`crearCajaDeLaFrase`).
// ============================================================
import { describe, expect, it } from 'vitest'
import { createConversationIngressRuntime } from '../src/voice/lib/conversationIngressBridge.js'
import {
  pushMicSpeechEvent,
  pushRecognitionEndEvent,
  pushSrGapEvent,
} from '../src/voice/lib/micEventProducer.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import { crearCajaDeLaFrase, handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js'
import { resolveInlineWakeAtCommit } from '../src/voice/lib/wakeTurnCommit.js'

function chromeEvent(specs: Array<{ isFinal?: boolean; transcript: string }>, resultIndex = 0) {
  const results = specs.map((s) => ({
    isFinal: Boolean(s.isFinal),
    0: { transcript: s.transcript, confidence: 0.9 },
    length: 1,
  }))
  return { resultIndex, results }
}

// Textos LITERALES del log de la ultima prueba (se conservan tildes y variantes del ASR).
const DICTADO =
  'bien Vamos a iniciar con las pruebas de transcripción y viarización es bien importante que le demos seguimiento a este log vamos a voy a ir narrando aquí para no estar escribiendo tanto allá de aquel lado pero aquí voy narrando lo que voy viendo y hasta ahorita está transcribiendo bastante bien va buen ritmo y claro'
// Interino que la linea viva acumulo ANTES del final (variante A, la de la fila de 430).
const COLA_INTERINA =
  'voy a hacer un alto para para que tenga un silencio y haga la transcripción vamos a ver con qué hablante lo pone'
// Captura del cierre real (variante B del ASR, la de la fila de 112).
const COLA_CIERRE =
  'voy a hacer un alto para para que tenga un silencio y haga la transcripción vamos a ver con qué habla te lo pone'

function createHarness() {
  const rows: string[] = []
  const visible: string[] = []
  const publishedLiveRef = { current: '' }
  const lastOnresultAtRef = { current: 0 }
  let pendingLive: string | null = null
  const cajaDeLaFrase = crearCajaDeLaFrase({
    publishedLiveRef,
    cancelLiveTranscriptUpdate: () => {
      pendingLive = null
    },
    scheduleLiveTranscriptUpdate: (texto: string) => {
      pendingLive = texto
    },
    setLiveTranscript: (texto: string) => {
      visible.push(texto)
    },
  })
  const bindings: Record<string, unknown> = {
    conversationActiveRef: { current: true },
    listenStateRef: { current: createActiveListenState() },
    publishedLiveRef,
    lastStreamPreviewRef: { current: '' },
    logRowsTextRef: { current: rows },
    logRowSpeakersRef: { current: [] as string[] },
    lastEmittedTranscriptRef: { current: '' },
    lastLoggedSpeakerRef: { current: 'Hablante 1' },
    lastSpeakerRef: { current: 'Hablante 1' },
    lastCommitAtRef: { current: 0 },
    lastCommitPerfAtRef: { current: 0 },
    lastOnresultAtRef,
    preflightScheduledForTurnRef: { current: false },
    openPreviewTurnRef: { current: false },
    speakerClustersRef: { current: [] },
    debugHotPath: false,
    cajaDeLaFrase,
    setLiveTranscript: (texto: string) => {
      visible.push(texto)
    },
    scheduleLiveTranscriptUpdate: (texto: string) => {
      pendingLive = texto
    },
    cancelLiveTranscriptUpdate: () => {
      pendingLive = null
    },
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
    finalizeTurnIdentityPipeline: () => null,
    getSpeakerLabel: () => 'Hablante 1',
    formatClock: () => '00:01',
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
    // LA FILA: unica puerta de emision.
    emitConversationLog: (texto: string) => {
      rows.push(texto)
      return true
    },
    // sink del ingress = COMMIT REAL (mismo cableado que produccion).
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
  const drain = (pushed: unknown) => {
    if (pushed) runtime.drainAll()
  }
  return {
    ctx,
    rows,
    visible,
    lastVisible: () => visible[visible.length - 1] ?? '',
    flushPending() {
      if (pendingLive === null) return false
      visible.push(pendingLive)
      pendingLive = null
      return true
    },
    result(event: unknown) {
      // El hook sella `lastOnresultAtRef` en CADA onresult (produccion).
      lastOnresultAtRef.current = Date.now()
      drain(pushMicSpeechEvent(event as never, runtime.queue))
    },
    srGap(sinceLastResultMs = 99999) {
      drain(pushSrGapEvent({ sinceLastResultMs }, runtime.queue))
    },
    end() {
      drain(pushRecognitionEndEvent(runtime.queue))
    },
  }
}

const contar = (texto: string, aguja: string) => texto.toLowerCase().split(aguja.toLowerCase()).length - 1

describe('replay ultima sesion 2026-10-19 · una locucion NO se lleva a la siguiente', () => {
  it('dictado + locucion nueva: DOS filas limpias, sin texto cruzado ni repetido', () => {
    const h = createHarness()

    // Secuencia LITERAL de Chrome: `event.results` es ACUMULATIVO y `resultIndex` apunta
    // al primer resultado NUEVO (asi lo consume `collectRecognitionResultChunks`). Un
    // event con resultIndex=0 sobre results acumulados re-procesaria el final viejo como
    // NUEVO; produccion nunca lo hace (por eso asrRaw lista los finales previos: el log
    // mapea TODO `results`, pero el ingress solo consume desde resultIndex).
    h.result(chromeEvent([{ isFinal: false, transcript: DICTADO }], 0))
    h.result(chromeEvent([{ isFinal: true, transcript: DICTADO }], 0))
    h.result(
      chromeEvent(
        [
          { isFinal: true, transcript: DICTADO },
          { isFinal: false, transcript: COLA_INTERINA },
        ],
        1,
      ),
    )
    h.result(
      chromeEvent(
        [
          { isFinal: true, transcript: DICTADO },
          { isFinal: true, transcript: COLA_CIERRE },
        ],
        1,
      ),
    )
    // SILENCIO REAL: el cierre que el dueno midio a las 21:18:55.734.
    h.srGap(99999)

    expect(h.rows, 'filas=' + JSON.stringify(h.rows)).toHaveLength(2)
    const [filaDictado, filaCola] = h.rows

    // DEFECTO 1: la fila del dictado es SOLO el dictado.
    expect(filaDictado.toLowerCase()).toContain('bien vamos a iniciar')
    expect(
      filaDictado,
      'la fila del dictado se llevo la locucion SIGUIENTE: ' + JSON.stringify(filaDictado),
    ).not.toContain('voy a hacer un alto')

    // DEFECTO 4: la locucion siguiente queda UNA vez, en SU fila.
    expect(filaCola.toLowerCase()).toContain('voy a hacer un alto')
    expect(contar(h.rows.join(' '), 'voy a hacer un alto')).toBe(1)
    expect(contar(h.rows.join(' '), 'va buen ritmo y claro')).toBe(1)
    expect(
      h.rows.some((fila) => fila.toLowerCase().includes('bien vamos a iniciar') && fila.toLowerCase().includes('voy a hacer un alto')),
      'hay una fila que mezcla las dos locuciones: ' + JSON.stringify(h.rows),
    ).toBe(false)
  })

  it('la locucion confirmada NO se reconcilia con la linea viva de la siguiente', () => {
    // Falsificador DIRECTO del dueno unico: el contrato `locutionClosed` del commit.
    // Mismo escenario que la fila 430 medida: pendingFinal (315) + linea viva (430).
    const h = createHarness()
    const live = `${DICTADO} ${COLA_INTERINA}`
    ;(h.ctx.publishedLiveRef as { current: string }).current = live

    // La linea en vivo del ingress para las aserciones de caja.
    h.ctx.listenStateRef.current.pendingFinal = DICTADO

    handleConversationStreamSync(h.ctx, {
      capture: DICTADO,
      utterance: DICTADO,
      turnCommit: true,
      settlesTurn: true,
      locutionClosed: true,
    })

    expect(h.rows, 'filas=' + JSON.stringify(h.rows)).toHaveLength(1)
    expect(
      h.rows[0],
      'el commit reconcilio el texto CERRADO con la linea viva: ' + JSON.stringify(h.rows[0]),
    ).not.toContain('voy a hacer un alto')
  })
})

describe('replay ultima sesion 2026-10-19 · el COMANDO con wake inline conserva su texto', () => {
  it('resolveInlineWakeAtCommit NO corta una ORDEN en la wake (solo corta una cola flu)', () => {
    // Medido 21:20:48: "digo el comando ... Okay flu soy Luis" se recortaba al prefijo
    // pasivo (40 chars) y "soy Luis" se perdia de la fila y del comando.
    const medido = resolveInlineWakeAtCommit(
      'digo el comando para que le ponga nombre Okay flu soy Luis',
      '',
    )
    expect(
      medido.capture.toLowerCase(),
      'la orden se corto en la wake: ' + JSON.stringify(medido.capture),
    ).toContain('soy luis')
    expect(
      medido.capture.toLowerCase(),
      'la orden se corto en la wake: ' + JSON.stringify(medido.capture),
    ).toContain('nombre')
    // La wake sigue detectada (es la compuerta de accion, no de fila).
    expect(medido.wakeWordMatched).toBe(true)
  })
})
