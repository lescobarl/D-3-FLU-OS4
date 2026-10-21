// @vitest-environment node
// ============================================================
// vozCajaFraseViva - la caja de ULTIMA FRASE: completa palabras, admite la revision del
// ASR y NO se tira en el cierre.
// ------------------------------------------------------------
// DEFECTOS MEDIDOS (2026-10-21, sesion del dueno):
//  1. DUPLICACION: la caja mostraba "du dupli duplica". `colaNuevaTrasSolape` sabia ANADIR
//     cola pero no COMPLETAR la palabra que crece, y las emisiones de UNA palabra se
//     descartaban (`crudasNuevas.length < 2`).
//  2. CONGELAMIENTO: la caja bloqueaba cualquier emision mas corta o corregida mientras el
//     turno estaba abierto, asi que un re-reconocimiento del inicio no se veia hasta el
//     final (47 s congelada, documentado en el propio modulo).
//  3. BLOQUE PERDIDO: al cerrar con `locutionClosed` el `capture` corto se commiteaba SIN
//     reconciliar con la caja y luego el vaciado borraba la memoria: la fila se quedaba con
//     "mientras" y el bloque largo de los interinos se perdia.
//
// HARNESS DE FIDELIDAD: se ejercita la funcion REAL (`handleConversationStreamSync`), cuyo
// gate de fila es `refreshNeeded && settlesTurn` (y `settlesTurn` + no estar ya en fila en
// la rama simple). Los harness de `vozLocucionVivaLargaGuard` inyectan su propio
// `syncConversationStream` que escribe con solo `turnCommit: true`; ese hueco permitia
// tests verdes con perdida real. Aqui no se usa ese atajo.
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/voice/lib/voiceProbe', () => ({ voiceProbe: vi.fn() }))

import { handleConversationStreamSync, colaNuevaTrasSolape, palabraQueCrece } from '../src/voice/lib/conversationStreamCommit.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import { resetTurnSpeakerPreflights } from '../src/voice/lib/turnSpeakerPreflight.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const FRASE =
  'el mismo escenario en donde cuando es una frase larga de repente la borra completa de la transcripcion'

function makeDeps(over: Record<string, unknown> = {}) {
  const mostrado: string[] = []
  const filas: string[] = []
  const deps = {
    conversationActiveRef: { current: true },
    publishedLiveRef: { current: '' },
    listenStateRef: { current: createActiveListenState() },
    openPreviewTurnRef: { current: false },
    setLiveTranscript: vi.fn<(v: string) => void>((v: string) => mostrado.push(String(v))),
    scheduleLiveTranscriptUpdate: vi.fn<(v: string) => void>((v: string) => mostrado.push(String(v))),
    applyConversationSpeaker: vi.fn(),
    flushPendingStreamLog: vi.fn(),
    logRowsTextRef: { current: filas },
    logRowSpeakersRef: { current: [] as string[] },
    activeTurnIdRef: { current: 0 },
    flushPcmAfterTurnCommit: vi.fn(),
    lastCommitAtRef: { current: 0 },
    lastOnresultAtRef: { current: 0 },
    lastEmittedTurnRef: { current: 0 },
    turnAudioStartSampleRef: { current: 0 },
    chunkTotalSamplesRef: { current: 0 },
    preflightScheduledForTurnRef: { current: true },
    srGapFiredForOpenLineRef: { current: true },
    processConversationFluQueryRef: { current: vi.fn() },
    lastEmittedTranscriptRef: { current: '' },
    emitConversationLog: vi.fn((text?: string) => {
      filas.push(String(text || ''))
      return true
    }),
    createSpeakerAudioResolver: vi.fn(() => () => Promise.resolve({ speakerName: 'Hablante 1' })),
    sessionPrimarySpeakerRef: { current: '' },
    lastLoggedSpeakerRef: { current: '' },
    lastResolvedSpeakerRef: { current: '' },
    speakerClustersRef: { current: [] as object[] },
    setSpeakerClusters: vi.fn(),
    applyResolvedSpeaker: vi.fn(),
    lastSpeakerRef: { current: '' },
    lastTurnSignatureRef: { current: null as number[] | null },
    lastLogLineTextRef: { current: '' },
    lastLogLineWasCommandRef: { current: false },
    commitTurnToSessionRows: vi.fn(),
    lastRequestRef: { current: { text: '', at: 0 } },
    flushTranscriptOnFinal: vi.fn(),
    registerParticipant: vi.fn(),
    fluParticipantRef: { current: { onTurnCommitted: vi.fn() } },
  }
  Object.assign(deps, over)
  return { deps, mostrado, filas }
}

const ultimo = (mostrado: string[]) => mostrado[mostrado.length - 1] || ''

beforeEach(() => {
  FLU_CONFIG.voiceCommands.requireWakeAlways = false
  resetTurnSpeakerPreflights()
})
afterEach(() => {
  resetTurnSpeakerPreflights()
})

describe('A - completar la palabra que crece, no pegarla', () => {
  it('`palabraQueCrece` distingue el crecimiento del doble legitimo', () => {
    expect(palabraQueCrece('du', 'dupli')).toBe(true)
    expect(palabraQueCrece('dupli', 'duplica')).toBe(true)
    expect(palabraQueCrece('no', 'no')).toBe(false)
    expect(palabraQueCrece('duplica', 'du')).toBe(false)
    expect(palabraQueCrece('la', 'largo')).toBe(true) // mismo arranque: es la MISMA palabra creciendo
  })

  it('colaNuevaTrasSolape reemplaza la ultima palabra, tambien con UNA sola palabra nueva', () => {
    expect(colaNuevaTrasSolape('du', 'dupli')).toBe('dupli')
    expect(colaNuevaTrasSolape('dupli', 'duplica')).toBe('duplica')
    expect(colaNuevaTrasSolape('vamos con la du', 'duplica')).toBe('vamos con la duplica')
  })

  it('la CAJA real: du -> dupli -> duplica muestra "duplica" (no "du dupli duplica")', () => {
    const { deps, mostrado } = makeDeps()
    for (const texto of ['du', 'dupli', 'duplica']) {
      handleConversationStreamSync(deps as never, { capture: texto })
    }
    expect(ultimo(mostrado)).toBe('duplica')
    expect(deps.publishedLiveRef.current).toBe('duplica')
  })

  it('"no no" se conserva: el doble legitimo no es un prefijo que crece', () => {
    const { deps, mostrado } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: 'no' })
    handleConversationStreamSync(deps as never, { capture: 'no no' })
    expect(ultimo(mostrado)).toBe('no no')
  })

  it('la caja ya no acumula la parcial pegada: "vamos con la du" + "duplica"', () => {
    const { deps, mostrado } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: 'vamos con la du' })
    handleConversationStreamSync(deps as never, { capture: 'duplica' })
    expect(ultimo(mostrado)).toBe('vamos con la duplica')
  })
})

describe('B - revision de la MISMA locucion (el ASR corrige el inicio)', () => {
  it('un re-reconocimiento que CORRIGE el inicio actualiza la caja aunque sea mas corto', () => {
    const { deps, mostrado } = makeDeps()
    const MOSTRADO = 'no se como se comporta la diarizacion en la caja de la frase viva'
    const REVISION = 'no se como se comporta la transcripcion en la caja de la frase' // corrige y no crece
    handleConversationStreamSync(deps as never, { capture: MOSTRADO })
    expect(ultimo(mostrado)).toBe(MOSTRADO)

    handleConversationStreamSync(deps as never, { capture: REVISION })
    expect(ultimo(mostrado), 'la revision del mismo tramo tiene que verse').toBe(REVISION)
  })

  it('un texto AJENO y mas corto sigue bloqueado (jamas se sustituye lo que no deriva)', () => {
    const { deps, mostrado } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: FRASE })
    handleConversationStreamSync(deps as never, { capture: 'vale pues si claro' })
    expect(ultimo(mostrado)).toBe(FRASE)
  })

  it('un TROZO contiguo de lo mostrado sigue sin aplicarse (no encoge la caja)', () => {
    const { deps, mostrado } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: FRASE })
    handleConversationStreamSync(deps as never, { capture: 'de la transcripcion' })
    expect(ultimo(mostrado)).toBe(FRASE)
  })
})

describe('C - el cierre no tira la caja', () => {
  const BLOQUE = [
    'estoy dictando una locucion larga mientras el reconocedor no cierra la frase',
    'estoy dictando una locucion larga mientras el reconocedor no cierra la frase y sigo hablando',
    'estoy dictando una locucion larga mientras el reconocedor no cierra la frase y sigo hablando todavia mas mientras',
  ]

  it('interinos largos + final CORTO con locutionClosed: la fila lleva el bloque, no "mientras"', () => {
    const { deps, filas } = makeDeps()
    for (const texto of BLOQUE) {
      handleConversationStreamSync(deps as never, { capture: texto })
    }
    expect(deps.publishedLiveRef.current).toBe(BLOQUE[BLOQUE.length - 1])

    // Cierre REAL de la locucion anterior, con el final corto que entrega Chrome.
    handleConversationStreamSync(deps as never, {
      capture: 'mientras',
      turnCommit: true,
      settlesTurn: true,
      locutionClosed: true,
    })

    expect(filas.length, 'el cierre tiene que escribir UNA fila').toBe(1)
    expect(filas[0], 'la fila no puede quedarse con el final corto').toBe(BLOQUE[BLOQUE.length - 1])
    expect(deps.publishedLiveRef.current, 'la caja se vacia DESPUES de escribir la fila').toBe('')
  })

  it('un final AJENO con locutionClosed NO se lleva la caja de la locucion siguiente', () => {
    const { deps, filas } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: 'la caja de la frase viva esta congelada otra vez' })
    handleConversationStreamSync(deps as never, {
      capture: 'pon musica relajante',
      turnCommit: true,
      settlesTurn: true,
      locutionClosed: true,
    })
    expect(filas[0]).toBe('pon musica relajante')
  })

  it('sin fila emitida la caja NO se vacia (el texto sigue vivo)', () => {
    const { deps } = makeDeps()
    for (const texto of BLOQUE) {
      handleConversationStreamSync(deps as never, { capture: texto })
    }
    // Un commit de SEGMENTO no cierra el turno: no hay fila.
    handleConversationStreamSync(deps as never, { capture: 'mientras', turnCommit: true, settlesTurn: false })
    expect(deps.publishedLiveRef.current, 'la caja conserva el texto').toBe(BLOQUE[BLOQUE.length - 1])
  })
})

describe('D - fidelidad del gate real (refreshNeeded && settlesTurn)', () => {
  it('un commit SIN cierre no escribe fila aunque traiga texto (gate de produccion)', () => {
    const { deps, filas } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: 'esto se esta dictando ahora mismo', turnCommit: true })
    expect(filas.length, 'sin settlesTurn no hay fila').toBe(0)
  })

  it('el cierre posterior escribe la fila UNA vez y con el bloque completo', () => {
    const { deps, filas } = makeDeps()
    const LARGO = 'esta es la locucion completa que el reconocedor entrego como interinos acumulativos sin cerrar la frase en ningun momento'
    handleConversationStreamSync(deps as never, { capture: LARGO })
    handleConversationStreamSync(deps as never, { capture: LARGO, turnCommit: true, settlesTurn: true })
    expect(filas.length, 'una sola fila por turno').toBe(1)
    expect(filas[0].length).toBeGreaterThan(80)
  })
})
