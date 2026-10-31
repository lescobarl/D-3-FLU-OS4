// @vitest-environment jsdom
// ============================================================
// Contrato de la RAMA PASIVA del hook (decisión A, 2026-10-26)
// ------------------------------------------------------------
// La decisión de hablante en modo pasivo la toma el RESOLVER del módulo
// (`crearResolucionPasivaProducto`, decisión A del dueño): UNA medida por
// turno, sin estado, y la CADENA de evidencia (voz anterior, vector, contador
// de voces) la conserva el hook entre llamadas. Este test monta el hook REAL
// y sustituye SOLO la frontera del resolver del módulo: se prueban el
// contrato de delegación (qué recibe el resolver), la continuidad de la
// cadena y los fallbacks ciegos (`blindSpeakerFallback`, dueño único).
// ============================================================
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Vector que devolverá el embedder en la siguiente llamada (frontera simulada). */
  embedding: { vector: [1, 0, 0, 0] as number[] },
  relayLog: vi.fn(),
  /** Resolver pasivo controlable: sustituye SOLO la frontera del módulo. */
  resolver: vi.fn(),
}))

vi.mock('../src/voice/lib/speakerEmbedding.js', () => ({
  preloadSpeakerEmbeddingModel: vi.fn(() => Promise.resolve()),
  getSpeakerEmbeddingModelStatus: vi.fn(() => ({ ready: true })),
  computeSpeakerEmbedding: vi.fn(async () => [...h.embedding.vector]),
  embedAudioForDiarization: vi.fn(async () => null),
  preloadVoiceIdWorker: vi.fn(() => Promise.resolve()),
  resolveSpeakerFromAudio: vi.fn(async () => null),
}))

vi.mock('@huggingface/transformers', () => ({
  env: {},
  AutoProcessor: { from_pretrained: vi.fn() },
  AutoModel: { from_pretrained: vi.fn() },
}))

vi.mock('../src/store/integrationStore', () => {
  const state = { conversationHistory: [] as unknown[] }
  const useIntegrationStore = (selector?: (s: unknown) => unknown) =>
    selector ? selector(state) : state
  ;(useIntegrationStore as unknown as Record<string, unknown>).getState = () => state
  ;(useIntegrationStore as unknown as Record<string, unknown>).setState = () => {}
  ;(useIntegrationStore as unknown as Record<string, unknown>).subscribe = () => () => {}
  return { useIntegrationStore }
})

vi.mock('../src/voice/lib/fluStorage', () => ({
  loadSessionState: vi.fn(async () => null),
  saveSessionState: vi.fn(async () => undefined),
}))
vi.mock('../src/voice/lib/gemini', () => ({ requestFluContract: vi.fn(async () => ({})) }))
vi.mock('../src/voice/lib/speechRecognitionLocal', () => ({
  acquireSpeechRecognition: vi.fn(() => null),
  startSpeechRecognition: vi.fn(() => true),
  stopSpeechRecognition: vi.fn(),
  getRecognitionLanguage: vi.fn((l: unknown) => (l === 'en' ? 'en-US' : 'es-ES')),
  isBilingualListenMode: vi.fn((l: unknown) => l === 'both'),
  resolveRecognitionLocale: vi.fn((l: unknown) => (l === 'en' ? 'en-US' : 'es-ES')),
}))
vi.mock('../src/voice/lib/micCaptureBridge.js', () => ({ wireMicCapturePipeline: vi.fn(async () => ({ zeroGain: { disconnect: vi.fn() } })) }))
vi.mock('../src/voice/lib/voiceLocalFallback', () => ({
  createLocalRecognition: vi.fn(),
  shouldUseLocalFallback: vi.fn(() => false),
  isLocalFallbackEnabled: vi.fn(() => false),
  isLocalRecognitionEngine: (engine: any) => typeof engine?.pushAudio === 'function',
  prewarmLocalRecognition: vi.fn(() => true),
  installLocalRecognition: vi.fn(() => null),
  installChromeRecognition: vi.fn(() => null),
  getLocalFallbackRuntimeConfig: vi.fn(() => ({ recoveryMs: 20000, recoverySegments: 3, probeMs: 4000, finalMinSpeechLikeMs: 180, partialMinSpeechLikeMs: 300 })),
  resolveSilentDegrade: vi.fn(() => ({ degrade: false, speechLikeMs: 0, rms: 0, voicedMs: 0, sinceSrResultMs: 0, failedRebuilds: 0, log: '' })),
}))
vi.mock('../src/core/games/gameSessionStore', () => ({ noteGameTurn: vi.fn() }))
vi.mock('../src/hooks/useFluParticipant', () => ({
  useFluParticipant: vi.fn(() => ({ presentation: { label: 'Participante', show: false } })),
}))
vi.mock('../src/voice/hooks/useTurnInfrastructure', () => ({
  useTurnLifecycleSync: vi.fn(() => ({ current: { startTurn: vi.fn(), resetTurn: vi.fn(), markSpeaking: vi.fn(), isWorking: () => false } })),
  useOffPathSessionWriter: vi.fn(() => ({ write: vi.fn() })),
}))
vi.mock('../src/lib/clientLogRelay', () => ({ relayLog: h.relayLog }))
vi.mock('../src/lib/caughtError', () => ({ logCaughtError: vi.fn() }))
vi.mock('../src/voice/lib/fluAsyncError.js', () => ({ fluAsyncErrorHandler: vi.fn(() => vi.fn()) }))
vi.mock('../src/voice/lib/listenLog', () => ({
  fluEvent: vi.fn(),
  logChromeSpeechResult: vi.fn(),
  getListenLogRing: vi.fn(() => []),
  clearListenLogRing: vi.fn(),
}))
vi.mock('../src/voice/lib/fluDebug', () => ({
  debugHotPath: false,
  fluDebugHot: vi.fn(),
  getFluDebugApi: vi.fn(() => ({})),
}))

// FRONTERA DEL MÓDULO (decisión A): todo lo demás del módulo es REAL; solo se
// sustituye la fábrica del resolver pasivo por el stub controlable de `h`.
vi.mock('../src/voice/conversation/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/voice/conversation/index')>()
  return {
    ...actual,
    crearResolucionPasivaProducto: () => h.resolver,
  }
})

import { useFluVoiceAssistant } from '../src/voice/hooks/useFluVoiceAssistant'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig'

const SR = 16000
/** Vector unitario en la posición `i` (dim 8; el dueño solo exige medición). */
function vectorEn(i: number): number[] {
  const v = new Array(8).fill(0)
  v[i] = 1
  return v
}
/** Tono senoidal de `segundos` a amplitud 0.5: RMS ~0.35, muy sobre el VAD (0.02). */
function audioVoz(segundos: number): Float32Array {
  const n = Math.round(SR * segundos)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i += 1) out[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR)
  return out
}
/** Argumento que el hook entregó al resolver del módulo en la llamada `i`. */
function argResolver(i: number): Record<string, unknown> {
  const call = h.resolver.mock.calls[i]
  return call ? (call[0] as Record<string, unknown>) : {}
}

function montar() {
  return renderHook(() => useFluVoiceAssistant({ apiKey: 'k', language: 'es' } as never))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.embedding.vector = vectorEn(0)
})

describe('modo pasivo — la decisión de hablante la toma el resolver del MÓDULO (decisión A)', () => {
  const H1 = FLU_CONFIG.voiceIdentity.labels.template.replace('{n}', '1')
  const H2 = FLU_CONFIG.voiceIdentity.labels.template.replace('{n}', '2')
  const VEC0 = vectorEn(0)
  const VEC1 = vectorEn(1)

  it('la primera voz pasiva delega la decisión en el resolver del módulo y estampa su etiqueta', async () => {
    h.resolver.mockResolvedValueOnce({ vozId: 'voz-1', hablante: H1, continuidad: false, evidencia: true, vector: VEC0 })
    const { result } = montar()
    await waitFor(() => expect(typeof result.current.resolveSpeaker).toBe('function'))

    const audio = audioVoz(1)
    const r = await result.current.resolveSpeaker('abre la configuracion', audio, SR, 'FLU')

    expect(h.resolver).toHaveBeenCalledTimes(1)
    const arg = argResolver(0)
    // Contrato de delegación: el audio CRUDO del turno, la frecuencia y la
    // cadena de evidencia (vacía en la primera medida).
    expect(arg.muestras).toBe(audio)
    expect(arg.sampleRate).toBe(SR)
    expect(arg.plantillas).toEqual([])
    expect(arg.contadorVoces).toBe(0)
    expect(r.speakerName).toBe(H1)
    expect(r.resolvedSpeakerName).toBe(H1)
    // La evidencia la DECLARA el resolver (medida del EmbebedorPort): se propaga.
    expect(r.evidenciaAcustica).toBe(true)
  })

  it('la continuidad la conserva la CADENA del hook: la 2ª medida recibe la voz anterior y no abre etiqueta nueva', async () => {
    h.resolver
      .mockResolvedValueOnce({ vozId: 'voz-1', hablante: H1, continuidad: false, evidencia: true, vector: VEC0 })
      .mockResolvedValueOnce({ vozId: 'voz-1', hablante: H1, continuidad: true, evidencia: true, vector: VEC0 })
    const { result } = montar()
    await waitFor(() => expect(typeof result.current.resolveSpeaker).toBe('function'))

    const primero = await result.current.resolveSpeaker('apaga la luz', audioVoz(1), SR, 'FLU')
    const segundo = await result.current.resolveSpeaker('sube el volumen', audioVoz(1), SR, 'FLU')

    const arg = argResolver(1)
    expect(arg.plantillas).toEqual([{ vozId: 'voz-1', vector: VEC0, etiqueta: H1 }])
    // La continuidad NO abre voz nueva: el contador sigue en 1 (la 1ª medida
    // abrió la voz y solo una voz NUEVA lo incrementa).
    expect(arg.contadorVoces).toBe(1)
    expect(segundo.speakerName).toBe(primero.speakerName)
    expect(segundo.evidenciaAcustica).toBe(true)
  })

  it('una voz distinta abre "Hablante 2" y el contador de voces avanza para la medida siguiente', async () => {
    h.resolver
      .mockResolvedValueOnce({ vozId: 'voz-1', hablante: H1, continuidad: false, evidencia: true, vector: VEC0 })
      .mockResolvedValueOnce({ vozId: 'voz-2', hablante: H2, continuidad: false, evidencia: true, vector: VEC1 })
    const { result } = montar()
    await waitFor(() => expect(typeof result.current.resolveSpeaker).toBe('function'))

    const primero = await result.current.resolveSpeaker('empieza el minuto', audioVoz(1), SR, 'FLU')
    const otro = await result.current.resolveSpeaker('pon el temporizador', audioVoz(1), SR, 'FLU')

    expect(primero.speakerName).toBe(H1)
    expect(otro.speakerName).toBe(H2)
    // La primera medida abrió una voz nueva: la medida siguiente ya recibe 1.
    expect(argResolver(1).contadorVoces).toBe(1)
  })

  it('sin audio NO hay medición: fallback ciego y el resolver del módulo NO se llama', async () => {
    const { result } = montar()
    await waitFor(() => expect(typeof result.current.resolveSpeaker).toBe('function'))

    const r = await result.current.resolveSpeaker('hola', new Float32Array(0), SR, 'FLU')

    expect(h.resolver).not.toHaveBeenCalled()
    // blindSpeakerFallback('FLU'): 'FLU' NO es nombre propio (dueño único
    // `isProperSpeakerName`) → se conserva; no se inventa una etiqueta.
    expect(r.speakerName).toBe('FLU')
    expect(r.resolvedSpeakerName).toBe('FLU')
    expect(r.evidenciaAcustica).toBe(false)
    expect(h.relayLog.mock.calls.some((c) => c[1] === 'SpeakerTrace')).toBe(true)
  })

  it('sin wake, "soy X" NO infiere nombre (política del dueño único resolveSpeakerNameFromUtterance)', async () => {
    h.resolver.mockResolvedValueOnce({ vozId: 'voz-1', hablante: H1, continuidad: false, evidencia: true, vector: VEC0 })
    const { result } = montar()
    await waitFor(() => expect(typeof result.current.resolveSpeaker).toBe('function'))

    const r = await result.current.resolveSpeaker('soy luis', audioVoz(1), SR, 'FLU')

    // requireWakeWordForSpeakerName: true -> sin wake no hay nombre propio (auditoria 2026-10-23).
    expect(r.introducedName).toBe('')
    expect(r.speakerName).toBe(H1)
    expect(r.resolvedSpeakerName).toBe(H1)
    expect(r.speakerAlias).toBeNull()
  })

  it('sin evidencia del resolver: fallback ciego sin evidencia acustica y la cadena NO avanza', async () => {
    h.resolver
      .mockResolvedValueOnce({ vozId: 'voz-1', hablante: H1, continuidad: false, evidencia: true, vector: VEC0 })
      .mockResolvedValueOnce({ vozId: '', hablante: '', continuidad: false, evidencia: false, vector: null })
    const { result } = montar()
    await waitFor(() => expect(typeof result.current.resolveSpeaker).toBe('function'))

    const primero = await result.current.resolveSpeaker('hola', audioVoz(1), SR, 'FLU')
    expect(primero.speakerName).toBe(H1)

    // La medida falló: el hook degrada a ciego (la última voz resuelta, no un nombre inventado).
    const r = await result.current.resolveSpeaker('adios', audioVoz(1), SR, 'FLU')
    expect(r.speakerName).toBe(H1)
    expect(r.evidenciaAcustica).toBe(false)

    // Y la cadena NO avanzó: la medida siguiente recibe la MISMA voz y el MISMO contador.
    h.resolver.mockResolvedValueOnce({ vozId: 'voz-2', hablante: H2, continuidad: false, evidencia: true, vector: VEC1 })
    const tercera = await result.current.resolveSpeaker('otra frase', audioVoz(1), SR, 'FLU')
    const arg = argResolver(2)
    expect(arg.plantillas).toEqual([{ vozId: 'voz-1', vector: VEC0, etiqueta: H1 }])
    expect(arg.contadorVoces).toBe(1)
    expect(tercera.speakerName).toBe(H2)
  })
})
