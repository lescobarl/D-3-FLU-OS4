// @vitest-environment jsdom
// ============================================================
// vozRebuildTuberiaCompletaGuard - TUBERIA COMPLETA del defecto P9.60
// ------------------------------------------------------------
// El cierre de P9.60 declaro NO CUBIERTO este nivel: montar el HOOK real y disparar
// el WATCHDOG por temporizador (en vez de leer el hook como texto o de inyectar en
// el ingress a mano). Aqui se cierra ese hueco.
//
// Solo se sustituye la FRONTERA: el motor de reconocimiento del navegador
// (speechRecognitionLocal), el almacenamiento, la red, la captura de audio y el
// pipeline de identidad. El INGRESS, el COMMIT y el WATCHDOG son los REALES.
//
// DEFECTO (medido en el log del dueno): un FINAL de 169 chars se commitea sin cierre
// -> NO escribe fila. A los ~4,2 s sin texto nuevo el watchdog hace REBUILD del
// reconocedor y `flushListenStateBeforeRebuild` descartaba la linea viva suponiendo
// que era un interino en vuelo -> la locucion se perdia (la fila posterior llevaba
// solo el texto nuevo).
//
// MEDIDO: con la version de base (commit 43a7a96) el caso 1 da `filasDelTurno=[]`
// (la locucion NO llega: el defecto, en la tuberia completa). Con el arreglo llega.
// ============================================================
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const integration = {
    lastCommittedTranscript: '',
    conversationHistory: [] as unknown[],
    conversationState: 'IDLE',
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
  return { integration, recognition };
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
}));

vi.mock('../src/voice/lib/micCaptureBridge.js', () => ({
  wireMicCapturePipeline: vi.fn(async () => ({ zeroGain: { disconnect: vi.fn() } })),
}));

vi.mock('../src/voice/lib/turnIdentityPipeline.js', async (original) => ({
  ...((await original()) as object),
  startContinuousIdentityPipeline: vi.fn(),
  stopAllContinuousIdentityPipelines: vi.fn(),
  // Sin audio real no hay preflight: la fila se escribe sin hablante (regla del dueno).
  finalizeTurnIdentityPipeline: vi.fn(() => null),
}));

vi.mock('../src/voice/lib/voiceLocalFallback', () => ({
  createLocalRecognition: vi.fn(() => null),
  shouldUseLocalFallback: vi.fn(() => false),
}));

vi.mock('../src/voice/lib/turnSpeakerPreflight.js', () => ({
  createTurnSpeakerAudioResolver: vi.fn(() => ({})),
  peekTurnSpeakerPreflight: vi.fn(() => ({ ready: false })),
  preflightEvidenceMeasured: vi.fn(() => false),
}));

vi.mock('../src/core/selfKnowledge/selfKnowledge', () => ({ isSelfKnowledgeRequest: vi.fn(() => false) }));
vi.mock('../src/core/games/gameSessionStore', () => ({ noteGameTurn: vi.fn() }));
vi.mock('../src/hooks/useFluParticipant', () => ({
  useFluParticipant: vi.fn(() => ({ presentation: { label: 'Participante', show: false } })),
}));
// useTurnInfrastructure NO se mockea: el ciclo de vida REAL (createTurnLifecycle) es
// el que usa el commit; el store ya esta neutralizado arriba.
vi.mock('../src/lib/clientLogRelay', () => ({ relayLog: vi.fn() }));
// Sonda de trazas: fuera de navegador intenta un fetch a /__flu_agent_trace y ensucia
// la salida del test. Es diagnostico, no comportamiento.
vi.mock('../src/voice/lib/fluTrace.js', () => ({ fluTrace: vi.fn() }));
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
vi.mock('../src/voice/lib/micEventProducer.js', async (original) => ({
  ...((await original()) as object),
  convertSimEventsToMicBursts: vi.fn(() => []),
}));

import { FLU_CONFIG } from '../src/voice/lib/fluConfig';
import { useFluVoiceAssistant } from '../src/voice/hooks/useFluVoiceAssistant';
import { acquireSpeechRecognition } from '../src/voice/lib/speechRecognitionLocal';

/** Evento con forma de SpeechRecognitionEvent de Chrome. */
function chromeEvent(specs: Array<{ isFinal?: boolean; transcript: string }>, resultIndex = 0) {
  const results = specs.map((s) => ({
    isFinal: Boolean(s.isFinal),
    0: { transcript: s.transcript, confidence: 0.9 },
    length: 1,
  }));
  return { resultIndex, results };
}

/**
 * FILAS DE TURNO del contrato: el payload de fila del log lleva `rawOnly` y NO es una
 * emision de stream (`streamUpdate:false`). Asi no se confunde con el preview.
 */
function filasDelTurno(onContract: { mock: { calls: unknown[][] } }): string[] {
  return onContract.mock.calls
    .map((c) => (c[0] || {}) as Record<string, unknown>)
    .filter((p) => p.rawOnly === true && p.streamUpdate === false)
    .map((p) => String(p.transcript || ''))
    .filter(Boolean);
}

const LARGA =
  'voy a hacer una prueba para identificar el comportamiento de la transcripcion y de la avisacion soy luis no digo el comando y hago una pausa';

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

beforeEach(() => {
  vi.clearAllMocks();
  h.integration.lastCommittedTranscript = '';
  h.integration.conversationHistory = [];
  (h.integration as unknown as Record<string, unknown>).setLastCommittedTranscript = () => {};
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
  it('FINAL sin fila + rebuild por temporizador -> la locucion llega a la fila', async () => {
    vi.useFakeTimers();
    const onContract = vi.fn();
    await arrancarEscucha(onContract);

    // FINAL de Chrome: commit de SEGMENTO (sin cierre) -> todavia NO escribe fila.
    await act(async () => {
      h.recognition.onresult?.(chromeEvent([{ isFinal: true, transcript: LARGA }], 0));
      await Promise.resolve();
    });
    expect(filasDelTurno(onContract), 'antes del rebuild: ' + JSON.stringify(filasDelTurno(onContract))).toHaveLength(0);

    // El watchdog de conversacion (stallCheckMs ~350) cumple 4,2 s sin texto nuevo y
    // hace REBUILD del reconocedor. Con el defecto, aqui se descartaba la locucion.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    // ANTI-VACUIDAD: el rebuild ocurrio de verdad (se creo el reconocedor 2+ veces).
    expect(vecesCreadoElReconocedor(), 'el watchdog no llego a reconstruir').toBeGreaterThanOrEqual(2);
    expect(
      filasDelTurno(onContract).join(' | '),
      'filas=' + JSON.stringify(filasDelTurno(onContract)),
    ).toContain('voy a hacer una prueba');
  });

  it('el detector no es decorativo: un INTERINO en vuelo NO se cierra en el rebuild (sigue descartandose)', async () => {
    vi.useFakeTimers();
    // AISLAMIENTO del camino REBUILD: con el cierre por SILENCIO en ~3,5 s (spec del dueno,
    // 2026-10-10) el srGap sellaria el interino ANTES de que el watchdog reconstruya
    // (conversationStallMs 4200 > 3500). Aqui se apaga el srGap para medir SOLO que el
    // rebuild no sella un interino NO confirmado.
    const srGapAntes = FLU_CONFIG.transcript.pauseAndWeakAsr.srGapCommitMs;
    FLU_CONFIG.transcript.pauseAndWeakAsr.srGapCommitMs = 0;
    try {
      const onContract = vi.fn();
      await arrancarEscucha(onContract);

      await act(async () => {
        h.recognition.onresult?.(chromeEvent([{ isFinal: false, transcript: 'la transcripcion desde' }], 0));
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });

      expect(vecesCreadoElReconocedor(), 'el watchdog no llego a reconstruir').toBeGreaterThanOrEqual(2);
      expect(
        filasDelTurno(onContract).join(' | '),
        'filas=' + JSON.stringify(filasDelTurno(onContract)),
      ).not.toContain('la transcripcion desde');
    } finally {
      FLU_CONFIG.transcript.pauseAndWeakAsr.srGapCommitMs = srGapAntes;
    }
  });
});
