// @vitest-environment jsdom
// ============================================================
// voiceLocalRecovery - con Whisper activo se REINTENTA Chrome y se vuelve
// ------------------------------------------------------------
// DEFECTO MEDIDO (2026-10-20): tras degradar por SR mudo, el latch
// `localFallbackActiveRef` no volvia a Chrome nunca mas (solo en startListening):
// una degradacion puntual dejaba el resto de la sesion en Whisper (mas lento y
// propenso a alucinar). Aqui se fija la recuperacion medida por el WATCHDOG real:
//   1. N finales locales (o `recoveryMs`) y TURNO CERRADO -> se instala Chrome;
//   2. si Chrome NO produce resultado en `probeMs` -> vuelve el motor local;
//   3. si Chrome responde -> se queda y la ventana de prueba se anula.
// ============================================================
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const integration = {
    lastCommittedTranscript: '',
    conversationHistory: [] as unknown[],
    conversationState: 'IDLE',
  }
  function makeRecognition(id: string) {
    return {
      id,
      lang: '',
      onstart: null as null | (() => void),
      onresult: null as null | ((e: unknown) => void),
      onerror: null as null | ((e: unknown) => void),
      onend: null as null | (() => void),
      stop: vi.fn(),
      start: vi.fn(),
      abort: vi.fn(),
    }
  }
  const recognition = makeRecognition('chrome-1')
  const chrome2 = makeRecognition('chrome-2')
  const local = {
    id: 'local',
    pushAudio: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
    onstart: null as null | (() => void),
    onresult: null as null | ((e: unknown) => void),
    onerror: null as null | ((e: unknown) => void),
    onend: null as null | (() => void),
  }
  return { integration, recognition, chrome2, local, makeRecognition, state: { creados: 0 } }
})

vi.mock('@huggingface/transformers', () => ({
  env: {},
  AutoProcessor: { from_pretrained: vi.fn() },
  AutoModel: { from_pretrained: vi.fn() },
}))

vi.mock('../src/store/integrationStore', () => {
  const useIntegrationStore = (selector?: (s: unknown) => unknown) =>
    selector ? selector(h.integration) : h.integration
  ;(useIntegrationStore as unknown as Record<string, unknown>).getState = () => h.integration
  ;(useIntegrationStore as unknown as Record<string, unknown>).setState = () => {}
  ;(useIntegrationStore as unknown as Record<string, unknown>).subscribe = () => () => {}
  return { useIntegrationStore }
})

vi.mock('../src/voice/lib/fluStorage', () => ({
  listVoiceProfiles: vi.fn(async () => []),
  loadSessionState: vi.fn(async () => null),
  saveSessionState: vi.fn(async () => undefined),
  saveVoiceProfile: vi.fn(async () => undefined),
}))
vi.mock('../src/voice/lib/gemini', () => ({ requestFluContract: vi.fn(async () => ({})) }))

// Chrome 1 = el del arranque; Chrome 2 = el de la RECUPERACION.
vi.mock('../src/voice/lib/speechRecognitionLocal', () => ({
  acquireSpeechRecognition: vi.fn(() => {
    h.state.creados += 1
    return h.state.creados === 1 ? h.recognition : h.chrome2
  }),
  startSpeechRecognition: vi.fn(() => true),
  stopSpeechRecognition: vi.fn(),
}))

vi.mock('../src/voice/lib/micCaptureBridge.js', () => ({
  wireMicCapturePipeline: vi.fn(async () => ({ zeroGain: { disconnect: vi.fn() } })),
}))
vi.mock('../src/voice/lib/turnIdentityPipeline.js', async (original) => ({
  ...((await original()) as object),
  startContinuousIdentityPipeline: vi.fn(),
  stopAllContinuousIdentityPipelines: vi.fn(),
  finalizeTurnIdentityPipeline: vi.fn(() => null),
}))

// Frontera del fallback: local instalable, Chrome de recuperacion observable.
vi.mock('../src/voice/lib/voiceLocalFallback', async (original) => {
  const real = (await original()) as Record<string, unknown>
  return {
    ...real,
    prewarmLocalRecognition: vi.fn(() => true),
    installLocalRecognition: vi.fn(({ wire }: { wire?: (e: unknown) => void }) => {
      if (typeof wire === 'function') wire(h.local)
      h.local.start()
      return h.local
    }),
    installChromeRecognition: vi.fn(({ wire, start }: { wire?: (e: unknown) => void; start?: (e: unknown) => boolean }) => {
      if (typeof wire === 'function') wire(h.chrome2)
      const started = typeof start === 'function' ? start(h.chrome2) : true
      return started ? { ok: true, recognition: h.chrome2 } : null
    }),
    resolveSilentDegrade: vi.fn(() => ({ degrade: false, speechLikeMs: 0, rms: 0, voicedMs: 0, sinceSrResultMs: 0, failedRebuilds: 0, log: '' })),
  }
})

vi.mock('../src/voice/lib/turnSpeakerPreflight.js', () => ({
  createTurnSpeakerAudioResolver: vi.fn(() => ({})),
  peekTurnSpeakerPreflight: vi.fn(() => ({ ready: false })),
  preflightEvidenceMeasured: vi.fn(() => false),
}))
vi.mock('../src/core/selfKnowledge/selfKnowledge', () => ({ isSelfKnowledgeRequest: vi.fn(() => false) }))
vi.mock('../src/core/games/gameSessionStore', () => ({ noteGameTurn: vi.fn() }))
vi.mock('../src/hooks/useFluParticipant', () => ({
  useFluParticipant: vi.fn(() => ({ presentation: { label: 'Participante', show: false } })),
}))
vi.mock('../src/lib/clientLogRelay', () => ({ relayLog: vi.fn() }))
vi.mock('../src/lib/caughtError', () => ({ logCaughtError: vi.fn() }))
vi.mock('../src/voice/lib/fluAsyncError.js', () => ({ fluAsyncErrorHandler: vi.fn(() => vi.fn()) }))
vi.mock('../src/voice/lib/listenLog', () => ({
  fluEvent: vi.fn(),
  logChromeSpeechResult: vi.fn(),
  getListenLogRing: vi.fn(() => []),
  clearListenLogRing: vi.fn(),
}))
vi.mock('../src/voice/lib/fluDebug', async (original) => ({
  ...((await original()) as object),
  debugHotPath: false,
  fluDebugHot: vi.fn(),
  getFluDebugApi: vi.fn(() => ({})),
}))
import { useFluVoiceAssistant } from '../src/voice/hooks/useFluVoiceAssistant'
import { installChromeRecognition, installLocalRecognition } from '../src/voice/lib/voiceLocalFallback'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

function localEvent(transcript: string, speechLikeMs = 900) {
  return {
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript, confidence: 1 }, length: 1 }],
    metrics: { durationMs: 1200, speechLikeMs, rms: 0.2 },
  }
}

function parcialLocal(transcript: string, speechLikeMs = 900) {
  return {
    resultIndex: 0,
    results: [{ isFinal: false, 0: { transcript, confidence: 1 }, length: 1 }],
    metrics: { durationMs: 900, speechLikeMs, rms: 0.2 },
  }
}

function darSoporteNavegador() {
  ;(window as unknown as Record<string, unknown>).SpeechRecognition = function SpeechRecognition() {}
  ;(window as unknown as Record<string, unknown>).AudioContext = function AudioContext() {
    return { sampleRate: 48000 }
  }
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(() => Promise.reject(new Error('sin micro en test'))) },
  })
}

function llamadas(fn: unknown): number {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls.length
}

/** Arranca en Chrome y degrada al motor local por 'network'. */
async function arrancarYdegradar() {
  const vista = renderHook(() =>
    useFluVoiceAssistant({
      apiKey: 'k',
      onContractResolved: vi.fn(),
      language: 'es',
      conversationActiveRef: { current: true },
    } as never),
  )
  await act(async () => {
    await vista.result.current.startListening()
  })
  act(() => {
    h.recognition.onstart?.()
  })
  act(() => {
    h.recognition.onerror?.({ error: 'network' })
  })
  expect(typeof h.local.onresult, 'la degradacion no ocurrio').toBe('function')
  return vista
}

/** N finales locales y un tick: la recuperacion se dispara por SEGMENTOS. */
async function tresFinales() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      h.local.onresult?.(localEvent(`frase local ${i}`))
      await Promise.resolve()
    })
  }
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800)
  })
}

beforeEach(() => {
  // Bloque de recuperacion: habilita el fallback local (en produccion esta
  // apagado por politica Chrome-only, backup `rescate/wip-pre-s9`).
  FLU_CONFIG.voiceIdentity.capture.recognition.localFallbackEnabled = true
  vi.clearAllMocks()
  h.state.creados = 0
  h.integration.lastCommittedTranscript = ''
  h.integration.conversationHistory = []
  ;(h.integration as unknown as Record<string, unknown>).setLastCommittedTranscript = () => {}
  for (const rec of [h.recognition, h.chrome2]) {
    Object.assign(rec, { lang: '', onstart: null, onresult: null, onerror: null, onend: null })
  }
  Object.assign(h.local, { onstart: null, onresult: null, onerror: null, onend: null })
  darSoporteNavegador()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('recuperacion a Chrome con el motor local activo', () => {
  it('tras N finales locales y turno cerrado, el watchdog reinstala Chrome', async () => {
    vi.useFakeTimers()
    await arrancarYdegradar()
    await tresFinales()

    expect(llamadas(installChromeRecognition), 'no se reintento Chrome').toBe(1)
    expect(typeof h.chrome2.onresult, 'Chrome no quedo cableado tras la recuperacion').toBe('function')
  })

  it('si Chrome no responde en probeMs, se vuelve al motor local', async () => {
    vi.useFakeTimers()
    await arrancarYdegradar()
    await tresFinales()
    expect(llamadas(installChromeRecognition)).toBe(1)
    const localesAntes = llamadas(installLocalRecognition)

    // Chrome NO emite nada: vence la ventana de prueba y vuelve la degradacion.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(llamadas(installLocalRecognition), 'no se reinstalo el motor local').toBeGreaterThan(localesAntes)
  })

  it('si Chrome responde, se queda: no se vuelve a degradar', async () => {
    vi.useFakeTimers()
    await arrancarYdegradar()
    await tresFinales()
    expect(typeof h.chrome2.onresult).toBe('function')

    await act(async () => {
      h.chrome2.onstart?.()
      h.chrome2.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: 'hola flu' }, length: 1 }],
      })
      await Promise.resolve()
    })
    const localesAntes = llamadas(installLocalRecognition)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000)
    })
    expect(llamadas(installLocalRecognition), 'Chrome respondio y aun asi se degrado').toBe(localesAntes)
  })

  it('parciales CONTINUOS sin finales NO bloquean la recuperacion (reloj de finales)', async () => {
    vi.useFakeTimers()
    await arrancarYdegradar()
    expect(llamadas(installChromeRecognition)).toBe(0)

    // 22 s de parciales cada 500 ms: si el reloj contara CUALQUIER onresult,
    // `idle` nunca llegaria a recoveryMs y Chrome no se reintentaria jamas.
    for (let t = 0; t < 22000; t += 500) {
      await act(async () => {
        h.local.onresult?.(parcialLocal(`parcial ${t}`, 900))
        await vi.advanceTimersByTimeAsync(500)
      })
    }

    expect(llamadas(installChromeRecognition), 'los parciales bloquearon la recuperacion').toBe(1)
    expect(typeof h.chrome2.onresult, 'Chrome no quedo cableado').toBe('function')
  })
})
