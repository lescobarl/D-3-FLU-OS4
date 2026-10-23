// ============================================================
// vozUnaFilaPorLocucionConWakeGuard - P9.67: una locucion con wake es UNA fila.
// ------------------------------------------------------------
// MEDIDO en el log del dueno (sesion 02:20-02:42, lineas 668-675), datos CRUDOS:
//   row {action:"added", text:"voy a decir el comando Okay flu Soy Luis", turnId:12}
//   commit {src:"asr-revision", turn:13, replace:true, capture:"voy a decir el comando"}
//   row {action:"added", text:"voy a decir el comando", turnId:13}
// DOS filas para UNA locucion, y la 2.a es el RECORTE de la 1.a.
//
// CAUSA MEDIDA: la accion de fila ya estaba decidida (`replaceLast: true` = "esta emision
// reemplaza la ultima"), pero el dueno de la fila la DESOBEDECIA cuando la respuesta de FLU
// quedaba ENTRE las dos emisiones: su rama de reemplazo busca la fila "del turno actual"
// (posterior al ultimo mensaje de FLU) y el id del turno habia cambiado -> AGREGABA.
//
// REGLA: la respuesta de FLU no puede derrotar una accion ya decidida. Si el texto que llega
// es un TROZO contiguo de la locucion YA escrita (o al reves), la fila se REUTILIZA (gana la
// completa). El criterio de "trozo contiguo" tiene UN dueno (`isFragmentOfLocution`).
// ============================================================
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import { resetTurnSpeakerPreflights } from '../src/voice/lib/turnSpeakerPreflight.js'
import { isFragmentOfLocution, isDuplicateTurnCommit } from '../src/voice/lib/turnStream.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow } from '../src/voice/lib/conversationTurnRow'

/** Los DOS textos CRUDOS del log del dueno (fila turnId=12 y commit turn=13). */
const LOCUCION_LOGROW = 'voy a decir el comando Okay flu Soy Luis'
const LOCUCION_RECORTE = 'voy a decir el comando'

function makeDeps(over: Record<string, unknown> = {}) {
  const deps = {
    conversationActiveRef: { current: true },
    publishedLiveRef: { current: '' },
    listenStateRef: { current: createActiveListenState() },
    openPreviewTurnRef: { current: false },
    setLiveTranscript: vi.fn(),
    scheduleLiveTranscriptUpdate: vi.fn(),
    applyConversationSpeaker: vi.fn(),
    flushPendingStreamLog: vi.fn(),
    logRowsTextRef: { current: [] as string[] },
    activeTurnIdRef: { current: 0 },
    flushPcmAfterTurnCommit: vi.fn(),
    lastCommitAtRef: { current: 0 },
    lastOnresultAtRef: { current: 0 },
    turnAudioStartSampleRef: { current: 0 },
    chunkTotalSamplesRef: { current: 0 },
    preflightScheduledForTurnRef: { current: true },
    srGapFiredForOpenLineRef: { current: true },
    processConversationFluQueryRef: { current: vi.fn() },
    lastEmittedTranscriptRef: { current: '' },
    // ESCRITOR REAL de la fila (el dueno unico de la conversacion).
    emitConversationLog: (text: string, options?: object) => {
      const o = (options || {}) as { speakerName?: string; replaceLastRawLog?: boolean }
      commitUserTurnRow({
        text,
        speakerName: o.speakerName,
        replaceLast: o.replaceLastRawLog === true,
        turnId: deps.activeTurnIdRef.current,
      } as never)
      return true
    },
    createSpeakerAudioResolver: vi.fn(() => () => Promise.resolve({ speakerName: 'Hablante 1' })),
    sessionPrimarySpeakerRef: { current: '' },
    lastLoggedSpeakerRef: { current: '' },
    logRowSpeakersRef: { current: [] as string[] },
    speakerClustersRef: { current: [] as object[] },
    setSpeakerClusters: vi.fn(),
    lastSpeakerRef: { current: '' },
    lastTurnSignatureRef: { current: null as number[] | null },
    lastLogLineTextRef: { current: '' },
    commitTurnToSessionRows: vi.fn(),
    lastRequestRef: { current: { text: '', at: 0 } },
    fluParticipantRef: { current: { onTurnCommitted: vi.fn() } },
  }
  Object.assign(deps, over)
  return deps
}

const filasTexto = () =>
  useIntegrationStore
    .getState()
    .conversationHistory.filter((e) => e.role === 'user')
    .map((e) => String(e.text || ''))

/** Siembra la locucion ya escrita (como la dejo su commit) y deja el id del turno vivo. */
function sembrarLocucion(deps: ReturnType<typeof makeDeps>, texto: string, turnId: number) {
  deps.activeTurnIdRef.current = turnId
  commitUserTurnRow({ text: texto, speakerName: 'Hablante 1', turnId } as never)
  deps.logRowsTextRef.current = [...filasTexto()]
  useIntegrationStore.setState({
    conversationHistory: [...useIntegrationStore.getState().conversationHistory, filaDeFlu('Ok.')] as never,
  })
}

const filaDeFlu = (texto: string) => ({
  id: `flu-${texto.slice(0, 6)}`,
  role: 'flu',
  text: texto,
  timestamp: '10:00',
})

describe('P9.67 - una locucion con wake produce UNA fila', () => {
  beforeEach(() => {
    FLU_CONFIG.voiceCommands.requireWakeAlways = false
    useIntegrationStore.setState({ conversationHistory: [] })
    resetTurnSpeakerPreflights()
  })
  afterEach(() => {
    resetTurnSpeakerPreflights()
  })

  it('la MISMA locucion re-entregada por el ASR (doble final < ventana de eco) NO produce 2 commits ni 2 filas', () => {
    // MEDIDO (log en vivo 2026-10-11 12:55-12:57): cada locucion se commiteaba DOS veces, con
    // turn N y N+1 separados 0,3-0,7 s, mismo texto y misma fila. CAUSA: el `final` re-entregado
    // actualiza `lastOnresultAt`, y el dedupe exigia `lastResultAt <= lastCommitAt`, asi que la
    // segunda entrega se tomaba por habla nueva. FUERA de la ventana de eco la repeticion es
    // genuina del usuario y SI cuenta como turno nuevo.
    const deps = makeDeps()
    let commits = 0
    const real = deps.emitConversationLog
    deps.emitConversationLog = ((text: string, options?: object) => {
      commits += 1
      return (real as (t: string, o?: object) => boolean)(text, options)
    }) as typeof deps.emitConversationLog

    handleConversationStreamSync(deps as never, { capture: LOCUCION_LOGROW, turnCommit: true, settlesTurn: true })
    const filas = filasTexto().length
    expect(commits, 'el primer final commitea').toBe(1)

    // Chrome re-entrega el MISMO final 300 ms despues (onresult "nuevo", mismo texto).
    deps.lastOnresultAtRef.current = Date.now() + 300
    handleConversationStreamSync(deps as never, { capture: LOCUCION_LOGROW, turnCommit: true, settlesTurn: true })
    expect(commits, 'UNA locucion = UN commit').toBe(1)
    expect(filasTexto().length, 'UNA locucion = UNA fila').toBe(filas)
  })

  it('la resolucion TARDIA de una frase ya emitida escribe SU turno (no el vivo)', () => {
    // MEDIDO (log 2026-10-11 13:35:11.652): una fila con el texto VIEJO nacio bajo un turnId
    // NUEVO (la resolucion de la IA de un turno anterior llegaba DESPUES de que el turno vivo
    // avanzara) -> DOS filas de la misma locucion a 0,8 s. El turno de la fila es el de la FRASE.
    const HOOK = readFileSync('src/voice/hooks/useFluVoiceAssistant.js', 'utf8')
    const STREAM = readFileSync('src/voice/lib/conversationStreamCommit.js', 'utf8')
    expect(HOOK, 'el embudo tiene que derivar el turno de la frase').toContain('const turnIdDeLaFrase')
    expect(HOOK, 'y usarlo en el aviso del contrato').toContain('turnId: turnIdDeLaFrase')
    expect(HOOK, 'la derivacion compara la frase con la ULTIMA EMITIDA').toContain('canonicalPhrase === lastEmittedTranscriptRef.current')
    expect(STREAM, 'y el commit del stream sella el turno de la frase emitida').toContain('lastEmittedTurnRef.current = activeTurnIdRef.current')
  })

  it('el dueno de la dedupe: el doble final es el mismo evento; fuera de la ventana es repeticion', () => {
    // DUENO UNICO: `isDuplicateTurnCommit`. Dentro de la ventana de eco, un "resultado nuevo" con
    // el MISMO texto es el MISMO evento (doble final); fuera, es una repeticion genuina del dueno.
    const ahora = Date.now()
    const base = {
      lastEmitted: LOCUCION_LOGROW,
      lastCommitted: LOCUCION_LOGROW,
      lastCommitAt: ahora - 300,
      lastResultAt: ahora - 100,
      now: ahora,
      echoWindowMs: 1200,
    }
    expect(isDuplicateTurnCommit(LOCUCION_LOGROW, base), 'dentro de la ventana: mismo evento').toBe(true)
    expect(
      isDuplicateTurnCommit(LOCUCION_LOGROW, { ...base, lastCommitAt: ahora - 5000 }),
      'fuera de la ventana: repeticion genuina',
    ).toBe(false)
    expect(
      isDuplicateTurnCommit('otra locucion distinta', base),
      'texto distinto: no es duplicado',
    ).toBe(false)
  })

  it('la locucion del log: el recorte posterior NO agrega una segunda fila', () => {
    const deps = makeDeps()
    // (1) La locucion completa, como la dejo la ruta cruda del log (fila turnId=12).
    sembrarLocucion(deps, LOCUCION_LOGROW, 12)
    // (3) La MISMA locucion vuelve RECORTADA por la wake (asr-revision, replace:true) 1,2 s
    //     despues. La accion de fila YA decidio reemplazar (`lastEmitted` = la completa).
    deps.lastEmittedTranscriptRef.current = LOCUCION_LOGROW
    deps.lastOnresultAtRef.current = 2000
    handleConversationStreamSync(deps as never, {
      capture: LOCUCION_RECORTE,
      turnCommit: true,
      settlesTurn: true,
    })

    expect(filasTexto(), 'UNA locucion = UNA fila, y gana la COMPLETA').toEqual([LOCUCION_LOGROW])
  })

  it('la repeticion REAL de la misma frase (resultado nuevo) sigue siendo DOS filas', () => {
    const deps = makeDeps()
    sembrarLocucion(deps, 'hola a todos', 7)
    deps.lastCommitAtRef.current = 1000
    deps.lastOnresultAtRef.current = 5000
    deps.lastEmittedTranscriptRef.current = ''
    handleConversationStreamSync(deps as never, { capture: 'hola a todos', turnCommit: true, settlesTurn: true })
    expect(filasTexto(), 'una repeticion no se funde con la anterior').toEqual([
      'hola a todos',
      'hola a todos',
    ])
  })

  it('dos locuciones DISTINTAS siguen siendo DOS filas', () => {
    const deps = makeDeps()
    sembrarLocucion(deps, 'pon la alarma', 7)
    deps.lastCommitAtRef.current = 1000
    deps.lastOnresultAtRef.current = 5000
    deps.lastEmittedTranscriptRef.current = ''
    handleConversationStreamSync(deps as never, { capture: 'apaga la luz', turnCommit: true, settlesTurn: true })
    expect(filasTexto()).toEqual(['pon la alarma', 'apaga la luz'])
  })

  it('el trozo va en LOS DOS sentidos: la completa sobre una recortada funde en UNA (dueno de la fila)', () => {
    // Se mide en el DUENO de la fila: por el stream, la wake INLINE recorta el mandato y
    // este sentido no es alcanzable desde ahi (el log lo dejo por la ruta cruda).
    commitUserTurnRow({ text: LOCUCION_RECORTE, speakerName: 'Hablante 1', turnId: 20 } as never)
    useIntegrationStore.setState({
      conversationHistory: [...useIntegrationStore.getState().conversationHistory, filaDeFlu('Ok.')] as never,
    })
    commitUserTurnRow({ text: LOCUCION_LOGROW, speakerName: 'Hablante 1', replaceLast: true, turnId: 21 } as never)
    expect(filasTexto(), 'una sola fila, con el texto COMPLETO').toEqual([LOCUCION_LOGROW])
  })

  it('control NEGATIVO (el detector no es decorativo): el trozo contiguo discrimina', () => {
    // El criterio del dueno unico: un trozo CONTIGUO si; un texto distinto no.
    expect(isFragmentOfLocution(LOCUCION_RECORTE, LOCUCION_LOGROW)).toBe(true)
    expect(isFragmentOfLocution(LOCUCION_LOGROW, LOCUCION_RECORTE)).toBe(false)
    expect(isFragmentOfLocution('apaga la luz', LOCUCION_LOGROW)).toBe(false)
    // Y con un texto que NO es trozo la fila NO se reutiliza (se agrega).
    const deps = makeDeps()
    sembrarLocucion(deps, LOCUCION_LOGROW, 30)
    deps.lastEmittedTranscriptRef.current = LOCUCION_LOGROW
    handleConversationStreamSync(deps as never, {
      capture: 'apaga la luz del salon',
      turnCommit: true,
      settlesTurn: true,
    })
    expect(filasTexto()).toHaveLength(2)
  })
})

// ============================================================
// P11.20 — REVISION del ASR: la cola re-oida con otra palabra sigue siendo la misma
// locucion. MEDIDO en su log (2026-10-19 21:18/21:19): Chrome reentrego la cola como
// SEGMENTO nuevo y la contiguidad EXACTA ya no la reconocia -> DOS filas por locucion
// (430+112 y 468+270). Los cuatro textos son los CRUDOS de `VozProbe row` del log.
// ============================================================
const LOCUCION_A_LOGROW = 'bien Vamos a iniciar con las pruebas de transcripción y viarización es bien importante que le demos seguimiento a este log vamos a voy a ir narrando aquí para no estar escribiendo tanto allá de aquel lado pero aquí voy narrando lo que voy viendo y hasta ahorita está transcribiendo bastante bien va buen ritmo y claro voy a hacer un alto para para que tenga un silencio y haga la transcripción vamos a ver con qué hablante lo pone'
const LOCUCION_A_REVISION = 'voy a hacer un alto para para que tenga un silencio y haga la transcripción vamos a ver con qué habla te lo pone'
const LOCUCION_B_LOGROW = 'ya empezamos con problemas está duplicando un pedazo de la frase revísalo primer problema el segundo problema Bueno la lo duplicó pero también lo pasó a la conversación o sea está doble también la conversación primer problema del que que no reconoció desde el principio mi voz entendería que está limpia la base es probable que así suceda si es así ahorita lo vamos a detectar y le ponemos el nombre al hablante uno para que sea yo vamos a hacer otro espacio de tiempo'
const LOCUCION_B_REVISION = 'primer problema el segundo problema que no reconoció desde el principio mi voz entendería que está limpia la base es probable que así suceda si es así ahorita lo vamos a detectar y le ponemos el nombre al hablante uno para que sea yo vamos a hacer otro espacio de tiempo'

describe('P11.20 — revision del ASR (cola re-oida con variacion)', () => {
  it('las dos colas medidas se reconocen como la MISMA locucion', () => {
    expect(isFragmentOfLocution(LOCUCION_A_REVISION, LOCUCION_A_LOGROW)).toBe(true)
    expect(isFragmentOfLocution(LOCUCION_B_REVISION, LOCUCION_B_LOGROW)).toBe(true)
  })

  it('CONTROL NEGATIVO: una frase nueva no se declara revision', () => {
    // Mismo lexico y mismo orden que la locucion, pero NO contiguo: sigue siendo nueva.
    expect(isFragmentOfLocution('comer plato', 'vamos a comer del plato')).toBe(false)
    // Frase larga, mismo lexico, pero sin un tramo CONTIGUO que cubra el 80%.
    expect(isFragmentOfLocution('vamos a hacer otro espacio de tiempo para detectar el problema de la base', LOCUCION_B_LOGROW)).toBe(false)
    expect(isFragmentOfLocution(LOCUCION_A_LOGROW, LOCUCION_A_REVISION)).toBe(false)
    // Trozo CORTO y NO contiguo: no alcanza el minimo de compactos de la revision
    // (la via EXACTA no cambia: un trozo corto contiguo de verdad sigue siendo trozo).
    expect(isFragmentOfLocution('espacio de otro tiempo', LOCUCION_B_LOGROW)).toBe(false)
  })

  it('el commit de la cola re-oida no abre fila nueva (dueno del dedupe)', () => {
    // DENTRO de la ventana de eco: la reemision es el MISMO evento (una sola fila).
    const now = 18800
    expect(isDuplicateTurnCommit(LOCUCION_A_REVISION, {
      lastEmitted: LOCUCION_A_LOGROW,
      lastCommitted: LOCUCION_A_LOGROW,
      lastResultAt: 18600,
      lastCommitAt: 18000,
      now,
      echoWindowMs: 1200,
    })).toBe(true)
    expect(isDuplicateTurnCommit(LOCUCION_B_REVISION, {
      lastEmitted: LOCUCION_B_LOGROW,
      lastCommitted: LOCUCION_B_LOGROW,
      lastResultAt: 18600,
      lastCommitAt: 18000,
      now,
      echoWindowMs: 1200,
    })).toBe(true)
  })

  it('PASADA la ventana de eco, la misma cola es habla nueva (auditoria 2026-10-23)', () => {
    expect(isDuplicateTurnCommit(LOCUCION_A_REVISION, {
      lastEmitted: LOCUCION_A_LOGROW,
      lastCommitted: LOCUCION_A_LOGROW,
      lastResultAt: 23000,
      lastCommitAt: 18000,
      now: 23100,
      echoWindowMs: 1200,
    })).toBe(false)
  })
})
