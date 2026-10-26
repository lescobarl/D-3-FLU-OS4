// @vitest-environment jsdom
// ============================================================
// useFluVoiceAssistant - CONDUCTA observable del motor de voz
// ------------------------------------------------------------
// El modulo (4575 lineas) se prueba por su API publica con renderHook.
// Se sustituye SOLO la frontera: el motor de reconocimiento del navegador
// (speechRecognitionLocal), el almacenamiento (fluStorage), la red (gemini),
// el pipeline de audio/identidad (micCaptureBridge, turnIdentityPipeline),
// el participante (useFluParticipant),
// la infraestructura de turno (useTurnInfrastructure), el store, el relay y el
// modelo de embeddings (@huggingface/transformers). La logica bajo prueba
// (transiciones de estado, guardas de arranque/parada, reset, ack, avance de
// hablante, concesion de palabra) NO se mockea.
//
// HALLAZGOS:
//  1. showListeningAck pintaba el ack y lo borraba en el mismo tick (clear tras
//     set) => el chip NUNCA se veia. ARREGLADO en src: el mensaje se fija tras
//     clearListeningAck. El caso de "ack de escucha" lo fija (nacio ROJO).
//  2. advanceConversationSpeaker depende de getActiveListenConfig().speakers;
//     sin conversacion activa cae en nextSpeakerLabel(labels).
// ============================================================
import { act, renderHook, waitFor } from '@testing-library/react';
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
  return {
    integration,
    recognition,
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
    wireMicCapturePipeline: vi.fn(),
    startContinuousIdentityPipeline: vi.fn(),
    stopAllContinuousIdentityPipelines: vi.fn(),
    createLocalRecognition: vi.fn(),
    shouldUseLocalFallback: vi.fn(() => false),
  isLocalRecognitionEngine: (engine: any) => typeof engine?.pushAudio === 'function',
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

vi.mock('../src/voice/lib/turnIdentityPipeline.js', () => ({
  startContinuousIdentityPipeline: h.startContinuousIdentityPipeline,
  stopAllContinuousIdentityPipelines: h.stopAllContinuousIdentityPipelines,
}));

vi.mock('../src/voice/lib/voiceLocalFallback', () => ({
  createLocalRecognition: h.createLocalRecognition,
  shouldUseLocalFallback: h.shouldUseLocalFallback,
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
import { getConversationConfig } from '../src/voice/lib/fluConfig';

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

/** Quita las APIs para el camino "no soportado". */
function quitarSoporteNavegador() {
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  delete (window as unknown as Record<string, unknown>).AudioContext;
  delete (window as unknown as Record<string, unknown>).webkitAudioContext;
  delete (navigator as unknown as Record<string, unknown>).mediaDevices;
}

type Props = {
  apiKey?: string;
  onContractResolved?: (arg?: unknown) => unknown;
  language?: string;
  conversationActiveRef?: { current: boolean };
  participantRef?: { current: unknown };
  [key: string]: unknown;
};

function montar(overrides: Partial<Props> = {}) {
  const props: Props = {
    apiKey: 'k',
    onContractResolved: vi.fn(),
    language: 'es',
    ...overrides,
  };
  return renderHook(() => useFluVoiceAssistant(props as never));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.integration.lastCommittedTranscript = '';
  h.integration.conversationHistory = [];
  h.integration.conversationState = 'IDLE';
  (h.integration as unknown as Record<string, unknown>).setLastCommittedTranscript = (text: string) => {
    h.integration.lastCommittedTranscript = typeof text === 'string' ? text : '';
  };

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

// ------------------------------------------------------------
// Bloque: soporte del navegador (efecto de montaje)
// ------------------------------------------------------------
describe('useFluVoiceAssistant - soporte del navegador', () => {
  it('sin SpeechRecognition/AudioContext/getUserMedia marca no soportado y lista lo que falta', async () => {
    const { result } = montar();

    await waitFor(() => expect(result.current.isSupported).toBe(false));
    expect(result.current.error).toContain('getUserMedia');
    expect(result.current.error).toContain('SpeechRecognition');
    expect(result.current.error).toContain('AudioContext');
  });

  it('con las tres APIs marca soportado y no deja error de arranque', async () => {
    darSoporteNavegador();
    const { result } = montar();

    await waitFor(() => expect(result.current.isSupported).toBe(true));
    expect(result.current.error).toBe('');
  });

  it('si solo falta SpeechRecognition, el error lo nombra y no acusa al microfono', async () => {
    (window as unknown as Record<string, unknown>).AudioContext = function AudioContext() {
      return { sampleRate: 48000 };
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(() => Promise.reject(new Error('x'))) },
    });
    const { result } = montar();

    await waitFor(() => expect(result.current.isSupported).toBe(false));
    expect(result.current.error).toContain('SpeechRecognition');
    expect(result.current.error).not.toContain('getUserMedia');
  });
});

// ------------------------------------------------------------
// Bloque: restauracion de sesion (loadSessionState)
// ------------------------------------------------------------
describe('useFluVoiceAssistant - restauracion de sesion', () => {
  it('aplica rol, tema y fase guardados', async () => {
    h.loadSessionState.mockResolvedValue({ role: 'tester', theme: 'tema-x', phase: 'SESION_ACTIVA' });
    const { result } = montar();

    await waitFor(() => expect(result.current.session.role).toBe('tester'));
    expect(result.current.session.theme).toBe('tema-x');
    expect(result.current.phase).toBe('SESION_ACTIVA');
  });

  it('sin sesion guardada conserva los defaults', async () => {
    h.loadSessionState.mockResolvedValue(null);
    const { result } = montar();

    await waitFor(() => expect(h.loadSessionState).toHaveBeenCalledTimes(1));
    expect(result.current.session.role).toBeTruthy();
    expect(result.current.phase).toBe('CONFIGURACION');
  });

  it('una fase guardada desconocida se ignora (no rompe la fase por defecto)', async () => {
    h.loadSessionState.mockResolvedValue({ role: 'x', theme: 'y', phase: 'FASE_RARA' });
    const { result } = montar();

    await waitFor(() => expect(result.current.session.role).toBe('x'));
    expect(result.current.phase).toBe('CONFIGURACION');
  });

  it('un fallo al restaurar no rompe el hook (queda en defaults)', async () => {
    h.loadSessionState.mockRejectedValue(new Error('storage roto'));
    const { result } = montar();

    await waitFor(() => expect(h.fluAsyncErrorHandler).toHaveBeenCalled());
    expect(result.current.session.role).toBeTruthy();
    expect(result.current.phase).toBe('CONFIGURACION');
  });
});

// ------------------------------------------------------------
// Bloque: estado expuesto directamente
// ------------------------------------------------------------
describe('useFluVoiceAssistant - estado expuesto', () => {
  it('setSession y setPhase actualizan el estado de sesion', () => {
    const { result } = montar();

    act(() => result.current.setSession({ role: 'r', theme: 't' }));
    expect(result.current.session).toEqual({ role: 'r', theme: 't' });

    act(() => result.current.setPhase('SESION_ACTIVA'));
    expect(result.current.phase).toBe('SESION_ACTIVA');
  });

  it('lastTranscript refleja la fuente unica del store', () => {
    h.integration.lastCommittedTranscript = 'frase previa';
    const { result } = montar();

    expect(result.current.lastTranscript).toBe('frase previa');
  });
});

// ------------------------------------------------------------
// Bloque: ack de escucha
// ------------------------------------------------------------
describe('useFluVoiceAssistant - ack de escucha', () => {
  it('showListeningAck pinta el mensaje y lo borra al expirar su duracion', () => {
    vi.useFakeTimers();
    const { result } = montar();
    const { message, durationMs } = getConversationConfig().listeningAck;
    expect(message).toBeTruthy();

    act(() => result.current.showListeningAck());
    // El ack es visible durante su ventana (antes del arreglo quedaba '' por el
    // clearListeningAck() inmediato: esta asercion nacIo ROJA).
    expect(result.current.listeningAck).toBe(message);

    act(() => {
      vi.advanceTimersByTime(durationMs);
    });
    expect(result.current.listeningAck).toBe('');
  });

  it('resetConversationSession limpia el ack', () => {
    const { result } = montar();

    act(() => result.current.resetConversationSession());
    expect(result.current.listeningAck).toBe('');
  });
});

// ------------------------------------------------------------
// Bloque: reset de display y sesion
// ------------------------------------------------------------
describe('useFluVoiceAssistant - reset', () => {
  it('resetVoiceDisplay limpia la transcripcion comprometida en el store', () => {
    h.integration.lastCommittedTranscript = 'frase previa';
    const { result } = montar();
    expect(result.current.lastTranscript).toBe('frase previa');

    act(() => result.current.resetVoiceDisplay());

    expect(h.integration.lastCommittedTranscript).toBe('');
  });

  it('resetConversationSession reusa el reset de display y limpia el ack', () => {
    h.integration.lastCommittedTranscript = 'algo';
    const { result } = montar();

    act(() => result.current.resetConversationSession());

    expect(h.integration.lastCommittedTranscript).toBe('');
    expect(result.current.listeningAck).toBe('');
  });
});

// ------------------------------------------------------------
// Bloque: arranque / parada de escucha
// ------------------------------------------------------------
describe('useFluVoiceAssistant - arranque de escucha', () => {
  it('startListening sin soporte deja el error de navegador no soportado', async () => {
    const { result } = montar();
    await waitFor(() => expect(result.current.isSupported).toBe(false));

    await act(async () => {
      await result.current.startListening();
    });

    expect(result.current.error).toContain('no soporta el flujo de voz');
    expect(h.acquireSpeechRecognition).not.toHaveBeenCalled();
  });

  it('startListening con motor no disponible propaga el error y no queda escuchando', async () => {
    darSoporteNavegador();
    h.acquireSpeechRecognition.mockReturnValue(null);
    const { result } = montar();
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    await act(async () => {
      await result.current.startListening();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.error).toContain('SpeechRecognition no esta disponible');
  });

  it('startListening con motor disponible pasa a listening y arranca el motor', async () => {
    darSoporteNavegador();
    const { result } = montar();
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    await act(async () => {
      await result.current.startListening();
    });

    expect(result.current.status).toBe('listening');
    expect(h.acquireSpeechRecognition).toHaveBeenCalledWith('es', expect.any(String));
    expect(h.startSpeechRecognition).toHaveBeenCalledWith(h.recognition);
  });

  it('toggleListening desde idle arranca la escucha', async () => {
    darSoporteNavegador();
    const { result } = montar();
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    await act(async () => {
      await result.current.toggleListening();
    });

    expect(result.current.status).toBe('listening');
  });

  it('startListening({resume:true}) reutiliza el motor existente sin reconstruirlo', async () => {
    darSoporteNavegador();
    const { result } = montar();
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    await act(async () => {
      await result.current.startListening();
    });
    await act(async () => {
      await result.current.startListening({ resume: true });
    });

    expect(h.acquireSpeechRecognition).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('listening');
  });
});

describe('useFluVoiceAssistant - parada de escucha', () => {
  it('stopListening en reposo y sin captura es un no-op', async () => {
    const { result } = montar();

    await act(async () => {
      await result.current.stopListening();
    });

    expect(result.current.status).toBe('idle');
    expect(h.acquireSpeechRecognition).not.toHaveBeenCalled();
  });

  it('toggleListening desde listening cierra la escucha y suelta el motor', async () => {
    darSoporteNavegador();
    const { result } = montar();
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    await act(async () => {
      await result.current.startListening();
    });
    expect(result.current.status).toBe('listening');

    await act(async () => {
      await result.current.toggleListening();
    });

    expect(result.current.status).toBe('idle');
    expect(h.recognition.stop).toHaveBeenCalled();
  });

  it('suspender la escucha para el habla aborta el motor activo', async () => {
    darSoporteNavegador();
    const { result } = montar();
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    await act(async () => {
      await result.current.startListening();
    });
    // El motor confirma onstart -> queda activo y suspendible.
    act(() => h.recognition.onstart?.());

    await act(async () => {
      await result.current.suspendRecognitionForAssistantSpeech();
    });

    expect(h.recognition.abort).toHaveBeenCalledTimes(1);
  });
});

// ------------------------------------------------------------
// Bloque: avance de hablante
// ------------------------------------------------------------
describe('useFluVoiceAssistant - avance de hablante', () => {
  it('sin conversacion activa avanza por etiquetas genericas sucesivas', () => {
    const { result } = montar();

    let primero = '';
    act(() => {
      primero = result.current.advanceConversationSpeaker();
    });
    let segundo = '';
    act(() => {
      segundo = result.current.advanceConversationSpeaker();
    });

    expect(primero).toBe('Hablante 1');
    expect(segundo).toBe('Hablante 2');
  });

  it('con conversacion activa delega el avance en el estado de escucha', () => {
    const conversationActiveRef = { current: true };
    const { result } = montar({ conversationActiveRef } as Partial<Props>);

    let primero = '';
    act(() => {
      primero = result.current.advanceConversationSpeaker();
    });
    let segundo = '';
    act(() => {
      segundo = result.current.advanceConversationSpeaker();
    });

    expect(primero).toBe('Hablante 2');
    expect(segundo).toBe('Hablante 3');
  });
});

// ------------------------------------------------------------
// Bloque: concesion de palabra al participante
// ------------------------------------------------------------
describe('useFluVoiceAssistant - concesion de palabra', () => {
  const participanteBase = () => ({
    canAcceptFloorGrant: vi.fn(() => true),
    shouldIgnoreDuplicateFloorGrant: vi.fn(() => false),
    hasRaisedHand: vi.fn(() => false),
    consumeRaisedDraft: vi.fn(() => 'quiero decir algo'),
    beginFloorDelivery: vi.fn(),
    endFloorDelivery: vi.fn(),
    recordInterventionDelivered: vi.fn(),
    resetParticipant: vi.fn(),
    dismissRaisedHand: vi.fn(),
    evaluateOnDemand: vi.fn(),
  });

  it('un duplicado de concesion no emite ningun contrato', async () => {
    const participante = participanteBase();
    participante.shouldIgnoreDuplicateFloorGrant.mockReturnValue(true);
    const onContractResolved = vi.fn();
    const participantRef = { current: participante };
    const { result } = montar({ participantRef, onContractResolved } as Partial<Props>);

    await act(async () => {
      await result.current.grantParticipantFloor();
    });

    expect(onContractResolved).not.toHaveBeenCalled();
  });

  it('con borrador pendiente entrega la intervencion del participante como turno de palabra', async () => {
    const participante = participanteBase();
    const onContractResolved = vi.fn();
    const participantRef = { current: participante };
    const { result } = montar({ participantRef, onContractResolved } as Partial<Props>);

    await act(async () => {
      await result.current.grantParticipantFloor();
    });

    expect(participante.beginFloorDelivery).toHaveBeenCalled();
    expect(participante.recordInterventionDelivered).toHaveBeenCalled();
    expect(participante.endFloorDelivery).toHaveBeenCalled();
    const llamadas = onContractResolved.mock.calls as unknown as Array<
      [{ participantFloor?: boolean; contract?: { respuesta_voz?: string } }]
    >;
    const conFloor = llamadas.find((call) => call[0]?.participantFloor === true);
    expect(conFloor).toBeTruthy();
    expect(conFloor![0].contract?.respuesta_voz).toBe('quiero decir algo');
  });

  it('endParticipantFloorDelivery delega en el participante inyectado', () => {
    const participante = participanteBase();
    const participantRef = { current: participante };
    const { result } = montar({ participantRef } as Partial<Props>);

    result.current.endParticipantFloorDelivery();

    expect(participante.endFloorDelivery).toHaveBeenCalledTimes(1);
  });
});
