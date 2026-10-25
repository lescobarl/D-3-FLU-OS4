// @vitest-environment jsdom
/**
 * PRODUCTO REAL — el módulo CONVERSACIÓN encendido escribe la fila desde el
 * reconocedor REAL del hook.
 *
 * No se llama `ingestAsr` a mano: se monta `useFluVoiceAssistant`, se inyecta
 * un `SpeechRecognition` falso donde el hook lo adquiere (`api/speech`) y se
 * disparan `onstart`/`onresult` reales. La fila se lee de Dexie con
 * `fake-indexeddb` (la MISMA tabla `conversationFilas` v25 del producto).
 *
 * Dos banderas, un solo escritor:
 *  - `new`     el módulo se compone (1 vez), la fila sale de Dexie y el ingress
 *              legacy NO recibe el resultado;
 *  - `legacy`  el módulo NO se instancia y el ingress legacy SÍ recibe el
 *              resultado; no hay fila en Dexie.
 *
 * La bandera NO se sustituye: se siembra el override de runtime en la URL
 * (`?conversationEngine=new`), que es la vía real de `crearConfigFlu`. El motor,
 * el almacén Dexie y el adaptador de ASR son los reales del módulo; solo se
 * envuelve la fábrica para contar instancias.
 */
import 'fake-indexeddb/auto'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const integration = {
    lastCommittedTranscript: '',
    conversationHistory: [] as unknown[],
    conversationState: 'IDLE',
    speakerHighWater: 0,
  };
  const recognition = {
    lang: '',
    onstart: null as null | (() => void),
    onresult: null as null | ((e: unknown) => void),
    onerror: null as null | ((e: unknown) => void),
    onend: null as null | (() => void),
    stop: vi.fn(),
    start: vi.fn(),
    abort: vi.fn(),
  };
  return {
    integration,
    recognition,
    crearMotorLlamadas: 0,
    setCommitted: vi.fn(),
    ingressPush: vi.fn(),
    acquireSpeechRecognition: vi.fn(),
    startSpeechRecognition: vi.fn(),
    stopSpeechRecognition: vi.fn(),
    listVoiceProfiles: vi.fn(),
    loadSessionState: vi.fn(),
    saveSessionState: vi.fn(),
    saveVoiceProfile: vi.fn(),
    requestFluContract: vi.fn(),
    relayLog: vi.fn(),
    fluEvent: vi.fn(),
    getListenLogRing: vi.fn(() => []),
    clearListenLogRing: vi.fn(),
    logChromeSpeechResult: vi.fn(),
    logCaughtError: vi.fn(),
    fluAsyncErrorHandler: vi.fn(() => vi.fn()),
    createConversationIngressRuntime: vi.fn(),
    wireMicCapturePipeline: vi.fn(),
    startContinuousIdentityPipeline: vi.fn(),
    stopAllContinuousIdentityPipelines: vi.fn(),
    convertSimEventsToMicBursts: vi.fn(() => []),
    createLocalRecognition: vi.fn(),
    shouldUseLocalFallback: vi.fn(() => false),
    createTurnSpeakerAudioResolver: vi.fn(() => ({})),
    peekTurnSpeakerPreflight: vi.fn(() => ({ ready: false })),
    isSelfKnowledgeRequest: vi.fn(() => false),
    noteGameTurn: vi.fn(),
    debugHotPath: false,
    fluDebugHot: vi.fn(),
    getFluDebugApi: vi.fn(() => ({})),
    useFluParticipant: vi.fn(),
    useTurnLifecycleSync: vi.fn(),
    useOffPathSessionWriter: vi.fn(),
  };
});

vi.mock('../src/voice/conversation/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/voice/conversation/index')>()
  return {
    ...actual,
    crearMotorConversacionProducto: (opciones: unknown) => {
      h.crearMotorLlamadas += 1
      return actual.crearMotorConversacionProducto(
        opciones as Parameters<typeof actual.crearMotorConversacionProducto>[0],
      )
    },
  }
})

vi.mock('@huggingface/transformers', () => ({
  env: {},
  AutoProcessor: { from_pretrained: vi.fn() },
  AutoModel: { from_pretrained: vi.fn() },
}));

vi.mock('../src/store/integrationStore', () => {
  const useIntegrationStore = (selector?: (s: unknown) => unknown) =>
    selector ? selector(h.integration) : h.integration;
  (useIntegrationStore as unknown as Record<string, unknown>).getState = () => h.integration;
  (useIntegrationStore as unknown as Record<string, unknown>).setState = () => {};
  (useIntegrationStore as unknown as Record<string, unknown>).subscribe = () => () => {};
  return { useIntegrationStore };
});

vi.mock('../src/voice/lib/fluStorage', () => ({
  listVoiceProfiles: h.listVoiceProfiles,
  loadSessionState: h.loadSessionState,
  saveSessionState: h.saveSessionState,
  saveVoiceProfile: h.saveVoiceProfile,
}));

vi.mock('../src/voice/lib/gemini', () => ({ requestFluContract: h.requestFluContract }));

vi.mock('../src/voice/lib/speechRecognitionLocal', () => ({
  acquireSpeechRecognition: h.acquireSpeechRecognition,
  startSpeechRecognition: h.startSpeechRecognition,
  stopSpeechRecognition: h.stopSpeechRecognition,
}));

vi.mock('../src/voice/lib/micCaptureBridge.js', () => ({
  wireMicCapturePipeline: h.wireMicCapturePipeline,
}));

vi.mock('../src/voice/lib/conversationIngressBridge.js', () => ({
  createConversationIngressRuntime: h.createConversationIngressRuntime,
}));

vi.mock('../src/voice/lib/turnIdentityPipeline.js', () => ({
  startContinuousIdentityPipeline: h.startContinuousIdentityPipeline,
  stopAllContinuousIdentityPipelines: h.stopAllContinuousIdentityPipelines,
}));

vi.mock('../src/voice/lib/micEventProducer.js', () => ({
  convertSimEventsToMicBursts: h.convertSimEventsToMicBursts,
}));

vi.mock('../src/voice/lib/voiceLocalFallback', () => ({
  createLocalRecognition: h.createLocalRecognition,
  shouldUseLocalFallback: h.shouldUseLocalFallback,
  isLocalRecognitionEngine: (engine: unknown) =>
    typeof (engine as { pushAudio?: unknown } | null)?.pushAudio === 'function',
  isLocalFallbackEnabled: vi.fn(() => false),
  prewarmLocalRecognition: vi.fn(() => true),
  installLocalRecognition: vi.fn(() => null),
  installChromeRecognition: vi.fn(() => null),
  getLocalFallbackRuntimeConfig: vi.fn(() => ({ recoveryMs: 20000, recoverySegments: 3, probeMs: 4000, finalMinSpeechLikeMs: 180, partialMinSpeechLikeMs: 300 })),
  resolveSilentDegrade: vi.fn(() => ({ degrade: false, speechLikeMs: 0, rms: 0, voicedMs: 0, sinceSrResultMs: 0, failedRebuilds: 0, log: '' })),
}));

vi.mock('../src/voice/lib/turnSpeakerPreflight.js', () => ({
  createTurnSpeakerAudioResolver: h.createTurnSpeakerAudioResolver,
  peekTurnSpeakerPreflight: h.peekTurnSpeakerPreflight,
  preflightEvidenceMeasured: () => false,
}));

vi.mock('../src/core/selfKnowledge/selfKnowledge', () => ({
  isSelfKnowledgeRequest: h.isSelfKnowledgeRequest,
}));

vi.mock('../src/core/games/gameSessionStore', () => ({ noteGameTurn: h.noteGameTurn }));

vi.mock('../src/hooks/useFluParticipant', () => ({ useFluParticipant: h.useFluParticipant }));

vi.mock('../src/voice/hooks/useTurnInfrastructure', () => ({
  useTurnLifecycleSync: h.useTurnLifecycleSync,
  useOffPathSessionWriter: h.useOffPathSessionWriter,
}));

vi.mock('../src/lib/clientLogRelay', () => ({ relayLog: h.relayLog }));
vi.mock('../src/lib/caughtError', () => ({ logCaughtError: h.logCaughtError }));

vi.mock('../src/voice/lib/fluAsyncError.js', () => ({
  fluAsyncErrorHandler: h.fluAsyncErrorHandler,
}));

vi.mock('../src/voice/lib/listenLog', () => ({
  fluEvent: h.fluEvent,
  logChromeSpeechResult: h.logChromeSpeechResult,
  getListenLogRing: h.getListenLogRing,
  clearListenLogRing: h.clearListenLogRing,
}));

vi.mock('../src/voice/lib/fluDebug', () => ({
  debugHotPath: h.debugHotPath,
  fluDebugHot: h.fluDebugHot,
  getFluDebugApi: h.getFluDebugApi,
}));

import { useFluVoiceAssistant } from '../src/voice/hooks/useFluVoiceAssistant';
import { fluDb } from '../src/core/db/fluDatabase';
import { FLU_CONFIG } from '../src/voice/api/config';

/** Declara las APIs de navegador que el hook considera "soporte". */
function darSoporteNavegador() {
  (window as unknown as Record<string, unknown>).SpeechRecognition = function SpeechRecognition() {};
  (window as unknown as Record<string, unknown>).AudioContext = function AudioContext() {
    return { sampleRate: 48000 };
  };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(() => Promise.reject(new Error('sin micro en test'))) },
  });
}

/** Quita las APIs para dejar el hook en "no soportado". */
function quitarSoporteNavegador() {
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  delete (window as unknown as Record<string, unknown>).AudioContext;
  delete (window as unknown as Record<string, unknown>).webkitAudioContext;
  delete (navigator as unknown as Record<string, unknown>).mediaDevices;
}

/**
 * Siembra el override de runtime del motor en la URL real del documento.
 * Es la vía del E2E: sin localStorage, sin globales y sin tocar el default.
 * @param motor Motor pedido, o `null` para dejar la URL sin override.
 */
function fijarMotorEnUrl(motor: 'new' | 'legacy' | null) {
  const url = new URL(window.location.href)
  if (motor) url.searchParams.set('conversationEngine', motor)
  else url.searchParams.delete('conversationEngine')
  window.history.replaceState(null, '', url.toString())
}

/** Evento de resultado con la forma que entregan Chrome y el motor local. */
function eventoAsr(texto: string, final: boolean): unknown {
  const resultado = { 0: { transcript: texto }, isFinal: final, length: 1 };
  return { resultIndex: 0, results: [resultado] };
}

/** Monta el hook con el dueño de conversación activo (lo fija App en vivo). */
function montar() {
  const conversationActiveRef = { current: true };
  return renderHook(() =>
    useFluVoiceAssistant({
      apiKey: 'k',
      onContractResolved: vi.fn(),
      language: 'es',
      conversationActiveRef,
    } as never),
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await fluDb.conversationFilas.clear();
  fijarMotorEnUrl(null);
  h.crearMotorLlamadas = 0;
  h.integration.lastCommittedTranscript = '';
  h.integration.conversationHistory = [];
  h.integration.speakerHighWater = 0;
  h.setCommitted.mockImplementation((text: string) => {
    h.integration.lastCommittedTranscript = typeof text === 'string' ? text : '';
  });
  (h.integration as unknown as Record<string, unknown>).setLastCommittedTranscript = h.setCommitted;
  (h.integration as unknown as Record<string, unknown>).addConversationEntry = vi.fn();
  h.ingressPush.mockReset();

  Object.assign(h.recognition, {
    lang: '',
    onstart: null,
    onresult: null,
    onerror: null,
    onend: null,
  });
  h.recognition.stop.mockReset();
  h.recognition.start.mockReset();
  h.recognition.abort.mockReset();

  h.acquireSpeechRecognition.mockReset().mockReturnValue(h.recognition);
  h.startSpeechRecognition.mockReset().mockReturnValue(true);
  h.stopSpeechRecognition.mockReset();
  h.listVoiceProfiles.mockReset().mockResolvedValue([]);
  h.loadSessionState.mockReset().mockResolvedValue(null);
  h.saveSessionState.mockReset().mockResolvedValue(undefined);
  h.saveVoiceProfile.mockReset().mockResolvedValue(undefined);
  h.requestFluContract.mockReset().mockResolvedValue({});
  h.relayLog.mockReset();
  h.fluEvent.mockReset();
  h.createConversationIngressRuntime
    .mockReset()
    .mockReturnValue({
      pushSrGapEvent: vi.fn(),
      drainAll: vi.fn(),
      pushMicRecognitionEvent: h.ingressPush,
      pushRecognitionEndEvent: vi.fn(),
      reset: vi.fn(),
    });
  h.wireMicCapturePipeline.mockReset().mockResolvedValue({ zeroGain: { disconnect: vi.fn() } });
  h.useFluParticipant.mockReset().mockReturnValue({
    presentation: { label: 'Participante', show: false },
  });
  h.useTurnLifecycleSync.mockReset().mockReturnValue({
    current: { startTurn: vi.fn(), resetTurn: vi.fn(), markSpeaking: vi.fn(), isWorking: () => false },
  });
  h.useOffPathSessionWriter.mockReset().mockReturnValue({ write: vi.fn() });

  quitarSoporteNavegador();
});

afterEach(() => {
  vi.useRealTimers();
  quitarSoporteNavegador();
});

describe('producto — engine new escribe la fila desde el reconocedor real', () => {
  it('un final del SpeechRecognition produce UNA fila en Dexie, su commit y la caja', async () => {
    fijarMotorEnUrl('new');
    darSoporteNavegador();
    const { result } = montar();
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    await act(async () => {
      await result.current.startListening();
    });
    act(() => h.recognition.onstart?.());

    await act(async () => {
      h.recognition.onresult?.(eventoAsr('ok flu hola mundo', false));
    });
    await waitFor(() => expect(result.current.liveTranscript).toBe('ok flu hola mundo'));
    const caja = result.current.liveTranscript;

    // `stop` del falso dispara `onend`: finalizeRecognition no espera su techo.
    h.recognition.stop.mockImplementation(() => h.recognition.onend?.());
    await act(async () => {
      h.recognition.onresult?.(eventoAsr('ok flu hola mundo', true));
    });
    // Caso de caja del replay 2026-10-19: al comprometerse la frase, la caja
    // se vacía en el acto y no queda nada que la repinte.
    await waitFor(() => expect(result.current.liveTranscript).toBe(''));
    // Reentrega del MISMO final (Chrome lo repite): no añade una segunda fila.
    await act(async () => {
      h.recognition.onresult?.(eventoAsr('ok flu hola mundo', true));
    });
    await act(async () => {
      await result.current.stopListening({ closing: true });
    });

    await waitFor(async () => {
      const filas = await fluDb.conversationFilas.toArray();
      expect(filas).toHaveLength(1);
    });
    const filas = await fluDb.conversationFilas.toArray();
    const fila = filas[0];
    if (!fila) throw new Error('sin fila persistida');

    expect(h.crearMotorLlamadas).toBe(1);
    expect(fila).toMatchObject({
      texto: 'ok flu hola mundo',
      provisional: false,
      sync: { revision: 1, deleted: false },
    });
    expect(fila.sync.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fila.locutionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(fila.etiqueta).toBe(FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker);
    expect(fila.etiqueta).not.toContain('?');
    // Caja = fila: la frase de la caja es exactamente la frase de la fila.
    expect(caja).toBe(fila.texto);
    // UN `row.committed`: el módulo es el ÚNICO que compromete la frase.
    expect(h.setCommitted).toHaveBeenCalledTimes(1);
    expect(h.setCommitted).toHaveBeenCalledWith(fila.texto);
    // La MISMA fila se proyecta al historial visible (una entrada, con su etiqueta).
    expect(
      (h.integration as unknown as { addConversationEntry: ReturnType<typeof vi.fn> })
        .addConversationEntry,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        id: fila.locutionId,
        role: 'user',
        text: fila.texto,
        speakerName: fila.etiqueta,
      }),
    );
    // Solo los finales alimentan el ingress (comandos); la fila es una sola y la
    // escribe el módulo, así que no hay dos escritores. La reentrega del mismo
    // final la deduplica el ingress, no este handler.
    expect(h.ingressPush).toHaveBeenCalled();
  });
});

describe('producto — engine legacy no instancia el módulo', () => {
  it('el resultado va al ingress legacy y Dexie queda vacía', async () => {
    fijarMotorEnUrl('legacy');
    darSoporteNavegador();
    const { result } = montar();
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    await act(async () => {
      await result.current.startListening();
    });
    act(() => h.recognition.onstart?.());
    await act(async () => {
      h.recognition.onresult?.(eventoAsr('ok flu hola mundo', true));
    });

    expect(h.crearMotorLlamadas).toBe(0);
    expect(h.ingressPush).toHaveBeenCalledTimes(1);
    expect(h.setCommitted).not.toHaveBeenCalled();
    expect(await fluDb.conversationFilas.count()).toBe(0);
  });
});
