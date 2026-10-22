// @vitest-environment node
// ============================================================
// simulacionReglasVoz - auditoria ejecutable SIN VOZ
// ------------------------------------------------------------
// Inyecta interinos/finales y vectores sinteticos por la logica REAL:
//  - transcripcion: una fila, caja sin duplicar ni encoger, fila = caja;
//  - diarizacion: mujer distinta no se pega a Luis; vector limpio si;
//  - rutas: VAD/engine/row/box con un solo dueño.
// ============================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/voice/lib/voiceProbe', () => ({ voiceProbe: vi.fn() }))

import {
  handleConversationStreamSync,
  palabraQueCrece,
} from '../src/voice/lib/conversationStreamCommit.js'
import { createActiveListenState, integrateMicPacket } from '../src/voice/lib/activeListen.js'
import { resetTurnSpeakerPreflights } from '../src/voice/lib/turnSpeakerPreflight.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import { resolveConversationSpeaker } from '../src/voice/lib/speakerDiarization.js'
import { compareCosineSignatures } from '../src/voice/lib/speakerCore.js'

const ROOT = process.cwd()
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

function makeDeps() {
  const mostrado: string[] = []
  const filas: string[] = []
  const deps = {
    conversationActiveRef: { current: true },
    publishedLiveRef: { current: '' },
    listenStateRef: { current: createActiveListenState() },
    openPreviewTurnRef: { current: false },
    setLiveTranscript: vi.fn((v: string) => mostrado.push(String(v))),
    scheduleLiveTranscriptUpdate: vi.fn((v: string) => mostrado.push(String(v))),
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
  return { deps, mostrado, filas }
}

const ultimo = (xs: string[]) => xs[xs.length - 1] || ''
const unit = (pairs: Array<[number, number]>) => {
  const v = new Array(512).fill(0)
  for (const [i, x] of pairs) v[i] = x
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1
  return v.map((x) => x / n)
}
const LUIS = unit([[0, 1]])
const MUJER = unit([[0, 0.5], [1, Math.sqrt(0.75)]]) // coseno 0.5 con Luis
const MEZCLA = unit([[0, 0.8], [1, 0.4]])

function resolver(vector: number[], primary = 'Luis') {
  const diagnosis: any = {}
  const label = resolveConversationSpeaker({
    signatureVector: vector,
    speakerClusters: [
      { label: 'Luis', signature: [...LUIS], anchorVerified: true },
      { label: 'Hablante 2', signature: [...MUJER] },
    ],
    lastSpeaker: 'Luis',
    lastSignature: [...LUIS],
    voicedSampleCount: 96000,
    sampleRate: 48000,
    utteranceText: 'esta es una frase larga de prueba para resolver el hablante',
    atTurnBoundary: true,
    allowNewCluster: true,
    sessionPrimary: primary,
    preferSpeaker: 'Luis',
    diagnosis,
  } as any)
  return { label, reason: diagnosis.reason || '', diagnosis }
}

beforeEach(() => {
  FLU_CONFIG.voiceCommands.requireWakeAlways = false
  resetTurnSpeakerPreflights()
})
afterEach(() => resetTurnSpeakerPreflights())

describe('simulacion - transcripcion/caja/fila', () => {
  it('du -> dupli -> duplica no se pega: una sola palabra completada', () => {
    const { deps, mostrado } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: 'du' })
    handleConversationStreamSync(deps as never, { capture: 'dupli' })
    handleConversationStreamSync(deps as never, { capture: 'duplica' })
    expect(ultimo(mostrado)).toBe('duplica')
    expect(ultimo(mostrado).toLowerCase()).not.toContain('du dupli')
  })

  it('una revision mas corta NO encoge la caja', () => {
    const { deps, mostrado } = makeDeps()
    const LARGO = 'esta es la locucion completa de la caja que no puede perder texto'
    const CORTO = 'esta es la locucion completa'
    handleConversationStreamSync(deps as never, { capture: LARGO })
    handleConversationStreamSync(deps as never, { capture: CORTO })
    expect(ultimo(mostrado)).toBe(LARGO)
  })

  it('si la linea viva es la misma locucion y mas completa, la caja crece y la fila lleva esa frase', () => {
    const { deps, filas } = makeDeps()
    const LARGO = 'la locucion completa que estaba en la caja y debe llegar a la fila sin perderse'
    const CORTO = 'la locucion completa'
    deps.listenStateRef.current = createActiveListenState()
    integrateMicPacket(deps.listenStateRef.current, { interim: LARGO })
    deps.publishedLiveRef.current = CORTO
    handleConversationStreamSync(deps as never, {
      capture: CORTO,
      turnCommit: true,
      settlesTurn: true,
    })
    expect(filas.length).toBe(1)
    expect(filas[0]).toBe(LARGO)
    expect(deps.publishedLiveRef.current).toBe('')
  })

  it('palabraQueCrece no confunde el doble legitimo con un prefijo', () => {
    expect(palabraQueCrece('du', 'dupli')).toBe(true)
    expect(palabraQueCrece('no', 'no')).toBe(false)
    expect(palabraQueCrece('duplica', 'du')).toBe(false)
  })
})

describe('simulacion - diarizacion con vectores inyectados', () => {
  it('la mujer distinta (coseno 0.5) NO se etiqueta Luis', () => {
    const r = resolver(MUJER)
    expect(compareCosineSignatures(MUJER, LUIS)).toBeCloseTo(0.5, 2)
    expect(r.label).not.toBe('Luis')
  })

  it('el titular limpio (coseno 1) SI se etiqueta Luis', () => {
    const r = resolver(LUIS)
    expect(r.label).toBe('Luis')
  })

  it('un turno mezclado no vuelve a Luis por el pin del primario', () => {
    const r = resolver(MEZCLA)
    expect(compareCosineSignatures(MEZCLA, LUIS)).toBeGreaterThan(0.85)
    expect(r.label).not.toBe('Luis')
  })
})

describe('simulacion - rutas unicas (fuente)', () => {
  it('el VAD del segmentador consume el dueno unico y no redefine RMS', () => {
    const segmenter = read('src/voice/lib/asr/voiceActivitySegmenter.js')
    expect(segmenter).toContain("from '../voicedActivity.js'")
    expect(segmenter).not.toMatch(/function\s+rootMeanSquare\b/)
    expect(segmenter).toContain('isVoicedFrame')
  })

  it('la escucha principal se adquiere en un solo punto', () => {
    const hook = read('src/voice/hooks/useFluVoiceAssistant.js')
    expect(hook.match(/acquireSpeechRecognition\(/g)?.length).toBe(1)
  })

  it('la caja y la fila tienen un solo writer declarado', () => {
    const box = read('src/voice/lib/conversationStreamCommit.js')
    const row = read('src/voice/lib/conversationTurnRow.ts')
    expect(box.match(/const publicarEnLaCaja\s*=\s*\(/g)?.length).toBe(1)
    expect(row.match(/export function commitUserTurnRow\(/g)?.length).toBe(1)
  })
})
