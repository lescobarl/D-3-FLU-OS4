// ============================================================
// vozUltimaFraseNoSeVaciaGuard - B) LA "ULTIMA FRASE" NO SE VACIA DURANTE LA CONVERSACION.
// ------------------------------------------------------------
// REGLA DEL DUENO (2026-10-11): "la ultima frase debe acumular, nunca borrar y luego volver a
// poner eso es incorrecto". Se borraba en DOS rutas durante la conversacion:
//   (1) el REBUILD del watchdog (`flushListenStateBeforeRebuild`, a mitad de frase) y
//   (2) al ENTREGAR la frase a la IA (`processConversationFluQuery` y el comando), mas el
//       flush `flushTranscriptStateOnFinal` al cerrar el turno.
// Los vaciados de ARRANQUE / PARADA / SESION se declaran aparte y SI vacian (son otra escena).
//
// PRUEBA DE DETECTOR (mutacion): si el flush de cierre vuelve a borrar `publishedLiveRef`, la
// COLA que llega despues ya no tiene contra que compararse y REEMPLAZA lo mostrado -> CAE.
//
// ESTE GUARD mide LO QUE SE VE (el texto mostrado) y su MEMORIA, no un campo interno.
// ============================================================
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/voice/lib/voiceProbe', () => ({ voiceProbe: vi.fn() }))

import { resetTurnSpeakerPreflights } from '../src/voice/lib/turnSpeakerPreflight.js'
import { handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import { flushTranscriptStateOnFinal } from '../src/voice/lib/recognitionBufferFlush.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const HOOK = readFileSync('src/voice/hooks/useFluVoiceAssistant.js', 'utf8')
const FLUSH = readFileSync('src/voice/lib/recognitionBufferFlush.js', 'utf8')

const FRASE = 'el mismo escenario en donde cuando es una frase larga de repente la borra completa'
const COLA = 'la borra completa'

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

describe('B - la "ultima frase" no se vacia durante la conversacion', () => {
  beforeEach(() => {
    FLU_CONFIG.voiceCommands.requireWakeAlways = false
    resetTurnSpeakerPreflights()
  })
  afterEach(() => resetTurnSpeakerPreflights())

  it('tras ENTREGAR la frase a la IA, la memoria sigue viva y un trozo NO la reemplaza', () => {
    const { deps, mostrado } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: FRASE })
    expect(ultimo(mostrado)).toBe(FRASE)

    // Ruta (2): el flush de cierre que corre al entregar el turno.
    flushTranscriptStateOnFinal({ listenState: deps.listenStateRef.current, publishedLiveRef: deps.publishedLiveRef } as never)
    expect(deps.publishedLiveRef.current, 'la memoria NO se borra al entregar').toBe(FRASE)

    // La COLA que llega despues se compara contra la memoria y NO reemplaza.
    handleConversationStreamSync(deps as never, { capture: COLA })
    expect(ultimo(mostrado), 'un trozo no puede reemplazar lo mostrado').toBe(FRASE)
  })

  it('el flush de cierre no conoce la frase viva (no la puede vaciar)', () => {
    expect(FLUSH.includes('publishedLiveRef'), 'el flush de cierre no debe borrar la frase viva').toBe(false)
  })

  it('el rebuild del watchdog NO vacia la zona', () => {
    const start = HOOK.indexOf('const flushListenStateBeforeRebuild')
    const block = HOOK.slice(start, HOOK.indexOf('const cleanupAudio', start))
    expect(block.length).toBeGreaterThan(0)
    expect(block.includes("setLiveTranscript('')"), 'el rebuild no debe vaciar la zona').toBe(false)
    expect(block.includes('publishedLiveRef.current = '), 'el rebuild no debe borrar la memoria').toBe(false)
  })

  it('los vaciados que quedan son SOLO las escenas declaradas (arranque/parada/sesion)', () => {
    const vaciados = (HOOK.match(/cajaVivaRef\.current\.vaciarLaCaja\(/g) || []).length
    // 4 escenas declaradas: flush pasivo (no conversacion), resetVoiceDisplay (arranque/sesion),
    // parada y reset de sesion. Un vaciado nuevo en la conversacion sube el conteo -> CAE.
    expect(vaciados, 'un vaciado nuevo durante la conversacion no esta declarado').toBe(4)
    expect(HOOK.includes('publishedLiveRef.current = '), 'el hook no escribe la caja (un solo escritor)').toBe(false)
  })
})
