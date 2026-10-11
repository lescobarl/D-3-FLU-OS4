// ============================================================
// vozPreflightAntesCommitGuard - pendiente #1: EL PREFLIGHT VA ANTES DEL COMMIT.
// ------------------------------------------------------------
// MEDIDO (2026-10-10, prueba de escritorio con los modulos REALES): el commit es
// SINCRONO y la instantanea FINAL de identidad (embedding del worker) viaja por la
// cola asincrona, asi que el commit SIEMPRE perdia la carrera: la fila se escribia
// `speakerName:"" , evidenciaAcustica:false` aunque el resolver tuviera la etiqueta
// 60 ms despues (`preReady=false`). Con la espera ACOTADA antes del commit
// (`primeTurnSpeakerPreflight`) la fila NACE con el hablante del turno.
//
// REGLA: el commit CONSUME la instantanea final ya resuelta; el dueño de arrancarla y
// esperarla es `primeTurnSpeakerPreflight` (turnIdentityPipeline), consumido por el
// cierre del turno. La cola NO se puede bloquear: si el resolver no llega en plazo,
// el commit escribe igual (con la resolucion tardia habitual).
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildFinalSpeakerSnapshotResolver,
  handleConversationStreamSync,
} from '../src/voice/lib/conversationStreamCommit.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import {
  primeTurnSpeakerPreflight,
  resetTurnIdentityPipeline,
} from '../src/voice/lib/turnIdentityPipeline.js'
import { resetSpeakerIdentityQueue } from '../src/voice/lib/voiceIdentityQueue.js'

const requireWakeAlwaysBefore = FLU_CONFIG.voiceCommands.requireWakeAlways

/** Resolver real de la instantanea final: devuelve la etiqueta del turno. */
function resolverHablante2() {
  return () =>
    Promise.resolve({
      speakerId: 'spk-2',
      speakerName: 'Hablante 2',
      signatureVector: [1, 0, 0],
      workingClusters: [{ label: 'Hablante 2', signature: [1, 0, 0] }],
    })
}

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
    activeTurnIdRef: { current: 7 },
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
    createSpeakerAudioResolver: vi.fn(() => resolverHablante2()),
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
    participantSpeakerRef: { current: { registeredLabel: '', registeredName: '' } },
  }
  Object.assign(deps, over)
  return deps
}

/** La fila emitida por el commit (texto, opciones). */
function filaEmitida(deps: ReturnType<typeof makeDeps>) {
  const call = (deps.emitConversationLog as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
  return (call?.[1] || {}) as { speakerName?: string; evidenciaAcustica?: boolean }
}

const LOCUCION = 'tambien venden peperos y papas coreanas'

describe('preflight antes del commit: la fila nace con el hablante del turno', () => {
  beforeEach(() => {
    FLU_CONFIG.voiceCommands.requireWakeAlways = false
    resetTurnIdentityPipeline()
    resetSpeakerIdentityQueue()
  })
  afterEach(() => {
    FLU_CONFIG.voiceCommands.requireWakeAlways = requireWakeAlwaysBefore
    resetTurnIdentityPipeline()
    resetSpeakerIdentityQueue()
  })

  it('(util) con la espera del preflight, la fila lleva la ETIQUETA y su evidencia', async () => {
    const deps = makeDeps({ activeTurnIdRef: { current: 100 } })
    // El id del turno se acuna al ABRIR la locucion (preview), no en el commit: la
    // espera debe usar ESE id, como hace el hook.
    handleConversationStreamSync(deps as never, { capture: LOCUCION })
    const turnId = deps.activeTurnIdRef.current
    expect(turnId).toBeGreaterThan(7)
    const primed = await primeTurnSpeakerPreflight(
      turnId,
      buildFinalSpeakerSnapshotResolver({
        createSpeakerAudioResolver: deps.createSpeakerAudioResolver,
        phrase: LOCUCION,
        turnId,
      }),
      { onClusters: deps.setSpeakerClusters, onResolved: deps.applyConversationSpeaker },
    )
    expect(primed?.ready, 'la instantanea final resuelve dentro del plazo').toBe(true)
    handleConversationStreamSync(deps as never, { capture: LOCUCION, turnCommit: true, settlesTurn: true })
    const fila = filaEmitida(deps)
    expect(fila.speakerName, 'la fila nace con el hablante del turno').toBe('Hablante 2')
    expect(fila.evidenciaAcustica, 'y con evidencia acustica declarada').toBe(true)
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): sin la espera el commit NO tiene evidencia acustica', () => {
    const deps = makeDeps({ activeTurnIdRef: { current: 200 } })
    handleConversationStreamSync(deps as never, { capture: LOCUCION })
    handleConversationStreamSync(deps as never, { capture: LOCUCION, turnCommit: true, settlesTurn: true })
    const fila = filaEmitida(deps)
    // A5 corregida: la ETIQUETA viaja SIEMPRE (nunca ''); lo que la espera aporta es la
    // EVIDENCIA acustica, que es la unica que decide el ascenso a nombre propio.
    expect(fila.speakerName, 'la etiqueta viaja igual (nunca vacia)').not.toBe('')
    expect(fila.evidenciaAcustica, 'sin la espera no hay ventana de audio medida del turno').toBe(false)
    expect(fila.speakerName, 'y NO es la etiqueta que resuelve el preflight').not.toBe('Hablante 2')
  })

  it('la espera NO bloquea: si el resolver no llega en plazo, el commit escribe igual', async () => {
    const deps = makeDeps({
      activeTurnIdRef: { current: 300 },
      createSpeakerAudioResolver: vi.fn(() => () => new Promise(() => {})),
    })
    handleConversationStreamSync(deps as never, { capture: LOCUCION })
    const turnId = deps.activeTurnIdRef.current
    const slot = await primeTurnSpeakerPreflight(
      turnId,
      buildFinalSpeakerSnapshotResolver({
        createSpeakerAudioResolver: deps.createSpeakerAudioResolver,
        phrase: LOCUCION,
        turnId,
      }),
      { timeoutMs: 60 },
    )
    expect(slot?.ready).not.toBe(true)
    handleConversationStreamSync(deps as never, { capture: LOCUCION, turnCommit: true, settlesTurn: true })
    expect((deps.emitConversationLog as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(1)
  })
})
