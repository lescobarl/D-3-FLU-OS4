// @vitest-environment jsdom
/**
 * PRODUCTO REAL — el módulo CONVERSACIÓN encendido escribe la fila desde el
 * reconocedor REAL del hook.
 *
 * No se llama `ingestAsr` a mano: se monta `useFluVoiceAssistant`, se inyecta
 * un `SpeechRecognition` falso donde el hook lo adquiere (`api/speech`) y se
 * disparan `onstart`/`onresult` reales. La fila se lee de Dexie con
 * `fake-indexeddb` (la MISMA tabla `conversations` v26 del producto).
 *
 * PCM REAL: el módulo deriva la identidad de la locución del tramo de audio
 * (`ingestaAudio`), así que el arnés entrega bloques PCM con voz por el MISMO
 * callback del capture (`onRawPcmBlock`, dominio CRUDO pre-ganancia: el piso
 * del VAD está calibrado ahí) que usa el producto. Sin audio, el texto
 * es huérfano y NO hay fila: eso es el contrato, no un detalle del test.
 *
 * Un solo motor, un solo escritor: el módulo se compone (1 vez), la fila sale
 * de Dexie y el ingress legacy SOLO recibe los finales para comandos; sus filas
 * ya no se publican (el emisor legacy de conversación está cortado).
 *
 * El motor, el almacén Dexie y el adaptador de ASR son los reales del módulo;
 * solo se envuelve la fábrica para contar instancias.
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
    activePersonId: 'user-a',
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
    pcm: null as null | ((input: Float32Array, meta?: { sampleIndex?: number }) => void),
    setCommitted: vi.fn(),
    acquireSpeechRecognition: vi.fn(),
    startSpeechRecognition: vi.fn(),
    stopSpeechRecognition: vi.fn(),
    getRecognitionLanguage: vi.fn((language: unknown) => (language === 'en' ? 'en-US' : 'es-ES')),
    isBilingualListenMode: vi.fn((language: unknown) => language === 'both'),
    resolveRecognitionLocale: vi.fn((language: unknown) => (language === 'en' ? 'en-US' : 'es-ES')),
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
    wireMicCapturePipeline: vi.fn(),
    createLocalRecognition: vi.fn(),
    shouldUseLocalFallback: vi.fn(() => false),
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
  getRecognitionLanguage: h.getRecognitionLanguage,
  isBilingualListenMode: h.isBilingualListenMode,
  resolveRecognitionLocale: h.resolveRecognitionLocale,
}));

vi.mock('../src/voice/lib/micCaptureBridge.js', () => ({
  wireMicCapturePipeline: h.wireMicCapturePipeline,
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
import { getVadEnergyThreshold } from '../src/voice/lib/asr/asrConfig';

/** Declara las APIs de navegador que el hook considera "soporte". */
function darSoporteNavegador() {
  (window as unknown as Record<string, unknown>).SpeechRecognition = function SpeechRecognition() {};
  // AudioContext falso con lo que el hook usa al cablear la captura pasiva.
  (window as unknown as Record<string, unknown>).AudioContext = function AudioContext() {
    return {
      sampleRate: 48000,
      resume: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      createMediaStreamSource: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      createGain: vi.fn(() => ({
        gain: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      createAnalyser: vi.fn(() => ({
        fftSize: 0,
        smoothingTimeConstant: 0,
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
    };
  };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
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

/** Evento de resultado con la forma que entregan Chrome y el motor local. */
function eventoAsr(texto: string, final: boolean): unknown {
  const resultado = { 0: { transcript: texto }, isFinal: final, length: 1 };
  return { resultIndex: 0, results: [resultado] };
}

const SR_PCM = 48000
let pcmIndex = 0

/** Bloque con VOZ: RMS cuatro veces por encima del piso REAL del VAD. */
function bloqueVoz(ms: number): Float32Array {
  const n = Math.round((SR_PCM * ms) / 1000);
  const muestras = new Float32Array(n);
  const amplitud = Math.sqrt(2) * getVadEnergyThreshold() * 4;
  for (let i = 0; i < n; i += 1) {
    muestras[i] = Math.sin((2 * Math.PI * 220 * i) / SR_PCM) * amplitud;
  }
  return muestras;
}

/**
 * Entrega PCM con voz por el MISMO callback del capture que usa el producto.
 * El tramo de audio es la identidad de la locución: sin este bloque el texto
 * del reconocedor queda huérfano y no puede nacer una fila.
 */
async function alimentarVoz(ms = 300): Promise<void> {
  await waitFor(() => expect(h.pcm).not.toBeNull());
  await act(async () => {
    h.pcm?.(bloqueVoz(ms), { sampleIndex: pcmIndex });
    pcmIndex += Math.round((SR_PCM * ms) / 1000);
  });
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
  await fluDb.conversations.clear();
  h.crearMotorLlamadas = 0;
  h.pcm = null;
  pcmIndex = 0;
  h.integration.lastCommittedTranscript = '';
  h.integration.conversationHistory = [];
  h.integration.speakerHighWater = 0;
  h.setCommitted.mockImplementation((text: string) => {
    h.integration.lastCommittedTranscript = typeof text === 'string' ? text : '';
  });
  (h.integration as unknown as Record<string, unknown>).setLastCommittedTranscript = h.setCommitted;
  (h.integration as unknown as Record<string, unknown>).addConversationEntry = vi.fn();

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
  h.wireMicCapturePipeline.mockReset().mockImplementation(
    async (opciones: { onRawPcmBlock?: typeof h.pcm }) => {
      h.pcm = opciones.onRawPcmBlock ?? null;
      return { zeroGain: { disconnect: vi.fn() } };
    },
  );
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
  vi.restoreAllMocks();
  quitarSoporteNavegador();
});

describe('producto — engine new escribe la fila desde el reconocedor real', () => {
  it('un final del SpeechRecognition produce UNA fila en Dexie, su commit y la caja', async () => {
    darSoporteNavegador();
    const put = vi.spyOn(fluDb.conversations, 'put');
    const { result } = montar();
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    await act(async () => {
      await result.current.startListening();
    });
    act(() => h.recognition.onstart?.());

    await alimentarVoz();
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
    // Un final de SEGMENTO del reconocedor NO cierra la locución: la caja sigue
    // viva y no hay fila; el cierre real es el `onend`/VAD.
    await waitFor(() => expect(result.current.liveTranscript).toBe('ok flu hola mundo'));
    expect(await fluDb.conversations.count()).toBe(0);
    // Reentrega del MISMO final (Chrome lo repite): no añade una segunda fila.
    await act(async () => {
      h.recognition.onresult?.(eventoAsr('ok flu hola mundo', true));
    });
    expect(await fluDb.conversations.count()).toBe(0);
    // Cierre REAL: aquí nace la ÚNICA fila y la caja se vacía en el acto
    // (caso de caja del replay 2026-10-19).
    await act(async () => {
      await result.current.stopListening({ closing: true });
    });
    await waitFor(() => expect(result.current.liveTranscript).toBe(''));

    await waitFor(async () => {
      const filas = await fluDb.conversations.toArray();
      expect(filas).toHaveLength(1);
    });
    const filas = await fluDb.conversations.toArray();
    const fila = filas[0];
    if (!fila) throw new Error('sin fila persistida');

    expect(h.crearMotorLlamadas).toBe(1);
    expect(fila).toMatchObject({
      text: 'ok flu hola mundo',
      sessionId: expect.any(String),
      meta: {
        origin: 'conversation-module',
        conversacion: expect.objectContaining({ provisional: false }),
      },
      sync: { revision: 1, deleted: false },
    });
    expect(put).toHaveBeenCalledTimes(1);
    expect(fila.sync.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fila.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    // Sin medida de voz (este escenario no entrega PCM) la fila NO inventa
    // identidad: usa la continuidad/semilla (nunca «?») y la medida tardía la
    // reemplaza (mandato del dueño 2026-10-30).
    expect(fila.speakerName).toBe(FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker);
    // Caja = fila: la frase de la caja es exactamente la frase de la fila.
    expect(caja).toBe(fila.text);
    // UN `row.committed`: el módulo es el ÚNICO que compromete la frase.
    expect(h.setCommitted).toHaveBeenCalledTimes(1);
    expect(h.setCommitted).toHaveBeenCalledWith(fila.text);
    // La MISMA fila se proyecta al historial visible (una entrada, con su etiqueta).
    expect(
      (h.integration as unknown as { addConversationEntry: ReturnType<typeof vi.fn> })
        .addConversationEntry,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        id: fila.id,
        role: 'user',
        text: fila.text,
        speakerName: fila.speakerName,
        sessionId: fila.sessionId,
        meta: expect.objectContaining({ origin: 'conversation-module' }),
      }),
    );
    // La fila es una sola y la escribe el módulo (`row.committed`): no hay dos
    // escritores. La reentrega del mismo final la resuelve la cola del módulo.
  });

  it('un reinicio del reconocedor (onend → onstart) NO reinicia la sesión del módulo', async () => {
    darSoporteNavegador();
    const { result } = montar();
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    await act(async () => {
      await result.current.startListening();
    });
    act(() => h.recognition.onstart?.());
    await alimentarVoz();
    await act(async () => {
      h.recognition.onresult?.(eventoAsr('ok flu hola', false));
    });
    await waitFor(() => expect(result.current.liveTranscript).toBe('ok flu hola'));

    // Chrome cierra y reabre el reconocedor cada pocos segundos: es el MISMO
    // ciclo del motor, no una conversación nueva. Medido 2026-10-25: cerrar la
    // sesión en `onend` producía una sesión por locución, partía las frases y
    // descartaba el texto que llegaba entre reinicios.
    act(() => h.recognition.onend?.());
    act(() => h.recognition.onstart?.());

    // UNA sola sesión: la fábrica del motor se llamó una vez.
    expect(h.crearMotorLlamadas).toBe(1);
    // Y la locución abierta NO se perdió con el reinicio: sigue en la caja.
    await waitFor(() => expect(result.current.liveTranscript).toBe('ok flu hola'));

    // Cierre real de la conversación: la sesión no queda abierta fuera del test.
    await act(async () => {
      await result.current.stopListening({ closing: true });
    });
    // La frase sobrevivió al reinicio: UNA fila y UN commit, ya asentados (sin
    // promesas sueltas que caigan en el test siguiente).
    await waitFor(async () => {
      expect(await fluDb.conversations.count()).toBe(1);
    });
    expect(h.setCommitted).toHaveBeenCalledTimes(1);
  });

  it('cinco finales del MISMO segmento producen UNA fila y UN commit al cerrar', async () => {
    darSoporteNavegador();
    const { result } = montar();
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    await act(async () => {
      await result.current.startListening();
    });
    act(() => h.recognition.onstart?.());

    await alimentarVoz();
    const finales = [
      'uno',
      'uno dos',
      'uno dos tres',
      'uno dos tres cuatro',
      'uno dos tres cuatro cinco',
    ];
    for (const texto of finales) {
      await act(async () => {
        h.recognition.onresult?.(eventoAsr(texto, true));
      });
      await waitFor(() => expect(result.current.liveTranscript).toBe(texto));
      // Defecto medido (P7): cada final de SEGMENTO de Chrome escribía su fila.
      // El dictado no puede vaciarse antes del cierre real.
      expect(await fluDb.conversations.count()).toBe(0);
      expect(h.setCommitted).not.toHaveBeenCalled();
    }

    h.recognition.stop.mockImplementation(() => h.recognition.onend?.());
    await act(async () => {
      await result.current.stopListening({ closing: true });
    });

    await waitFor(async () => {
      const filas = await fluDb.conversations.toArray();
      expect(filas).toHaveLength(1);
    });
    const fila = (await fluDb.conversations.toArray())[0];
    if (!fila) throw new Error('sin fila persistida');
    expect(fila.text).toBe('uno dos tres cuatro cinco');
    expect(fila.meta?.conversacion?.provisional).toBe(false);
    // UN `row.committed`: la proyección al historial no se multiplica.
    expect(h.setCommitted).toHaveBeenCalledTimes(1);
    expect(h.setCommitted).toHaveBeenCalledWith(fila.text);
    expect(
      (h.integration as unknown as { addConversationEntry: ReturnType<typeof vi.fn> })
        .addConversationEntry,
    ).toHaveBeenCalledTimes(1);
  });
});
