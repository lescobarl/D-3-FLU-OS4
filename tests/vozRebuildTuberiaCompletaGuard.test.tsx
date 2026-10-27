// @vitest-environment jsdom
// ============================================================
// vozRebuildTuberiaCompletaGuard - TUBERIA COMPLETA: el rebuild del watchdog
// no puede perder la locución viva.
// ------------------------------------------------------------
// Monta el HOOK real, dispara el WATCHDOG por temporizador y alimenta el PCM que
// entregaría el micrófono: el VAD, el motor CONVERSACIÓN y su cierre son los
// REALES (Dexie con fake-indexeddb). Solo se sustituye la FRONTERA del navegador
// (reconocedor, Web Audio, getUserMedia, red y almacenamiento de sesión).
//
// CONTRATO NUEVO (corte 2026-10-25): la locución viva pertenece al módulo, que
// SOBREVIVE al reinicio del reconocedor con su locución abierta (edb4a2b6). Un
// final de Chrome NO cierra la locución: el cierre es la frontera VAD, y la fila
// se escribe al cerrar. Este guard mide:
//   1. FINAL de Chrome + rebuild por temporizador -> la locución sigue en la caja
//      y NO se escribe fila (el final no es cierre);
//   2. silencio ≥ silenceCloseMs -> la locución CIERRA y llega a Dexie con la
//      frase completa (una locución = un tramo = una fila).
// ============================================================
import 'fake-indexeddb/auto'
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const integration = {
    lastCommittedTranscript: '',
    conversationHistory: [] as unknown[],
    conversationState: 'IDLE',
    conversationEpoch: 1,
    activePersonId: '',
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
  const mic = { onRawPcmBlock: null as null | ((input: Float32Array, meta?: { sampleIndex?: number }) => void) };
  return { integration, recognition, mic };
});

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
  listVoiceProfiles: vi.fn(async () => []),
  loadSessionState: vi.fn(async () => null),
  saveSessionState: vi.fn(async () => undefined),
  saveVoiceProfile: vi.fn(async () => undefined),
}));

vi.mock('../src/voice/lib/gemini', () => ({ requestFluContract: vi.fn(async () => ({})) }));

// Frontera: el reconocedor del navegador. El objeto es observable desde el test para
// emitir onresult/onstart como los emite Chrome.
vi.mock('../src/voice/lib/speechRecognitionLocal', () => ({
  acquireSpeechRecognition: vi.fn(() => h.recognition),
  startSpeechRecognition: vi.fn(() => true),
  stopSpeechRecognition: vi.fn(),
  getRecognitionLanguage: vi.fn((l) => (l === 'en' ? 'en-US' : 'es-ES')),
  isBilingualListenMode: vi.fn((l) => l === 'both'),
  resolveRecognitionLocale: vi.fn((l) => (l === 'en' ? 'en-US' : 'es-ES')),
}));

// El PCM del micrófono se captura para inyectarlo desde el test: el VAD y el
// motor son los reales, solo se sustituye la fuente de audio del navegador. El
// módulo se alimenta del tap CRUDO (`onRawPcmBlock`, pre-ganancia): ahí está
// calibrado el piso del VAD.
vi.mock('../src/voice/lib/micCaptureBridge.js', () => ({
  wireMicCapturePipeline: vi.fn(async (opciones: { onRawPcmBlock: (input: Float32Array, meta?: { sampleIndex?: number }) => void }) => {
    h.mic.onRawPcmBlock = opciones.onRawPcmBlock;
    return { zeroGain: { disconnect: vi.fn() } };
  }),
}));

vi.mock('../src/voice/lib/voiceLocalFallback', () => ({
  createLocalRecognition: vi.fn(() => null),
  shouldUseLocalFallback: vi.fn(() => false),
  isLocalFallbackEnabled: vi.fn(() => false),
  isLocalRecognitionEngine: (engine: any) => typeof engine?.pushAudio === 'function',
  prewarmLocalRecognition: vi.fn(() => true),
  installLocalRecognition: vi.fn(() => null),
  installChromeRecognition: vi.fn(() => null),
  getLocalFallbackRuntimeConfig: vi.fn(() => ({
    recoveryMs: 20000,
    recoverySegments: 3,
    probeMs: 4000,
    finalMinSpeechLikeMs: 180,
    partialMinSpeechLikeMs: 300,
  })),
  resolveSilentDegrade: vi.fn(() => ({ degrade: false, voicedMs: 0, speechLikeMs: 0, rms: 0, sinceSrResultMs: 0, failedRebuilds: 0, log: '' })),
}));

vi.mock('../src/core/selfKnowledge/selfKnowledge', () => ({ isSelfKnowledgeRequest: vi.fn(() => false) }));
vi.mock('../src/core/games/gameSessionStore', () => ({ noteGameTurn: vi.fn() }));
vi.mock('../src/hooks/useFluParticipant', () => ({
  useFluParticipant: vi.fn(() => ({ presentation: { label: 'Participante', show: false } })),
}));
// useTurnInfrastructure NO se mockea: el ciclo de vida REAL (createTurnLifecycle) es
// el que usa el commit; el store ya esta neutralizado arriba.
vi.mock('../src/lib/clientLogRelay', () => ({ relayLog: vi.fn() }));
vi.mock('../src/lib/caughtError', () => ({ logCaughtError: vi.fn() }));
vi.mock('../src/voice/lib/fluAsyncError.js', () => ({ fluAsyncErrorHandler: vi.fn(() => vi.fn()) }));
vi.mock('../src/voice/lib/listenLog', () => ({
  fluEvent: vi.fn(),
  logChromeSpeechResult: vi.fn(),
  getListenLogRing: vi.fn(() => []),
  clearListenLogRing: vi.fn(),
}));
vi.mock('../src/voice/lib/fluDebug', async (original) => ({
  ...((await original()) as object),
  debugHotPath: false,
  fluDebugHot: vi.fn(),
  getFluDebugApi: vi.fn(() => ({})),
}));
// Solo se neutraliza lo que no aporta (los bursts simulados); el resto del modulo real.

import { FLU_CONFIG } from '../src/voice/lib/fluConfig';
import { useFluVoiceAssistant } from '../src/voice/hooks/useFluVoiceAssistant';
import { acquireSpeechRecognition } from '../src/voice/lib/speechRecognitionLocal';
import { fluDb } from '../src/core/db/fluDatabase';
import { getVadEnergyThreshold } from '../src/voice/lib/asr/asrConfig.js';

const SR = 48000
const BLOQUE_MS = 100

/** Evento con forma de SpeechRecognitionEvent de Chrome. */
function chromeEvent(specs: Array<{ isFinal?: boolean; transcript: string }>, resultIndex = 0) {
  const results = specs.map((s) => ({
    isFinal: Boolean(s.isFinal),
    0: { transcript: s.transcript, confidence: 0.9 },
    length: 1,
  }));
  return { resultIndex, results };
}

const LARGA =
  'voy a hacer una prueba para identificar el comportamiento de la transcripcion y de la avisacion soy luis no digo el comando y hago una pausa';

function darSoporteNavegador() {
  (window as unknown as Record<string, unknown>).SpeechRecognition = function SpeechRecognition() {};
  (window as unknown as Record<string, unknown>).AudioContext = function AudioContext() {
    return {
      sampleRate: SR,
      resume: async () => {},
      createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
      createGain: () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }),
      createAnalyser: () => ({ fftSize: 0, smoothingTimeConstant: 0, connect: vi.fn(), disconnect: vi.fn() }),
    };
  };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(() => Promise.resolve({})) },
  });
}

/** Monta el hook en conversacion activa y arranca la escucha (watchdog armado). */
async function arrancarEscucha(onContractResolved: (arg?: unknown) => unknown) {
  const vista = renderHook(() =>
    useFluVoiceAssistant({
      apiKey: 'k',
      onContractResolved,
      language: 'es',
      conversationActiveRef: { current: true },
    } as never),
  );
  await act(async () => {
    await vista.result.current.startListening();
  });
  // Chrome arranca: sin onstart el watchdog no considera la escucha activa.
  act(() => {
    h.recognition.onstart?.();
  });
  return vista;
}

/** Cuantas veces se creo el reconocedor: 1 arranque + N rebuilds del watchdog. */
function vecesCreadoElReconocedor(): number {
  return (acquireSpeechRecognition as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
}

/** Tono con RMS cuatro veces por encima del piso REAL del VAD. */
function tono(ms: number): Float32Array {
  const n = Math.round((SR * ms) / 1000)
  const muestras = new Float32Array(n)
  const amplitud = Math.sqrt(2) * getVadEnergyThreshold() * 4
  for (let i = 0; i < n; i += 1) muestras[i] = Math.sin((2 * Math.PI * 220 * i) / SR) * amplitud
  return muestras
}

/** Silencio digital del mismo tamaño. */
function silencio(ms: number): Float32Array {
  return new Float32Array(Math.round((SR * ms) / 1000))
}

let cursorMuestras = 0

/** Entrega un bloque de PCM al pipeline REAL del hook como lo haría el micrófono. */
function empujarAudio(muestras: Float32Array) {
  expect(h.mic.onRawPcmBlock, 'el pipeline del micrófono se cableó').toBeTypeOf('function')
  h.mic.onRawPcmBlock?.(muestras, { sampleIndex: cursorMuestras })
  cursorMuestras += muestras.length
}

beforeEach(() => {
  vi.clearAllMocks();
  h.integration.conversationHistory = [];
  Object.assign(h.integration, {
    lastCommittedTranscript: '',
    conversationEpoch: 1,
    activePersonId: '',
    setLastCommittedTranscript: vi.fn(),
    addConversationEntry: vi.fn(),
  });
  h.mic.onRawPcmBlock = null;
  cursorMuestras = 0;
  Object.assign(h.recognition, { lang: '', onstart: null, onresult: null, onerror: null, onend: null });
  h.recognition.stop.mockReset();
  h.recognition.start.mockReset();
  h.recognition.abort.mockReset();
  darSoporteNavegador();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('P9.60 - tuberia completa: el rebuild del watchdog no puede perder la locucion', () => {
  it('FINAL sin cierre + rebuild por temporizador -> la locucion sigue viva (y no hay fila)', async () => {
    const onContract = vi.fn();
    await fluDb.conversations.clear();
    // Se falsean SOLO los temporizadores del watchdog: `setImmediate` queda REAL
    // porque es el planificador de Dexie/fake-indexeddb, y falsearlo cuelga la DB.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const vista = await arrancarEscucha(onContract);

    // PCM real del micrófono: 1 s de silencio y 1 s de voz abre el tramo del enunciado.
    for (let i = 0; i < 10; i += 1) empujarAudio(silencio(BLOQUE_MS));
    for (let i = 0; i < 10; i += 1) empujarAudio(tono(BLOQUE_MS));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    // FINAL de Chrome: NO cierra la locución (el cierre es la frontera VAD).
    await act(async () => {
      h.recognition.onresult?.(chromeEvent([{ isFinal: true, transcript: LARGA }], 0));
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(vista.result.current.liveTranscript, 'la caja del módulo publica la frase').toContain(
      'voy a hacer una prueba',
    );

    // El watchdog de conversacion cumple su ventana sin texto nuevo y hace REBUILD
    // del reconocedor. Con el defecto, aquí se descartaba la locución.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(vecesCreadoElReconocedor(), 'el watchdog no llegó a reconstruir').toBeGreaterThanOrEqual(2);
    expect(
      vista.result.current.liveTranscript,
      'el rebuild del watchdog NO puede descartar la locución viva',
    ).toContain('voy a hacer una prueba');
    vi.useRealTimers();
    expect(await fluDb.conversations.count(), 'un final no cierra: todavía no hay fila').toBe(0);

    // Cierre determinista de la sesion: el desmontaje limpia timers y reconocedor.
    await act(async () => {
      vista.unmount();
    });
  });

  it('silencio ≥ silenceCloseMs -> la locución CIERRA y la fila lleva la frase completa', async () => {
    const onContract = vi.fn();
    const vista = await arrancarEscucha(onContract);
    await fluDb.conversations.clear();

    for (let i = 0; i < 10; i += 1) empujarAudio(silencio(BLOQUE_MS));
    for (let i = 0; i < 10; i += 1) empujarAudio(tono(BLOQUE_MS));
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      h.recognition.onresult?.(chromeEvent([{ isFinal: true, transcript: LARGA }], 0));
      await Promise.resolve();
    });

    // Silencio sostenido por encima del umbral del plan: el VAD cierra la locución.
    const bloques = Math.ceil(FLU_CONFIG.transcript.pauseAndWeakAsr.srGapCommitMs / BLOQUE_MS) + 200;
    await act(async () => {
      for (let i = 0; i < bloques; i += 1) empujarAudio(silencio(BLOQUE_MS));
      await Promise.resolve();
    });

    await waitFor(async () => {
      expect(await fluDb.conversations.count(), 'la locución cerrada escribe UNA fila').toBe(1);
    });
    const filas = await fluDb.conversations.toArray();
    expect(filas[0].text, 'la fila lleva la frase completa, no la cola').toContain('voy a hacer una prueba');
    expect(filas[0].text).toContain('hago una pausa');

    await act(async () => {
      vista.unmount();
      await Promise.resolve();
    });
  });
});
