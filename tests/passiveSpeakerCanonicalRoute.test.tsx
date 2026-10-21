// @vitest-environment jsdom
// ============================================================
// Regresión de la DIARIZACIÓN EN MODO PASIVO (2026-10-20)
// ------------------------------------------------------------
// Antes el modo pasivo tenía UN SEGUNDO resolver (`matchSegmentNames`) con sus
// PROPIOS umbrales (1 - clusterMatchMaxDistance), su propia base de perfiles y
// su propio `distanceToLast`: dos rutas que decidían lo mismo sobre la MISMA
// señal. Esta prueba ejercita la rama pasiva REAL del hook contra el DUEÑO
// CANÓNICO (`resolveSpeakerIdentityFromVector` → `resolveConversationSpeaker`).
//
// Se sustituye SOLO la frontera del modelo de embeddings (el artefacto WASM no
// corre en CI); el resolver, los umbrales, los clusters y los refs son los
// reales. Prueba de que se toma la ruta canónica: la línea `Identity` del log
// solo la emite `resolveSpeakerIdentityFromVector`.
// ============================================================
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Vector que devolverá el embedder en la siguiente llamada (frontera simulada). */
  embedding: { vector: [1, 0, 0, 0] as number[] },
  relayLog: vi.fn(),
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
}))
vi.mock('../src/voice/lib/micCaptureBridge.js', () => ({ wireMicCapturePipeline: vi.fn(async () => ({ zeroGain: { disconnect: vi.fn() } })) }))
vi.mock('../src/voice/lib/conversationIngressBridge.js', () => ({
  createConversationIngressRuntime: vi.fn(() => ({ pushSrGapEvent: vi.fn(), drainAll: vi.fn() })),
}))
vi.mock('../src/voice/lib/turnIdentityPipeline.js', () => ({
  startContinuousIdentityPipeline: vi.fn(),
  stopAllContinuousIdentityPipelines: vi.fn(),
  primeTurnSpeakerPreflight: vi.fn(async () => {}),
}))
vi.mock('../src/voice/lib/micEventProducer.js', () => ({ convertSimEventsToMicBursts: vi.fn(() => []) }))
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
vi.mock('../src/voice/lib/turnSpeakerPreflight.js', () => ({
  createTurnSpeakerAudioResolver: vi.fn(() => ({})),
  peekTurnSpeakerPreflight: vi.fn(() => ({ ready: false })),
  preflightEvidenceMeasured: vi.fn(() => false),
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
/** Lineas emitidas por el ÚNICO dueño de la identidad (`resolveSpeakerIdentityFromVector`). */
function lineasIdentity(): string[] {
  return h.relayLog.mock.calls
    .filter((call) => call[1] === 'Identity')
    .map((call) => String(call[2] ?? ''))
}

function montar() {
  return renderHook(() => useFluVoiceAssistant({ apiKey: 'k', language: 'es' } as never))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.embedding.vector = vectorEn(0)
})

describe('modo pasivo — UNA sola decisión de hablante (dueño canónico)', () => {
  it('la primera voz pasiva abre el cluster por el resolutor canónico (línea Identity, boundary=false)', async () => {
    const { result } = montar()
    await waitFor(() => expect(typeof result.current.resolveSpeaker).toBe('function'))

    const r = await result.current.resolveSpeaker(
      'abre la configuracion',
      audioVoz(1),
      SR,
      'FLU',
    )

    const identity = lineasIdentity()
    expect(identity, 'la rama pasiva NO pasó por resolveSpeakerIdentityFromVector').toHaveLength(1)
    expect(identity[0]).toContain('boundary=false')
    expect(r.speakerName).toBe(FLU_CONFIG.voiceIdentity.labels.template.replace('{n}', '1'))
    expect(r.resolvedSpeakerName).toBe(r.speakerName)
    // `new-cluster`/`no-vector` no son "coincidencia medida" → la fila no estampa nombre propio.
    expect(r.evidenciaAcustica).toBe(false)
  })

  it('la continuidad sin turno abierto la resuelve el dueño (2ª llamada, MISMA voz, sin etiqueta nueva)', async () => {
    const { result } = montar()
    await waitFor(() => expect(typeof result.current.resolveSpeaker).toBe('function'))

    h.embedding.vector = vectorEn(0)
    const primero = await result.current.resolveSpeaker('apaga la luz', audioVoz(1), SR, 'FLU')
    const segundo = await result.current.resolveSpeaker('sube el volumen', audioVoz(1), SR, 'FLU')

    expect(segundo.speakerName).toBe(primero.speakerName)
    expect(lineasIdentity()[1]).toContain(`reason=cluster-match`)
    // La continuidad ya NO vive en un `distanceToLast` local (borrado): la decide el dueño.
    expect(segundo.evidenciaAcustica).toBe(false)
  })

  it('una voz distinta con ventana sostenida abre "Hablante 2" por el dueño', async () => {
    const { result } = montar()
    await waitFor(() => expect(typeof result.current.resolveSpeaker).toBe('function'))

    const primero = await result.current.resolveSpeaker('empieza el minuto', audioVoz(1), SR, 'FLU')
    // Vector ORTOGONAL (coseno 0) + ventana por encima de conversationMinVoicedForNewMs.
    h.embedding.vector = vectorEn(1)
    const otro = await result.current.resolveSpeaker('pon el temporizador', audioVoz(2.6), SR, 'FLU')

    expect(primero.speakerName).toBe(FLU_CONFIG.voiceIdentity.labels.template.replace('{n}', '1'))
    expect(otro.speakerName).toBe(FLU_CONFIG.voiceIdentity.labels.template.replace('{n}', '2'))
    expect(lineasIdentity()[1]).toContain('reason=new-cluster')
  })

  it('sin audio NO hay medición: devuelve el respaldo y no emite la línea del dueño', async () => {
    const { result } = montar()
    await waitFor(() => expect(typeof result.current.resolveSpeaker).toBe('function'))

    const r = await result.current.resolveSpeaker('hola', new Float32Array(0), SR, 'FLU')

    expect(r.speakerName).toBe('FLU')
    expect(r.resolvedSpeakerName).toBe('FLU')
    expect(lineasIdentity()).toHaveLength(0)
  })

  it('el alias "soy X" sigue en la misma rama y no depende de voiceProfiles', async () => {
    const { result } = montar()
    await waitFor(() => expect(typeof result.current.resolveSpeaker).toBe('function'))

    const r = await result.current.resolveSpeaker('soy luis', audioVoz(1), SR, 'FLU')

    expect(r.introducedName).toBe('Luis')
    // `speakerName` es lo que midió el dueño; `resolvedSpeakerName` trae la etiqueta de la frase.
    expect(r.speakerName).toBe(FLU_CONFIG.voiceIdentity.labels.template.replace('{n}', '1'))
    expect(r.resolvedSpeakerName).toBe('Luis')
    expect(r.speakerAlias).toBe(r.speakerName)
    expect(lineasIdentity()).toHaveLength(1)
  })
})

describe('modo pasivo — la rama pasiva no tiene decisor propio', () => {
  it('dos voces distintas sin ventana sostenida NO abren cluster nuevo (piso del dueño)', async () => {
    const { result } = montar()
    await waitFor(() => expect(typeof result.current.resolveSpeaker).toBe('function'))

    await result.current.resolveSpeaker('hola', audioVoz(1), SR, 'FLU')
    h.embedding.vector = vectorEn(1)
    // 1 s < conversationMinVoicedForNewMs (2200 ms): el dueño conserva la etiqueta.
    const r = await result.current.resolveSpeaker('adios', audioVoz(1), SR, 'FLU')

    expect(r.speakerName).toBe(FLU_CONFIG.voiceIdentity.labels.template.replace('{n}', '1'))
  })
})
