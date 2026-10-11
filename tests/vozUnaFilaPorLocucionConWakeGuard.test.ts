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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import { resetTurnSpeakerPreflights } from '../src/voice/lib/turnSpeakerPreflight.js'
import { isFragmentOfLocution } from '../src/voice/lib/turnStream.js'
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
