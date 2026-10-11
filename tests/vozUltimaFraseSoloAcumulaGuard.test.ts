// ============================================================
// vozUltimaFraseSoloAcumulaGuard - A) LA FRASE VIVA ("ultima frase") SOLO ACUMULA.
// ------------------------------------------------------------
// MEDIDO (log del dueno 2026-10-11 11:28, al dictar una frase larga):
//   el texto mostrado pasaba de la frase COMPLETA a "dos o tres palabras" (una COLA del
//   ASR) y luego volvia a aparecer entero: "de repente la borra completa ... y luego dejar
//   como unas dos o tres palabras y luego no se ve todo y luego ya se vuelve a ver".
//   CAUSA MEDIDA (lectura del dueno unico del preview, `conversationStreamCommit`): el
//   recorte solo se bloqueaba por PREFIJO (`wouldShrinkListenLog`), asi que una COLA
//   contigua (o un trozo del medio) SI reemplazaba lo mostrado; y el CIERRE borraba la
//   memoria de lo mostrado (`publishedLiveRef = ''`), con lo que el siguiente trozo ya no
//   tenia contra que compararse.
//
// REGLA: dentro de un dictado el texto mostrado NO acorta y NO se vacia. La transicion a
// una locucion NUEVA la decide el DUENO del trozo (`isFragmentOfLocution`): una frase que
// NO es trozo reemplaza; un trozo conserva la COMPLETA.
// ESTE GUARD mide LO QUE SE MUESTRA (`scheduleLiveTranscriptUpdate` / `setLiveTranscript`),
// no un campo interno.
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/voice/lib/voiceProbe', () => ({ voiceProbe: vi.fn() }))

import { voiceProbe } from '../src/voice/lib/voiceProbe'
import { handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import { resetTurnSpeakerPreflights } from '../src/voice/lib/turnSpeakerPreflight.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const FRASE = 'el mismo escenario en donde cuando es una frase larga de repente la borra completa de la transcripcion'
const COLA = 'de la transcripcion'
const MEDIO = 'cuando es una frase larga'

function makeDeps(over: Record<string, unknown> = {}) {
  const mostrado: string[] = []
  const deps = {
    conversationActiveRef: { current: true },
    publishedLiveRef: { current: '' },
    listenStateRef: { current: createActiveListenState() },
    openPreviewTurnRef: { current: false },
    setLiveTranscript: vi.fn<(v: string) => void>((v: string) => mostrado.push(String(v))),
    scheduleLiveTranscriptUpdate: vi.fn<(v: string) => void>((v: string) => mostrado.push(String(v))),
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
    lastRequestRef: { current: { text: '', at: 0 } },
    fluParticipantRef: { current: { onTurnCommitted: vi.fn() } },
  }
  Object.assign(deps, over)
  return { deps, mostrado }
}

const ultimo = (mostrado: string[]) => mostrado[mostrado.length - 1] || ''

describe('A - la ultima frase SOLO acumula (lo que se ve)', () => {
  beforeEach(() => {
    FLU_CONFIG.voiceCommands.requireWakeAlways = false
    resetTurnSpeakerPreflights()
    vi.mocked(voiceProbe).mockClear()
  })
  afterEach(() => {
    resetTurnSpeakerPreflights()
  })

  it('un TROZO posterior (la COLA) NO acorta lo mostrado', () => {
    const { deps, mostrado } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: FRASE })
    expect(ultimo(mostrado)).toBe(FRASE)

    handleConversationStreamSync(deps as never, { capture: COLA })
    expect(ultimo(mostrado), 'la cola no puede reemplazar la frase mostrada').toBe(FRASE)

    handleConversationStreamSync(deps as never, { capture: MEDIO })
    expect(ultimo(mostrado), 'un trozo del medio tampoco').toBe(FRASE)
  })

  it('la sonda `live` registra el acortamiento CON antes/despues', () => {
    const { deps } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: FRASE })
    handleConversationStreamSync(deps as never, { capture: COLA })
    const llamadas = vi.mocked(voiceProbe).mock.calls.filter((c) => c[0] === 'live')
    expect(llamadas.length, 'la sonda de la frase viva tiene que emitir').toBeGreaterThanOrEqual(2)
    const acorte = llamadas.find((c) => (c[1] as { acorta?: boolean })?.acorta === true)
    expect(acorte, 'el acortamiento se registra con su motivo').toBeTruthy()
    expect((acorte?.[1] as { previo?: number })?.previo).toBe(FRASE.length)
    expect((acorte?.[1] as { len?: number })?.len).toBe(COLA.length)
  })

  it('una locucion NUEVA (no es trozo) SI reemplaza lo mostrado', () => {
    const { deps, mostrado } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: FRASE })
    handleConversationStreamSync(deps as never, { capture: 'pon musica relajante para cenar' })
    expect(ultimo(mostrado)).toBe('pon musica relajante para cenar')
  })

  it('el CIERRE no vacia lo mostrado (ni la zona ni su memoria)', () => {
    const { deps, mostrado } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: FRASE })
    handleConversationStreamSync(deps as never, {
      capture: FRASE,
      turnCommit: true,
      settlesTurn: true,
    })
    expect(deps.setLiveTranscript, 'el cierre no borra la zona').not.toHaveBeenCalledWith('')
    expect(mostrado).not.toContain('')
    // Y un trozo posterior al cierre sigue sin poder acortar lo mostrado.
    handleConversationStreamSync(deps as never, { capture: COLA })
    expect(ultimo(mostrado)).toBe(FRASE)
  })

  it('la sonda DICE si el acortamiento fue BLOQUEADO o APLICADO (dato concluyente)', () => {
    const { deps } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: FRASE })
    handleConversationStreamSync(deps as never, { capture: COLA })
    handleConversationStreamSync(deps as never, { capture: 'pon musica relajante para cenar' })
    const live = vi.mocked(voiceProbe).mock.calls.filter((c) => c[0] === 'live').map((c) => c[1] as { resultado?: string; acorta?: boolean; mismaLocucion?: boolean })
    expect(live.some((o) => o.resultado === 'bloqueado'), 'el recorte bloqueado se declara').toBe(true)
    expect(live.some((o) => o.resultado === 'aplicado'), 'la sustitucion aplicada se declara').toBe(true)
    // INVARIANTE DEL DUENO: `acortamientos APLICADOS = 0` -> ningun recorte de la MISMA locucion
    // se aplica jamas (el bloqueo lo impide en la rama anterior).
    expect(live.filter((o) => o.resultado === 'aplicado' && o.mismaLocucion === true), 'ningun recorte de la misma locucion puede aplicarse').toEqual([])
    // Y todo lo aplicado es una locucion NUEVA (no un trozo de la mostrada).
    expect(live.filter((o) => o.resultado === 'aplicado').every((o) => o.mismaLocucion === false), 'lo aplicado es locucion nueva').toBe(true)
    // El bloqueado SIEMPRE acorta y SIEMPRE es la misma locucion (es su motivo).
    expect(live.filter((o) => o.resultado === 'bloqueado').every((o) => o.acorta === true && o.mismaLocucion === true)).toBe(true)
    // El campo tiene que existir en TODA emision: sin el, el dato no es concluyente.
    expect(live.every((o) => o.resultado === 'bloqueado' || o.resultado === 'aplicado')).toBe(true)
  })

  it('control NEGATIVO (el detector no es decorativo): el criterio por PREFIJO dejaba pasar la cola', () => {
    // Implementacion VIEJA aislada: solo bloqueaba si el nuevo texto era PREFIJO del mostrado.
    const viejoBloquea = (nuevo: string, mostrado: string) =>
      Boolean(mostrado) && Boolean(nuevo) && nuevo.length < mostrado.length && mostrado.startsWith(nuevo)
    expect(viejoBloquea(COLA, FRASE), 'la COLA pasaba el filtro viejo (el defecto medido)').toBe(false)
    expect(viejoBloquea('el mismo escenario', FRASE), 'un prefijo si se bloqueaba').toBe(true)
  })
})
