// ============================================================
// vozUnCommitPorTurnoGuard - B5: cada locucion real => EXACTAMENTE 1 fila.
// ------------------------------------------------------------
// MEDIDO (2026-10-10) con el ARNES REAL del stream (`handleConversationStreamSync` con los
// colaboradores reales: wouldShrinkListenLog, reconcileCommitText, resolveMicCommitAction,
// isDuplicateTurnCommit, resolveInlineWakeAtCommit, resolveTurnSpeakerAtCommit): la
// locucion NO se commitea dos veces (el id del turno se acuna por locucion y la fila la
// escribe el dueno unico `commitUserTurnRow`, que reutiliza la fila por identidad de turno),
// y dos locuciones DISTINTAS si son dos filas. Propiedad YA correcta: este guard la FIJA
// end-to-end para que ninguna ruta nueva vuelva a duplicar el commit (no se inventa un
// defecto: ver el reporte).
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const requireWakeAlwaysBefore = FLU_CONFIG.voiceCommands.requireWakeAlways
beforeEach(() => {
  FLU_CONFIG.voiceCommands.requireWakeAlways = false
})
afterEach(() => {
  FLU_CONFIG.voiceCommands.requireWakeAlways = requireWakeAlwaysBefore
})

/** Arnes minimo (mismo contrato que el de conversationStreamCommit.test.ts). */
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
    emitConversationLog: vi.fn(() => true),
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
    isTurnLive: () => false,
    lastRequestRef: { current: { text: '', at: 0 } },
    fluParticipantRef: { current: { onTurnCommitted: vi.fn() } },
  }
  Object.assign(deps, over)
  return deps
}

const LOCUCION = 'vamos a comer del plato'
const OTRA = 'pon la alarma para las ocho'

describe('B5 - cada locucion real produce EXACTAMENTE una fila', () => {
  it('la MISMA locucion (preview + commit + re-entrega) escribe UNA fila', () => {
    const deps = makeDeps()
    handleConversationStreamSync(deps as never, { capture: LOCUCION })
    handleConversationStreamSync(deps as never, { capture: LOCUCION, turnCommit: true, settlesTurn: true })
    expect(deps.emitConversationLog).toHaveBeenCalledTimes(1)

    // Re-entrega del MISMO turno (doble onend): no hay habla nueva -> no hay fila nueva.
    deps.lastCommitAtRef.current = 1000
    deps.lastOnresultAtRef.current = 900
    handleConversationStreamSync(deps as never, { capture: LOCUCION, turnCommit: true, settlesTurn: true })
    expect(deps.emitConversationLog, 'la re-entrega no duplica la fila').toHaveBeenCalledTimes(1)
  })

  it('dos locuciones DISTINTAS son dos filas', () => {
    const deps = makeDeps()
    handleConversationStreamSync(deps as never, { capture: LOCUCION, turnCommit: true, settlesTurn: true })
    deps.lastOnresultAtRef.current = 2000
    deps.lastCommitAtRef.current = 1000
    deps.lastEmittedTranscriptRef.current = ''
    handleConversationStreamSync(deps as never, { capture: OTRA, turnCommit: true, settlesTurn: true })
    expect(deps.emitConversationLog).toHaveBeenCalledTimes(2)
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): el arnes VE el commit', () => {
    const deps = makeDeps()
    const vacio = makeDeps({ conversationActiveRef: { current: false } })
    handleConversationStreamSync(vacio as never, { capture: LOCUCION, turnCommit: true, settlesTurn: true })
    expect(vacio.emitConversationLog, 'sin conversacion activa no hay commit').toHaveBeenCalledTimes(0)
    handleConversationStreamSync(deps as never, { capture: LOCUCION, turnCommit: true, settlesTurn: true })
    expect(deps.emitConversationLog).toHaveBeenCalledTimes(1)
  })
})
