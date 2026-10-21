// @vitest-environment jsdom
// ============================================================
// voiceLocalResultGate - un final del motor LOCAL sin HABLA no se emite
// ------------------------------------------------------------
// DEFECTO MEDIDO (2026-10-20): con Whisper degradado por una pausa con ruido, el
// motor local emitia finales alucinados con palabras reales ("¡Y si!", "¿Qué son
// la brua?", "¡Tuna suma! ¡Uy a lo que no!"); garbageTranscript (B3) los conserva
// a proposito, asi que el gate tiene que ser ACUSTICO (metrics del motor).
//
// Se monta el HOOK real (frontera: reconocedor del navegador, micro, red, almacen).
// Se simula la degradacion por 'network' y se emiten resultados del MOTOR LOCAL:
//   - final con speechLikeMs < 180 SIN wake -> descarte con motivo `not-speech`;
//   - parcial con speechLikeMs < 300        -> no se emite (se registra el motivo);
//   - 'ok flu' corto                        -> se conserva (la wake manda);
//   - el mismo evento por CHROME            -> no se gatea (es del motor local).
// ============================================================
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const integration = {
    lastCommittedTranscript: '',
    conversationHistory: [] as unknown[],
    conversationState: 'IDLE',
  }
  const recognition = {
    lang: '',
    onstart: null as null | (() => void),
    onresult: null as null | ((e: unknown) => void),
    onerror: null as null | ((e: unknown) => void),
    onend: null as null | (() => void),
    stop: vi.fn(),
    start: vi.fn(),
    abort: vi.fn(),
  }
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
  return { integration, recognition, local }
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

vi.mock('../src/voice/lib/speechRecognitionLocal', () => ({
  acquireSpeechRecognition: vi.fn(() => h.recognition),
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

// Frontera: el MOTOR LOCAL. Se instala el fake y se cablea como el real, para que
// el hook reciba los eventos del motor local por el MISMO pipeline.
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
    installChromeRecognition: vi.fn(() => null),
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
vi.mock('../src/voice/lib/fluTrace.js', () => ({ fluTrace: vi.fn() }))
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
vi.mock('../src/voice/lib/micEventProducer.js', async (original) => ({
  ...((await original()) as object),
  convertSimEventsToMicBursts: vi.fn(() => []),
}))

import { useFluVoiceAssistant } from '../src/voice/hooks/useFluVoiceAssistant'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import { relayLog } from '../src/lib/clientLogRelay'

/** Evento del motor con la forma de Chrome + la evidencia acustica del local. */
function localEvent(transcript: string, metrics: { speechLikeMs: number; durationMs?: number; rms?: number }, isFinal = true) {
  return {
    resultIndex: 0,
    results: [{ isFinal, 0: { transcript, confidence: 1 }, length: 1 }],
    metrics: { durationMs: metrics.durationMs ?? 1200, speechLikeMs: metrics.speechLikeMs, rms: metrics.rms ?? 0.05 },
  }
}

function chromeEvent(transcript: string, isFinal = true) {
  return { resultIndex: 0, results: [{ isFinal, 0: { transcript, confidence: 1 }, length: 1 }] }
}

function descartes(motivo = 'not-speech') {
  return (relayLog as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .map((c) => String(c[2] ?? ''))
    .filter((m) => m.includes('motivo=' + motivo))
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

/** Arranca la escucha y DEGRADA al motor local por un error 'network' de Chrome. */
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
  expect(typeof h.local.onresult, 'la degradacion no ocurrio: el gate no se puede medir').toBe('function')
  vistaActiva = vista
  return vista
}

let vistaActiva: { unmount: () => void } | null = null

beforeEach(() => {
  // Este bloque mide el GATE: habilita el fallback local que en produccion
  // esta apagado (Chrome-only, backup `rescate/wip-pre-s9`).
  FLU_CONFIG.voiceIdentity.capture.recognition.localFallbackEnabled = true
  vi.useFakeTimers()
  vi.clearAllMocks()
  h.integration.lastCommittedTranscript = ''
  h.integration.conversationHistory = []
  ;(h.integration as unknown as Record<string, unknown>).setLastCommittedTranscript = () => {}
  Object.assign(h.recognition, { lang: '', onstart: null, onresult: null, onerror: null, onend: null })
  Object.assign(h.local, { onstart: null, onresult: null, onerror: null, onend: null })
  darSoporteNavegador()
})

afterEach(() => {
  vistaActiva?.unmount()
  vistaActiva = null
  vi.useRealTimers()
})

describe('gate de finales/parciales del motor LOCAL', () => {
  it('un final de ruido con PALABRAS REALES no se emite (motivo not-speech)', async () => {
    await arrancarYdegradar()
    for (const frase of ['¡Y si!', '¿Qué son la brua?', '¡Tuna suma! ¡Uy a lo que no!']) {
      await act(async () => {
        h.local.onresult?.(localEvent(frase, { speechLikeMs: 40 }))
        await Promise.resolve()
      })
    }
    const descartadas = descartes('not-speech').join(' | ')
    expect(descartadas).toContain('¡Y si!')
    expect(descartadas).toContain('¿Qué son la brua?')
    expect(descartadas).toContain('¡Tuna suma!')
  })

  it('un final con evidencia de habla SI se conserva', async () => {
    await arrancarYdegradar()
    await act(async () => {
      h.local.onresult?.(localEvent('pon musica suave', { speechLikeMs: 900 }))
      await Promise.resolve()
    })
    expect(descartes('not-speech').join(' | ')).not.toContain('pon musica suave')
  })

  it("excepcion 'ok flu' corto: la wake manda y NO se descarta", async () => {
    await arrancarYdegradar()
    await act(async () => {
      h.local.onresult?.(localEvent('ok flu', { speechLikeMs: 0, durationMs: 400 }))
      await Promise.resolve()
    })
    expect(descartes('not-speech').join(' | ')).not.toContain('ok flu')
  })

  it('los parciales de ruido no se emiten (se registra el motivo)', async () => {
    await arrancarYdegradar()
    await act(async () => {
      h.local.onresult?.(localEvent('la transcripcion desde', { speechLikeMs: 20 }, false))
      await Promise.resolve()
    })
    const logs = (relayLog as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[2] ?? ''))
    expect(logs.some((m) => m.includes('parcial DESCARTADO') && m.includes('not-speech'))).toBe(true)
  })

  it('el detector NO gatea a Chrome: el mismo evento sin metrics pasa', async () => {
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
    await act(async () => {
      h.recognition.onresult?.(chromeEvent('¡Y si!'))
      await Promise.resolve()
    })
    vistaActiva = vista
    expect(descartes('not-speech')).toHaveLength(0)
  })
})
