// ============================================================
// vozReplayDueno20261019Caja - REPLAY del defecto 2 del dueno (2026-10-19)
// ------------------------------------------------------------
// DEFECTO REPORTADO: "la caja de la ultima frase tarda en limpiarse cuando la frase
// pasa a la conversacion y aparece una rafaga de conversacion que no se vio".
//
// DATOS: sesion preservada del dueno (`flu-session-20261019-102115.log`, 1.182.806
// bytes; asrRaw 1419, live 1360, clusters 103, commit 96). El log NO trae el audio ni
// los vectores: este replay reconstruye el ESCENARIO con la secuencia REAL de Chrome
// (interims que crecen, un FINAL, silencio y onend) y el estado de la caja medido en
// los eventos `commit` del log. Se declara HONESTO: no hay PCM en el log, no se
// simula embedding.
//
// HARNESS FIEL: el sink del ingress es el COMMIT real
// (`handleConversationStreamSync`), igual que en produccion
// (`useFluVoiceAssistant.js` -> `syncConversationStream`). La caja es la REAL
// (`crearCajaDeLaFrase`) con un scheduler manual que permite observar el debounce.
//
// QUE SE FIJA:
//   1. El vaciado por CIERRE (`settlesTurn`) es INMEDIATO y CANCELA el update
//      perezoso pendiente: un debounce programado antes del cierre NO puede repintar
//      la frase vieja (era el "tarda en limpiarse y reaparece texto").
//   2. Una locucion produce UNA fila; la reentrega del mismo final y un segundo
//      `onend` no anaden filas (la "rafaga" invisible).
//   3. Un cierre SIN captura (comando a mitad del dictado) tambien vacia la caja.
// ============================================================
import { describe, expect, it } from 'vitest'
import { createConversationIngressRuntime } from '../src/voice/lib/conversationIngressBridge.js'
import { pushMicSpeechEvent, pushRecognitionEndEvent } from '../src/voice/lib/micEventProducer.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import { crearCajaDeLaFrase, handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js'

function chromeEvent(specs: Array<{ isFinal?: boolean; transcript: string }>, resultIndex = 0) {
  const results = specs.map((s) => ({
    isFinal: Boolean(s.isFinal),
    0: { transcript: s.transcript, confidence: 0.9 },
    length: 1,
  }))
  return { resultIndex, results }
}

/** Frase del dictado del dueno (turno 56 del log preservado). */
const FRASE =
  'estoy probando la transcripcion y la diarizacion en esta sala con dos personas hablando'

function createHarness() {
  const rows: string[] = []
  // Turno con el que se EMITIO cada fila (evidencia de "una locucion, un turnId").
  const rowTurns: number[] = []
  const visible: string[] = []
  const publishedLiveRef = { current: '' }
  // Refs REALES del commit (produccion: useFluVoiceAssistant). Sin ellos el replay no
  // puede ver la ultima locucion COMMITEADA ni el id del turno, que son las dos entradas
  // del defecto medido: la caja se pela contra `lastLogLineTextRef` y la fila lleva
  // `activeTurnIdRef`.
  const lastLogLineTextRef = { current: '' }
  const activeTurnIdRef = { current: 0 }
  const lastOnresultAtRef = { current: 0 }
  let pendingLive: string | null = null
  let cancelaciones = 0
  const cajaDeLaFrase = crearCajaDeLaFrase({
    publishedLiveRef,
    cancelLiveTranscriptUpdate: () => {
      cancelaciones += 1
      pendingLive = null
    },
    // Debounce observable: NO se aplica solo; el test decide cuando "vence".
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
    lastLogLineTextRef,
    activeTurnIdRef,
    lastOnresultAtRef,
    lastEmittedTurnRef: { current: 0 },
    lastLoggedSpeakerRef: { current: 'Hablante 1' },
    lastSpeakerRef: { current: 'Hablante 1' },
    lastCommitAtRef: { current: 0 },
    lastCommitPerfAtRef: { current: 0 },
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
      cancelaciones += 1
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
    emitConversationLog: (texto: string) => {
      rows.push(texto)
      rowTurns.push(activeTurnIdRef.current)
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
  const drain = (pushed: unknown) => {
    if (pushed) runtime.drainAll()
  }
  return {
    runtime,
    rows,
    rowTurns,
    visible,
    publishedLiveRef,
    /** Ultima locucion COMMITEADA (entrada real de la regla de la caja). */
    lastLogLine: () => lastLogLineTextRef.current,
    /** Turno vivo del commit. */
    turnId: () => activeTurnIdRef.current,
    /** Ultimo valor que la UI mostraria en la caja. */
    lastVisible: () => visible[visible.length - 1] ?? '',
    /** Vence el debounce pendiente, como el temporizador real del hook. */
    flushPending() {
      if (pendingLive === null) return false
      visible.push(pendingLive)
      pendingLive = null
      return true
    },
    hasPending: () => pendingLive !== null,
    cancelaciones: () => cancelaciones,
    result(event: unknown) {
      // Produccion marca el instante de CADA resultado del ASR (dedupe del commit).
      lastOnresultAtRef.current = Date.now()
      drain(pushMicSpeechEvent(event as never, runtime.queue))
    },
    end() {
      drain(pushRecognitionEndEvent(runtime.queue))
    },
    /** Cierre directo por la API real del commit (cierre sin captura). */
    sync(payload: Record<string, unknown>) {
      return handleConversationStreamSync(ctx, payload)
    },
  }
}

// ============================================================
// REPLAY DEL TURNO NUMERICO (defecto 2 del reporte del dueno, turno 9 del log):
// Chrome entrega el dictado como DOS resultados: un prefijo estable y una cola que
// crece. La secuencia de abajo es LITERAL (`asrRaw` 17:28:36-17:28:48). El defecto
// medido: en la emision [prefijo "...1 2", cola " 3"] el pegado numerico convertia
// "1 2" + "3" en "1 2 3 23"; la cola volvia a entrar como solape y la caja llevaba
// "23 / 34 / 910" a la fila. Con el pegado retirado, la caja solo CRECE con digitos
// separados y la fila final es la emision limpia del ASR.
// ============================================================
const PREFIJO = 'hice un silencio largo también le puso Luis voy a contar'
const EMISIONES_NUMERICAS: Array<[string, string]> = [
  ['hice un silencio largo también le puso Luis', ' voy a contar'],
  ['hice un silencio largo también le puso Luis voy', ' a contar'],
  ['hice un silencio largo también le puso Luis voy a', ' contar'],
  ['hice un silencio largo también le puso Luis voy a', ' contar 1'],
  [PREFIJO, ' 1'],
  [PREFIJO, ' 1 2'],
  [PREFIJO, ' 1 2 3'],
  [`${PREFIJO} 1`, ' 2 3'],
  [`${PREFIJO} 1 2`, ' 3'],
  [`${PREFIJO} 1 2`, ' 3 4'],
  [`${PREFIJO} 1 2 3`, ' 4'],
  [`${PREFIJO} 1 2 3`, ' 4 5'],
  [`${PREFIJO} 1 2 3 4`, ' 5 6'],
  [`${PREFIJO} 1 2 3 4`, ' 5 6 7'],
  [`${PREFIJO} 1 2 3 4 5`, ' 6 7'],
  [`${PREFIJO} 1 2 3 4 5 6`, ' 7 8'],
  [`${PREFIJO} 1 2 3 4 5 6`, ' 7 8 9'],
  [`${PREFIJO} 1 2 3 4 5 6 7`, ' 8 9'],
  [`${PREFIJO} 1 2 3 4 5 6 7 8`, ' 9 10'],
  [`${PREFIJO} 1 2 3 4 5 6 7 8 9`, ' 10'],
]
const FRASE_NUMERICA_FINAL = `${PREFIJO} 1 2 3 4 5 6 7 8 9 10`

describe('replay 2026-10-19 · numeros del ASR: la caja no pega digitos', () => {
  it('la secuencia literal del turno 9 no produce "23", "34" ni "910" y la fila es la emision limpia', () => {
    const h = createHarness()
    let cajaVista = ''
    let vistos = 0

    // Emisiones INTERINAS del ASR, en el mismo orden que el log del dueno.
    for (const [prefijo, cola] of EMISIONES_NUMERICAS) {
      h.result(
        chromeEvent(
          [
            { isFinal: false, transcript: prefijo },
            { isFinal: false, transcript: cola },
          ],
          0,
        ),
      )
      if (h.flushPending()) vistos += 1
      const caja = h.lastVisible()
      if (caja) cajaVista = caja
      expect(caja, 'digitos pegados en la caja: ' + JSON.stringify(caja)).not.toMatch(/\b23\b|\b34\b|910/)
    }
    // NO VACUIDAD: la caja mostro el dictado real durante la secuencia.
    expect(vistos, 'la caja nunca se actualizo: el replay no ejercito la ruta').toBeGreaterThan(0)
    expect(cajaVista, 'la caja no llego a mostrar el dictado: ' + JSON.stringify(cajaVista)).toContain('voy a contar')

    // CIERRE REAL: Chrome entrega el FINAL con el dictado limpio y el turno termina.
    h.result(chromeEvent([{ isFinal: true, transcript: FRASE_NUMERICA_FINAL }], 0))
    h.end()
    h.flushPending()

    expect(h.rows, 'la locucion debe llegar UNA vez: ' + JSON.stringify(h.rows)).toHaveLength(1)
    const fila = h.rows[0]
    expect(fila, 'la fila no puede llevar digitos pegados: ' + JSON.stringify(fila)).not.toMatch(/\b23\b|\b34\b|910/)
    expect(fila, 'la fila perdio el conteo limpio: ' + JSON.stringify(fila)).toContain('1 2 3 4 5 6 7 8 9 10')
    // El reporte tambien traia el tramo REPETIDO ("... 9 10 4 5 6 7 8 910"): el conteo
    // completo debe aparecer UNA sola vez en la fila.
    const repeticiones = fila.split('1 2 3 4 5 6 7 8 9 10').length - 1
    expect(repeticiones, 'conteo repetido en la fila: ' + JSON.stringify(fila)).toBe(1)
    expect(fila, 'el tramo final volvio a entrar: ' + JSON.stringify(fila)).not.toMatch(/\b10 4\b/)
  })
})

describe('replay 2026-10-19 · caja de la ultima frase (defecto 2)', () => {
  it('el CIERRE vacia la caja al instante y CANCELA el debounce que repintaba la frase vieja', () => {
    const h = createHarness()
    // Chrome entrega el interim que crece: la caja programa su update perezoso.
    h.result(chromeEvent([{ isFinal: false, transcript: FRASE }], 0))
    expect(h.hasPending(), 'la caja debe tener un update programado mientras se dicta').toBe(true)
    // El debounce vence CON EL TURNO ABIERTO: la frase se ve (comportamiento normal).
    expect(h.flushPending()).toBe(true)
    expect(h.lastVisible()).toContain('estoy probando la transcripcion')

    // FINAL del segmento (Chrome cierra tramo, NO el turno).
    h.result(chromeEvent([{ isFinal: true, transcript: FRASE }], 0))
    // Otra reentrega identica del ASR vuelve a programar (el caso del log: revisiones).
    h.result(chromeEvent([{ isFinal: false, transcript: FRASE }], 0))

    // CIERRE REAL: la frase pasa a la conversacion.
    h.end()

    expect(h.rows, 'la locucion debe llegar UNA vez: ' + JSON.stringify(h.rows)).toHaveLength(1)
    // HECHO 1: el cierre es inmediato.
    expect(h.lastVisible(), 'la caja debe quedar VACIA al cerrar').toBe('')
    // HECHO 2: el debounce anterior ya no existe (nadie puede repintar).
    expect(h.hasPending(), 'un debounce anterior al cierre no puede quedar vivo').toBe(false)
    expect(h.cancelaciones(), 'el vaciado inmediato debe cancelar el debounce').toBeGreaterThan(0)
    // Y aunque el temporizador "venciera", no hay nada que escribir.
    expect(h.flushPending()).toBe(false)
    expect(h.lastVisible(), 'la frase vieja NO puede reaparecer en la caja').toBe('')
  })

  it('la rafaga invisible: reentrega del FINAL y un segundo onend NO anaden filas', () => {
    const h = createHarness()
    h.result(chromeEvent([{ isFinal: false, transcript: FRASE }], 0))
    h.result(chromeEvent([{ isFinal: true, transcript: FRASE }], 0))
    h.end()
    expect(h.rows, 'filas=' + JSON.stringify(h.rows)).toHaveLength(1)

    // Chrome reentrega el mismo final y el reconocedor vuelve a cerrar: la fila es UNA.
    h.result(chromeEvent([{ isFinal: true, transcript: FRASE }], 0))
    h.end()
    expect(h.rows, 'filas tras reentrega=' + JSON.stringify(h.rows)).toHaveLength(1)
    expect(h.lastVisible()).toBe('')
  })

  it('cierre SIN captura (un comando consumio la locucion a mitad del dictado) tambien vacia la caja', () => {
    const h = createHarness()
    // La caja ya muestra la locucion viva.
    h.result(chromeEvent([{ isFinal: false, transcript: FRASE }], 0))
    h.flushPending()
    expect(h.lastVisible()).toContain('estoy probando')

    // El cierre llega sin captura (el comando consumio el texto): el turno termino y
    // la caja visible pertenece a ese turno. Antes quedaba pintada para siempre.
    h.sync({ capture: '', turnCommit: true, settlesTurn: true })

    expect(h.lastVisible(), 'el cierre sin captura debe vaciar la caja visible').toBe('')
  })
})

// ============================================================
// REPLAY DEL TRAMO MEDIDO 2026-10-19 23:34:14-20 (sesion 18f3888c, seq 817-850):
// LA CAJA REPINTABA LA LOCUCION YA COMMITEADA Y LA SIGUIENTE INTERVENCION SE ACUMULABA.
// ------------------------------------------------------------
// Secuencia LITERAL de Chrome (dos items por evento, como los entrego el ASR):
//   14.070-15.450  dictado "no llegué mal me volvió a poner hablante dos que 2 ..."
//   15.456         FINAL del segmento (dos revisiones del mismo result)
//   16.660         Chrome re-entrega ESE final + arranca " o sea" (la siguiente intervencion)
//   16.976-19.894  " o sea está hecho una está hecho una mierda no sirves para nada Claudia"
//   20.749         FINAL de la segunda locucion (tres revisiones)
// Sondeos del dueno que fijan el defecto:
//   15.749 commit de SEGMENTO (sin cierre): la locucion queda como ultima linea commiteada
//          y la caja se vacia en memoria (`previo:0`).
//   16.673 `live {previo:0, len:77, motivo:"emision-actual"}`: la caja publicaba 77 =
//          71 YA COMMITEADOS + " o sea"; la intervencion siguiente crecia ENCIMA
//          (82/88/92/...) hasta que la frase genuina "o sea está hecho una mierda"
//          caia BLOQUEADA como `trozo`.
// ============================================================
const LOCUCION1_TRAMO: string[][] = [
  // Desde 23:34:12.848 (seq 807): el ASR construye "hablante dos" antes de revisarlo
  // a "2 que ...", y la emision publicada conserva AMBAS formas ("dos que 2"), que es
  // el texto EXACTO que el dueno midio commiteado a las 15.749.
  ['no llegué mal me volvió', ' a poner habla'],
  ['no llegué mal me volvió a', ' poner habla'],
  ['no llegué mal me volvió a poner', ' habla'],
  ['no llegué mal me volvió a poner', ' hablante'],
  ['no llegué mal me volvió a poner', ' hablante dos'],
  ['no llegué mal me volvió a poner hablante', ' dos'],
  ['no llegué mal me volvió a poner hablante', ' dos que'],
  ['no llegué mal me volvió a poner hablante', ' 2 que'],
  ['no llegué mal me volvió a poner hablante', ' 2 que es'],
  ['no llegué mal me volvió a poner hablante', ' 2 que es el'],
  ['no llegué mal me volvió a poner hablante', ' 2 que es el de'],
  ['no llegué mal me volvió a poner hablante', ' 2 que es el de la'],
  ['no llegué mal me volvió a poner hablante', ' 2 que es el de la mujer'],
  ['no llegué mal me volvió a poner hablante 2 que', ' es el de la mujer'],
  ['no llegué mal me volvió a poner hablante 2 que es', ' el de la mujer'],
  ['no llegué mal me volvió a poner hablante 2 que es el', ' de la mujer'],
  ['no llegué mal me volvió a poner hablante 2 que es el de', ' la mujer'],
  ['no llegué mal me volvió a poner hablante 2 que es el de la', ' mujer'],
]
const FINAL1 = [
  'no llegué mal me volvió a poner hablante 2 que es el de la mujer',
  'no llegué mal me volvió a poner hablante dos que es el de la mujer',
]
const REENTREGA_FINAL1 = 'no llegué mal me volvió a poner hablante 2 que es el de la mujer'
const LOCUCION2_TRAMO: string[][] = [
  [' o sea está'],
  [' o sea está hecho'],
  [' o sea', ' está hecho'],
  [' o sea está', ' hecho'],
  [' o sea está', ' hecho una'],
  [' o sea está hecho', ' una está'],
  [' o sea está hecho', ' una está hecho'],
  [' o sea está hecho', ' una está hecho una'],
  [' o sea está hecho', ' una está hecho una mierda'],
  [' o sea está hecho una', ' está hecho una mierda'],
  [' o sea está hecho una está', ' hecho una mierda'],
  [' o sea está hecho una está hecho', ' una mierda'],
  [' o sea está hecho una está hecho una', ' mierda'],
  [' o sea está hecho una está hecho una mierda', ' no'],
  [' o sea está hecho una está hecho una mierda', ' no sirves'],
  [' o sea está hecho una está hecho una mierda', ' no sirves para'],
  [' o sea está hecho una está hecho una mierda', ' no sirves para nada'],
  [' o sea está hecho una está hecho una mierda no', ' sirves para nada'],
  [' o sea está hecho una está hecho una mierda no sirves', ' para nada'],
  [' o sea está hecho una está hecho una mierda no sirves', ' para nada cla'],
  [' o sea está hecho una está hecho una mierda no sirves para', ' nada cla'],
  [' o sea está hecho una está hecho una mierda no sirves para', ' nada Clau'],
  [' o sea está hecho una está hecho una mierda no sirves para nada', ' Claudia'],
]
const FINAL2 = [
  ' o sea está hecho una está hecho una mierda no sirves para nada Claudia',
  ' o sea está hecho una está hecha una mierda no sirves para nada Claudia',
  ' o sea está hecho una está hecho una mierda no sirves para nada Claudio',
]
// Texto COMMITEADO de la segunda locucion medido en la sesion 18f3888c
// (`commit` de 23:34:21.092, len=55): el ASR repitio "está hecho una" en la caja y el
// commit reconcilia la locucion limpia. El nombre final es una alternativa del ASR
// ("Claudia"/"Claudio"); lo que fija el replay es el CUERPO de la locucion.
const LOCUCION2 = 'o sea está hecho una mierda no sirves para nada'

describe('replay 2026-10-19 · la caja no repinta la locucion YA commiteada (sesion 18f3888c)', () => {
  it('tras el commit del segmento solo publica la cola nueva y la intervencion siguiente no acumula la anterior', () => {
    const h = createHarness()

    // Tramo 1: Chrome dicta la locucion. La caja la muestra VIVA (comportamiento normal).
    for (const items of LOCUCION1_TRAMO) {
      h.result(chromeEvent(items.map((transcript) => ({ transcript })), 0))
      h.flushPending()
    }
    expect(h.lastVisible(), 'la caja debe mostrar el dictado vivo').toContain('no llegué mal')

    // FINAL del segmento: Chrome confirma la locucion y el commit la sella como ultima
    // linea commiteada SIN cerrar el turno (no escribe fila todavia).
    h.result(
      chromeEvent(
        FINAL1.map((transcript) => ({ isFinal: true, transcript })),
        0,
      ),
    )
    h.flushPending()
    // NO VACUIDAD: el commit del segmento corrio y dejo la locucion como ultima linea.
    expect(h.lastLogLine(), 'el commit de segmento no dejo la locucion commiteada').toContain(
      'no llegué mal',
    )
    expect(h.rows, 'un final de SEGMENTO no escribe fila: ' + JSON.stringify(h.rows)).toHaveLength(0)

    const visibleAntes = h.visible.length

    // 16.660: Chrome re-entrega el final YA commiteado y arranca la intervencion siguiente.
    // ANTES (medido): la caja publicaba 77 = 71 ya commiteados + " o sea".
    h.result(
      chromeEvent(
        [
          { isFinal: true, transcript: REENTREGA_FINAL1 },
          { isFinal: false, transcript: ' o sea' },
        ],
        0,
      ),
    )
    h.flushPending()
    const cajaTrasReentrega = h.lastVisible()
    expect(
      cajaTrasReentrega,
      'la caja repitio la locucion ya commiteada: ' + JSON.stringify(cajaTrasReentrega),
    ).not.toContain('no llegué')
    expect(cajaTrasReentrega, 'la caja no puede volver a mostrar el nombre de la locucion anterior').not.toContain(
      'hablante',
    )
    expect(
      cajaTrasReentrega.toLowerCase(),
      'la caja debe mostrar SOLO la cola nueva ("o sea"): ' + JSON.stringify(cajaTrasReentrega),
    ).toContain('o sea')

    // Tramo 2: la intervencion siguiente crece. La caja NUNCA vuelve a la anterior.
    for (const items of LOCUCION2_TRAMO) {
      h.result(chromeEvent(items.map((transcript) => ({ transcript })), 0))
      h.flushPending()
    }
    const visiblesTrasCommit = h.visible.slice(visibleAntes)
    for (const visto of visiblesTrasCommit) {
      expect(visto, 'la caja acumulo la locucion anterior: ' + JSON.stringify(visto)).not.toContain(
        'no llegué',
      )
      expect(visto, 'la caja acumulo la locucion anterior: ' + JSON.stringify(visto)).not.toContain(
        'hablante',
      )
    }
    expect(h.lastVisible(), 'la caja no llego a la intervencion nueva').toContain('no sirves para nada')

    // FINAL de la segunda locucion: antes caia BLOQUEADO como `trozo` porque la caja
    // llevaba encima la locucion commiteada. Ahora entra completo.
    h.result(
      chromeEvent(
        FINAL2.map((transcript) => ({ isFinal: true, transcript })),
        0,
      ),
    )
    h.end()
    h.flushPending()

    // Una locucion = una fila: la primera se vuelca al llegar la segunda (spill) y la
    // segunda se sella en el cierre real (onend). Dos filas, cada una con SU texto.
    expect(h.rows, 'filas=' + JSON.stringify(h.rows)).toHaveLength(2)
    expect(h.rows[0], 'fila 1=' + JSON.stringify(h.rows[0])).toContain('no llegué mal')
    expect(h.rows[1], 'fila 2=' + JSON.stringify(h.rows[1])).toContain(LOCUCION2)
    expect(h.rows[1], 'la fila 2 no puede llevar la locucion anterior').not.toContain('no llegué')
    // Cada locucion se emitio con SU turno (no se reutilizo el id de la anterior).
    expect(h.rowTurns[0], 'turnos de fila=' + JSON.stringify(h.rowTurns)).not.toBe(h.rowTurns[1])
    // La caja termino vacia al pasar la locucion a la conversacion.
    expect(h.lastVisible(), 'la caja debe quedar vacia tras el cierre').toBe('')
  })
})
