// @vitest-environment jsdom
// ============================================================
// vozReplayDueno20261019Comando - REPLAY del defecto 5 del dueno (2026-10-19)
// ------------------------------------------------------------
// DEFECTO REPORTADO: "cuando solo un recordatorio se borro la transcripcion e
// ultima frase y se perdio mucho de lo que hable". Un COMANDO ejecutado a mitad
// del dictado vaciaba la locucion en vuelo (`openLine`/`pendingInterim`), la caja
// se sustituia por el trozo nuevo y la fila del cierre se quedaba solo con lo
// dicho DESPUES del comando.
//
// LIMITACION HONESTA: no existe en los logs preservados la literal del borrado
// del recordatorio (se buscaron todas las sesiones `$TEMP/flu-session-*.log`);
// los logs tampoco guardan PCM ni vectores. Lo que SI esta medido en el log de
// la sesion es el mecanismo: un dispatch sobre un INTERINO (el comando se
// resuelve antes de que ese mismo interino se integre en la locucion) y el
// cierre posterior (`onend`). Este replay reproduce ESE escenario con la tuberia
// REAL del hook: ingress, stream, commit y caja reales; solo se sustituye la
// frontera (reconocedor del navegador, red, audio y pipeline de identidad).
//
// QUE SE FIJA (para las DOS ramas de dispatch que existen):
//   A. Ejecutar la orden a mitad del dictado NO borra lo ya dictado: la caja de
//      la ultima frase conserva el mandato Y lo que se siguio diciendo.
//   B. El cierre real (onend) escribe UNA fila con TODA la locucion, no solo con
//      el trozo posterior al comando.
// La prueba es falsificable: con las lineas viejas (`openLine=''` /
// `pendingInterim=''` al entrar al dispatch) el cierre pierde el mandato.
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
  return { integration, recognition, fluContract: vi.fn() };
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

// La IA es FRONTERA: se responde con el shape REAL que consume
// `buildResolvedContract` (`contract.contract`). El texto permite la sonda de
// anti-vacuidad (la respuesta llego a la fila).
vi.mock('../src/voice/lib/gemini', () => ({ requestFluContract: h.fluContract }));

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
  isLocalFallbackEnabled: vi.fn(() => false),
  isLocalRecognitionEngine: (engine: any) => typeof engine?.pushAudio === 'function',
  prewarmLocalRecognition: vi.fn(() => true),
  installLocalRecognition: vi.fn(() => null),
  installChromeRecognition: vi.fn(() => null),
  getLocalFallbackRuntimeConfig: vi.fn(() => ({ recoveryMs: 20000, recoverySegments: 3, probeMs: 4000, finalMinSpeechLikeMs: 180, partialMinSpeechLikeMs: 300 })),
  resolveSilentDegrade: vi.fn(() => ({ degrade: false, speechLikeMs: 0, rms: 0, voicedMs: 0, sinceSrResultMs: 0, failedRebuilds: 0, log: '' })),
}));

vi.mock('../src/voice/lib/turnSpeakerPreflight.js', () => ({
  createTurnSpeakerAudioResolver: vi.fn(() => ({})),
  peekTurnSpeakerPreflight: vi.fn(() => ({ ready: false })),
  preflightEvidenceMeasured: vi.fn(() => false),
}));

vi.mock('../src/core/selfKnowledge/selfKnowledge', () => ({ isSelfKnowledgeRequest: vi.fn(() => false) }));
vi.mock('../src/core/games/gameSessionStore', () => ({
  noteGameTurn: vi.fn(),
  // La rama flu consulta el arbitro determinista, que importa estas dos.
  getActiveGameSession: vi.fn(() => null),
  isGameSuspended: vi.fn(() => false),
}));
vi.mock('../src/hooks/useFluParticipant', () => ({
  useFluParticipant: vi.fn(() => ({ presentation: { label: 'Participante', show: false } })),
}));
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

import { useFluVoiceAssistant } from '../src/voice/hooks/useFluVoiceAssistant';

/** Respuesta de la IA mockeada (sonda de anti-vacuidad de la rama flu). */
const RESPUESTA_IA = 'La minuta uno trata de la prueba de la sala.';

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
 * FILAS DE TURNO del contrato: payload con `rawOnly:true` y sin `streamUpdate`.
 * Es el mismo filtro que usa el guard de tuberia completa.
 */
function filasDelTurno(onContract: { mock: { calls: unknown[][] } }): string[] {
  return onContract.mock.calls
    .map((c) => (c[0] || {}) as Record<string, unknown>)
    .filter((p) => p.rawOnly === true && p.streamUpdate === false)
    .map((p) => String(p.transcript || ''))
    .filter(Boolean);
}

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

/** Monta el hook en conversacion activa y arranca la escucha. */
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
  act(() => {
    h.recognition.onstart?.();
  });
  return vista;
}

/** Un tramo de dictado: interino en el indice indicado y vencimiento del debounce. */
async function dictar(
  specs: Array<{ isFinal?: boolean; transcript: string }>,
  resultIndex: number,
) {
  await act(async () => {
    h.recognition.onresult?.(chromeEvent(specs, resultIndex));
    await vi.advanceTimersByTimeAsync(120);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.fluContract.mockResolvedValue({
    contract: {
      respuesta_voz: RESPUESTA_IA,
      navegacion: { comando: null, destino: null, parametros: {} },
    },
    diagnostics: null,
  });
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

describe('replay 2026-10-19 · defecto 5: la orden a mitad del dictado no borra la locucion', () => {
  it('COMANDO en el interino (GENERAR_RESUMEN): la caja y la fila de cierre conservan TODO', async () => {
    vi.useFakeTimers();
    const onContract = vi.fn();
    const vista = await arrancarEscucha(onContract);

    // La wake va al INICIO del mandato: lo dicho despues del comando sigue siendo
    // parte de la MISMA locucion (no hay prefijo pasivo que recortar al cerrar).
    const MANDATO = 'ok flu genera la minuta';
    const MANDATO_CUERPO = 'genera la minuta';
    const CONTINUACION = 'y tambien quiero que revises la transcripcion de la sala';
    const CONTINUACION_CUERPO = 'revises la transcripcion';

    // 1) El mandato llega como interino: el comando se despacha A MITAD del dictado
    //    (shouldDispatchCommandInterim sobre GENERAR_RESUMEN).
    await dictar([{ isFinal: false, transcript: MANDATO }], 0);

    // ANTI-VACUIDAD: el comando se ejecuto de verdad (contrato GENERAR_RESUMEN).
    const comandos = onContract.mock.calls
      .map((c) => (c[0] || {}) as Record<string, unknown>)
      .filter((p) => (p.contract as Record<string, unknown> | null)?.navegacion &&
        ((p.contract as Record<string, unknown>).navegacion as Record<string, unknown>).comando === 'GENERAR_RESUMEN');
    expect(
      comandos.length,
      'el comando no se despacho: ' + JSON.stringify(onContract.mock.calls.map((c) => c[0])),
    ).toBeGreaterThan(0);
    // La rama flu NO puede haberse disparado en paralelo (una sola accion por turno).
    expect(h.fluContract, 'el mandato se trato como consulta flu').not.toHaveBeenCalled();

    // 2) Chrome entrega la CONTINUACION como resultado NUEVO (indice 1): es el
    //    habla real que sigue al comando y NO puede perderse.
    await dictar(
      [
        { isFinal: false, transcript: MANDATO },
        { isFinal: false, transcript: CONTINUACION },
      ],
      1,
    );

    // A) La caja de la ultima frase conserva el mandato Y la continuacion.
    const caja = String(vista.result.current.liveTranscript || '');
    expect(caja, 'la caja perdio el mandato: ' + JSON.stringify(caja)).toContain(MANDATO_CUERPO);
    expect(caja, 'la caja perdio la continuacion: ' + JSON.stringify(caja)).toContain(CONTINUACION_CUERPO);

    // 3) CIERRE REAL del turno (onend): la fila se escribe completa.
    act(() => {
      h.recognition.onend?.();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // B) La fila del cierre lleva TODA la locucion (mandato + continuacion).
    const filas = filasDelTurno(onContract);
    const filaCompleta = filas.filter(
      (f) => f.includes(MANDATO_CUERPO) && f.includes(CONTINUACION_CUERPO),
    );
    expect(
      filaCompleta.length,
      'ninguna fila de cierre conserva la locucion completa: ' + JSON.stringify(filas),
    ).toBeGreaterThan(0);
  });

  it('CONSULTA en el interino (minuta de conocimiento): la caja y la fila de cierre conservan TODO', async () => {
    vi.useFakeTimers();
    const onContract = vi.fn();
    const vista = await arrancarEscucha(onContract);

    const PETICION = 'ok flu platicame de la minuta uno';
    const PETICION_CUERPO = 'platicame de la minuta';
    const CONTINUACION = 'y tambien quiero que revises la transcripcion de la sala';
    const CONTINUACION_CUERPO = 'revises la transcripcion';

    // 1) La consulta de minuta se despacha sobre el interino (shouldDispatchFluInterim),
    //    ANTES de que ese mismo interino se integre en la locucion en vuelo.
    await dictar([{ isFinal: false, transcript: PETICION }], 0);

    // ANTI-VACUIDAD: la IA respondio de verdad con el contrato de la consulta.
    const respuestas = onContract.mock.calls
      .map((c) => (c[0] || {}) as Record<string, unknown>)
      .filter((p) => (p.contract as Record<string, unknown> | null)?.respuesta_voz === RESPUESTA_IA);
    expect(
      respuestas.length,
      'la consulta flu no llego a la IA: ' + JSON.stringify(onContract.mock.calls.map((c) => c[0])),
    ).toBeGreaterThan(0);

    // 2) La continuacion llega como resultado nuevo del ASR.
    await dictar(
      [
        { isFinal: false, transcript: PETICION },
        { isFinal: false, transcript: CONTINUACION },
      ],
      1,
    );

    // A) La caja conserva la peticion Y lo que se siguio diciendo.
    const caja = String(vista.result.current.liveTranscript || '');
    expect(caja, 'la caja perdio la peticion: ' + JSON.stringify(caja)).toContain(PETICION_CUERPO);
    expect(caja, 'la caja perdio la continuacion: ' + JSON.stringify(caja)).toContain(CONTINUACION_CUERPO);

    // 3) Cierre real del turno.
    act(() => {
      h.recognition.onend?.();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // B) La fila del cierre lleva TODA la locucion.
    const filas = filasDelTurno(onContract);
    const filaCompleta = filas.filter(
      (f) => f.includes(PETICION_CUERPO) && f.includes(CONTINUACION_CUERPO),
    );
    expect(
      filaCompleta.length,
      'ninguna fila de cierre conserva la locucion completa: ' + JSON.stringify(filas),
    ).toBeGreaterThan(0);
  });

  it('COMANDO con wake INLINE y nombre propio (medido 21:20:48-21:21:27): la orden conserva "soy Luis" y la locucion siguiente se cierra aparte', async () => {
    vi.useFakeTimers();
    const onContract = vi.fn();
    const vista = await arrancarEscucha(onContract);

    // TEXTOS LITERALES del log de la ultima prueba (21:20:48 y 21:21:22).
    const COMANDO = 'digo El Comando para que le ponga nombre Okay flu soy Luis'; // 58 chars medidos
    const PREFIJO_PASIVO = 'digo el comando para que le ponga nombre'; // 40 chars: la fila quedo en esto
    const CONTINUACION =
      'Okay ahora vamos a continuar ya puso a todos menos al primer la primera intervención hablarte uno tampoco lo puso que se vuelve a repetir el error anterior que ya se había reportado a la primera intervención no la no le pone el nombre propio está mal o sea no hay una una solución de cada cosa que se está reportando'; // 316 chars medidos
    const COLA_CONTINUACION = 'no hay una una solución de cada cosa que se está reportando';

    // 1) El comando llega en un INTERINO con wake INLINE: habia texto pasivo ANTES
    //    de "Okay flu". El despacho capturo la frase COMPLETA (medido: commandText
    //    con "soy Luis"; el defecto la recortaba al prefijo de 40).
    await dictar([{ isFinal: false, transcript: COMANDO }], 0);

    const ordenes = onContract.mock.calls
      .map((c) => (c[0] || {}) as Record<string, unknown>)
      .filter((p) => (p.contract as Record<string, unknown> | null)?.navegacion);
    expect(
      ordenes.length,
      'la orden no se despacho: ' + JSON.stringify(onContract.mock.calls.map((c) => c[0])),
    ).toBeGreaterThan(0);
    const textoOrden = ordenes.map((p) => String(p.transcript || '')).join(' | ').toLowerCase();
    expect(
      textoOrden,
      'la orden se despacho recortada (sin el nombre propio): ' + JSON.stringify(textoOrden),
    ).toContain('soy luis');

    // 2) La orden consumio la linea viva COMPLETA: la caja quedo cerrada y la
    //    locucion siguiente NO puede heredar el comando (defecto medido: la linea
    //    sobrevivio con los 58 y la continuacion se le pego).
    const cajaTrasOrden = String(vista.result.current.liveTranscript || '');
    expect(
      cajaTrasOrden.toLowerCase(),
      'la linea no se cerro tras la orden: ' + JSON.stringify(cajaTrasOrden),
    ).not.toContain('digo el comando');

    // 3) La locucion siguiente (316, medida) llega como resultado NUEVO del ASR.
    await dictar(
      [
        { isFinal: false, transcript: COMANDO },
        { isFinal: false, transcript: CONTINUACION },
      ],
      1,
    );
    const caja = String(vista.result.current.liveTranscript || '');
    expect(caja, 'la caja perdio la locucion siguiente: ' + JSON.stringify(caja)).toContain(
      'ahora vamos a continuar',
    );
    expect(
      caja.toLowerCase(),
      'la locucion siguiente se pego al comando: ' + JSON.stringify(caja),
    ).not.toContain('digo el comando');

    // 4) FINAL del tramo y CIERRE REAL por SILENCIO (medido 21:21:26.564: sr-silence).
    await dictar(
      [
        { isFinal: false, transcript: COMANDO },
        { isFinal: true, transcript: CONTINUACION },
      ],
      1,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    const filas = filasDelTurno(onContract);
    // B) La locucion siguiente llega ENTERA (su cola incluida), no recortada.
    const filaCola = filas.filter((f) => f.includes('ahora vamos a continuar'));
    expect(
      filaCola.length,
      'sin fila para la locucion siguiente: ' + JSON.stringify(filas),
    ).toBeGreaterThan(0);
    expect(
      filaCola.join(' '),
      'la locucion siguiente se recorto: ' + JSON.stringify(filaCola),
    ).toContain(COLA_CONTINUACION);
    // C) Ninguna fila queda en el prefijo pasivo de 40 (la fila medida que se
    //    reuso con len=40 y borro "soy Luis" y los 316). La fila del COMANDO la
    //    escribe la app desde el payload de la orden que la asercion 1 ya midio
    //    completa; esta puerta mide las filas del cierre por la tuberia.
    expect(
      filas.some((f) => f.trim().toLowerCase() === PREFIJO_PASIVO),
      'fila recortada al prefijo pasivo: ' + JSON.stringify(filas),
    ).toBe(false);
  });
});
