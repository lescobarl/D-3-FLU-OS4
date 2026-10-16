// ============================================================
// vozPreflightConsumeTurnoEsperadoGuard - el commit CONSUME el preflight
// del turno que se ESPERO, no el del turno siguiente.
// ------------------------------------------------------------
// MEDIDO en el log del dueno (2026-10-15, 34/34 commits):
//   `Preflight turn=29 ready=true reason=resolved-idle name="Hablante 1"`
//   y acto seguido `commit turn=30 preReady=false src=sticky-preflight-pending`.
// CAUSA: el cierre (handleConversationStreamSync) releia
//   `activeTurnIdRef.current` DESPUES de `ensureTurnId(true, ...)`, que acuna el
//   turno SIGUIENTE cuando el preview no estaba abierto. La espera del hook
//   (`primeTurnSpeakerPreflight`) se hizo con el turno ABIERTO, asi que el commit
//   consumia el slot NUEVO (vacio, `pending`) y la evidencia medida del turno no
//   llegaba nunca a la fila (17/17 filas con `evidencia:false`, `speaker:""`).
// REGLA: el hablante lo resuelve la espera; el commit consume ESE slot.
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildFinalSpeakerSnapshotResolver,
  handleConversationStreamSync,
} from '../src/voice/lib/conversationStreamCommit.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import {
  primeTurnSpeakerPreflight,
  resetTurnIdentityPipeline,
} from '../src/voice/lib/turnIdentityPipeline.js'
import { resetSpeakerIdentityQueue } from '../src/voice/lib/voiceIdentityQueue.js'

const LOCUCION = 'tambien venden peperos y papas coreanas'

function resolverHablante2() {
  return () =>
    Promise.resolve({
      speakerId: 'spk-2',
      speakerName: 'Hablante 2',
      evidence: true,
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
    activeTurnIdRef: { current: 900 },
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

function filaEmitida(deps: ReturnType<typeof makeDeps>) {
  const call = (deps.emitConversationLog as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
  return (call?.[1] || {}) as { speakerName?: string; evidenciaAcustica?: boolean }
}

describe('el commit consume el preflight del turno esperado', () => {
  beforeEach(() => {
    resetTurnIdentityPipeline()
    resetSpeakerIdentityQueue()
  })
  afterEach(() => {
    resetTurnIdentityPipeline()
    resetSpeakerIdentityQueue()
  })

  it('el cierre consume el slot del turno ABIERTO, no el del turno siguiente', async () => {
    const deps = makeDeps()
    // El hook espera la instantanea con el id del turno ABIERTO (antes del commit).
    const esperado = deps.activeTurnIdRef.current
    const primed = await primeTurnSpeakerPreflight(
      esperado,
      buildFinalSpeakerSnapshotResolver({
        createSpeakerAudioResolver: deps.createSpeakerAudioResolver,
        phrase: LOCUCION,
        turnId: esperado,
      }),
      { onClusters: deps.setSpeakerClusters, onResolved: deps.applyConversationSpeaker },
    )
    expect(primed?.ready, 'anti-vacio: la espera SI resolvio el preflight del turno').toBe(true)

    handleConversationStreamSync(deps as never, {
      capture: LOCUCION,
      turnCommit: true,
      settlesTurn: true,
      // Lo que hace el hook: declara el turno cuyo preflight acaba de ESPERAR.
      preflightTurnId: esperado,
    })

    expect(deps.activeTurnIdRef.current, 'el commit siembra el turno siguiente (garantiza la carrera)').toBeGreaterThan(esperado)
    const fila = filaEmitida(deps)
    expect(fila.speakerName, 'la etiqueta resuelta por la espera llega a la fila').toBe('Hablante 2')
    expect(fila.evidenciaAcustica, 'la evidencia MEDIDA del turno llega a la fila').toBe(true)
  })
})

// P2.4 — prueba de detector: el detector no es decorativo. Alimentada la ruta
// VIEJA (el commit relee el turno tras el bump, sin preflightTurnId declarado)
// el guard tiene que discriminar; si tambien saliera 'Hablante 2' el test no
// estaria midiendo nada.
describe('el commit sin preflightTurnId NO consume el slot esperado (el detector no es decorativo)', () => {
  beforeEach(() => {
    resetTurnIdentityPipeline()
    resetSpeakerIdentityQueue()
  })
  afterEach(() => {
    resetTurnIdentityPipeline()
    resetSpeakerIdentityQueue()
  })

  it('ruta vieja: se declara el turno siguiente y la etiqueta del turno esperado no llega', async () => {
    const deps = makeDeps()
    const esperado = deps.activeTurnIdRef.current
    const primed = await primeTurnSpeakerPreflight(
      esperado,
      buildFinalSpeakerSnapshotResolver({
        createSpeakerAudioResolver: deps.createSpeakerAudioResolver,
        phrase: LOCUCION,
        turnId: esperado,
      }),
      { onClusters: deps.setSpeakerClusters, onResolved: deps.applyConversationSpeaker },
    )
    expect(primed?.ready, 'anti-vacio: la espera SI resolvio el preflight').toBe(true)

    // Ruta anterior al fix: sin preflightTurnId el cierre relee el turno YA
    // acunado (esperado + 1) y el slot que habia quedado vacio no aporta etiqueta.
    handleConversationStreamSync(deps as never, {
      capture: LOCUCION,
      turnCommit: true,
      settlesTurn: true,
    })

    const fila = filaEmitida(deps)
    expect(
      fila.speakerName,
      'el guard discrimina: sin el id declarado no llega la etiqueta del turno esperado',
    ).not.toBe('Hablante 2')
  })
})