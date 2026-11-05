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
// cierre posterior. Este replay reproduce ESE escenario con la tuberia REAL del
// hook: motor CONVERSACION, ingesta, VAD, caja y almacen Dexie reales; solo se
// sustituye la frontera (reconocedor del navegador, red, audio y pipeline de
// identidad). El PCM del microfono se inyecta (tono 220 Hz sobre el piso del
// VAD) para que el tramo abra: sin audio medido el modulo descarta el texto
// como `huerfano` (`ingesta.ts`).
//
// CONTRATO NUEVO (corte 2026-10-26): la locucion viva pertenece al MODULO; el
// despacho sale de la frase canonica del modulo (`onFraseCanonica` de la
// composicion), el cierre es la frontera VAD (silencio sostenido) y la fila se
// escribe en Dexie al cerrar. Chrome entrega el dictado que sigue al comando
// como el MISMO interino que CRECE; la regla de revision del modulo
// (`unirRevision`) nunca concatena colas de resultados distintos, asi que una
// locucion nueva del ASR es un TRAMO nuevo (silencio de por medio).
//
// QUE SE FIJA (misma defensa del defecto, con los duenos nuevos):
//   A. Ejecutar la orden a mitad del dictado NO borra lo ya dictado: la caja
//      del modulo conserva el mandato Y lo que se siguio diciendo.
//   B. El cierre VAD escribe UNA fila con TODA la locucion (Dexie), no solo con
//      el trozo posterior al comando.
//   C. Con wake INLINE y nombre propio (medido 21:20:48-21:21:27): la orden
//      conserva "soy Luis", la locucion del comando cierra su fila completa y
//      la locucion siguiente se cierra APARTE, sin heredar el comando ni
//      quedar en el prefijo pasivo.
// La prueba es falsificable: con la linea vieja que vaciaba la locucion al
// entrar al dispatch, el cierre pierde el mandato.
// ============================================================
import 'fake-indexeddb/auto';
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
  return { integration, recognition, mic, fluContract: vi.fn() };
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
  getRecognitionLanguage: vi.fn((l) => (l === 'en' ? 'en-US' : 'es-ES')),
  isBilingualListenMode: vi.fn((l) => l === 'both'),
  resolveRecognitionLocale: vi.fn((l) => (l === 'en' ? 'en-US' : 'es-ES')),
}));

// El PCM del microfono se captura para inyectarlo desde el test: el VAD y el
// motor son los reales, solo se sustituye la fuente de audio del navegador. El
// modulo se alimenta del tap CRUDO (`onRawPcmBlock`, pre-ganancia): ahi esta
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
  getLocalFallbackRuntimeConfig: vi.fn(() => ({ recoveryMs: 20000, recoverySegments: 3, probeMs: 4000, finalMinSpeechLikeMs: 180, partialMinSpeechLikeMs: 300 })),
  resolveSilentDegrade: vi.fn(() => ({ degrade: false, speechLikeMs: 0, rms: 0, voicedMs: 0, sinceSrResultMs: 0, failedRebuilds: 0, log: '' })),
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
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';
import { fluDb } from '../src/core/db/fluDatabase';
import { getVadEnergyThreshold } from '../src/voice/lib/asr/asrConfig.js';

const SR = 48000;
const BLOQUE_MS = 100;

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

/** Tono con RMS cuatro veces por encima del piso REAL del VAD. */
function tono(ms: number): Float32Array {
  const n = Math.round((SR * ms) / 1000);
  const muestras = new Float32Array(n);
  const amplitud = Math.sqrt(2) * getVadEnergyThreshold() * 4;
  for (let i = 0; i < n; i += 1) muestras[i] = Math.sin((2 * Math.PI * 220 * i) / SR) * amplitud;
  return muestras;
}

/** Silencio digital del mismo tamaño. */
function silencio(ms: number): Float32Array {
  return new Float32Array(Math.round((SR * ms) / 1000));
}

let cursorMuestras = 0;

/** Entrega un bloque de PCM al pipeline REAL del hook como lo haría el micrófono. */
function empujarAudio(muestras: Float32Array) {
  expect(h.mic.onRawPcmBlock, 'el pipeline del micrófono se cableó').toBeTypeOf('function');
  h.mic.onRawPcmBlock?.(muestras, { sampleIndex: cursorMuestras });
  cursorMuestras += muestras.length;
}

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
  vistaActiva = vista;
  return vista;
}

/** Un tramo de dictado: voz primero (abre el tramo del VAD) y el evento del ASR. */
async function dictar(
  specs: Array<{ isFinal?: boolean; transcript: string }>,
  resultIndex: number,
) {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) empujarAudio(tono(BLOQUE_MS));
    await Promise.resolve();
  });
  await act(async () => {
    h.recognition.onresult?.(chromeEvent(specs, resultIndex));
    await Promise.resolve();
  });
}

/** Cierra la locucion vigente con silencio sostenido y espera la fila en Dexie. */
async function cerrarLocucion(filasEsperadas: number) {
  const bloques = Math.ceil(FLU_CONFIG.transcript.pauseAndWeakAsr.srGapCommitMs / BLOQUE_MS) + 200;
  await act(async () => {
    for (let i = 0; i < bloques; i += 1) empujarAudio(silencio(BLOQUE_MS));
    await Promise.resolve();
  });
  await waitFor(async () => {
    expect(await fluDb.conversations.count(), 'la locucion cerrada escribe su fila en Dexie').toBe(filasEsperadas);
  });
}

/** Filas del cierre real: el modulo escribe en Dexie al cerrar la locucion. */
async function filasDexie(): Promise<string[]> {
  const filas = await fluDb.conversations.toArray();
  return filas.map((f) => String((f as { text?: unknown }).text || ''));
}

let vistaActiva: { unmount: () => void } | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  h.fluContract.mockResolvedValue({
    contract: {
      respuesta_voz: RESPUESTA_IA,
      navegacion: { comando: null, destino: null, parametros: {} },
    },
    diagnostics: null,
  });
  Object.assign(h.integration, {
    lastCommittedTranscript: '',
    conversationHistory: [],
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
  vistaActiva?.unmount();
  vistaActiva = null;
  vi.useRealTimers();
});

describe('replay 2026-10-19 · defecto 5: la orden a mitad del dictado no borra la locucion', () => {
  it('COMANDO en el interino (GENERAR_RESUMEN): la caja y la fila de cierre conservan TODO', async () => {
    const onContract = vi.fn();
    await fluDb.conversations.clear();
    const vista = await arrancarEscucha(onContract);

    // La wake va al INICIO del mandato: lo dicho despues del comando sigue siendo
    // parte de la MISMA locucion (no hay prefijo pasivo que recortar al cerrar).
    const MANDATO = 'ok flu genera la minuta';
    const MANDATO_CUERPO = 'genera la minuta';
    const CONTINUACION = 'y tambien quiero que revises la transcripcion de la sala';
    const CONTINUACION_CUERPO = 'revises la transcripcion';

    // PCM del microfono: 1 s de silencio calibra el VAD.
    await act(async () => {
      for (let i = 0; i < 10; i += 1) empujarAudio(silencio(BLOQUE_MS));
      await Promise.resolve();
    });

    // 1) El mandato llega como interino CON voz: el tramo abre y el comando se
    //    despacha A MITAD del dictado (frase canonica del modulo, `onFraseCanonica`).
    await dictar([{ isFinal: false, transcript: MANDATO }], 0);

    // ANTI-VACUIDAD: el comando se ejecuto de verdad (contrato GENERAR_RESUMEN).
    const comandos = () => onContract.mock.calls
      .map((c) => (c[0] || {}) as Record<string, unknown>)
      .filter((p) => (p.contract as Record<string, unknown> | null)?.navegacion &&
        ((p.contract as Record<string, unknown>).navegacion as Record<string, unknown>).comando === 'GENERAR_RESUMEN');
    await waitFor(() => {
      expect(
        comandos().length,
        'el comando no se despacho: ' + JSON.stringify(onContract.mock.calls.map((c) => c[0])),
      ).toBeGreaterThan(0);
    });
    // La rama flu NO puede haberse disparado en paralelo (una sola accion por turno).
    expect(h.fluContract, 'el mandato se trato como consulta flu').not.toHaveBeenCalled();

    // 2) Chrome CRECE el MISMO interino con la continuacion (el habla real que
    //    sigue al comando, en el mismo enunciado): la caja no puede perderla.
    await dictar([{ isFinal: false, transcript: MANDATO + ' ' + CONTINUACION }], 0);

    // A) La caja de la ultima frase conserva el mandato Y la continuacion.
    const caja = String(vista.result.current.liveTranscript || '');
    expect(caja, 'la caja perdio el mandato: ' + JSON.stringify(caja)).toContain(MANDATO_CUERPO);
    expect(caja, 'la caja perdio la continuacion: ' + JSON.stringify(caja)).toContain(CONTINUACION_CUERPO);

    // 3) CIERRE REAL: silencio sostenido cierra la locucion (frontera VAD).
    await cerrarLocucion(1);

    // B) La fila del cierre lleva TODA la locucion (mandato + continuacion).
    const filas = await filasDexie();
    const filaCompleta = filas.filter(
      (f) => f.includes(MANDATO_CUERPO) && f.includes(CONTINUACION_CUERPO),
    );
    expect(
      filaCompleta.length,
      'ninguna fila de cierre conserva la locucion completa: ' + JSON.stringify(filas),
    ).toBeGreaterThan(0);
  });

  it('CONSULTA en el interino (minuta de conocimiento): la caja y la fila de cierre conservan TODO', async () => {
    const onContract = vi.fn();
    await fluDb.conversations.clear();
    const vista = await arrancarEscucha(onContract);

    const PETICION = 'ok flu platicame de la minuta uno';
    const PETICION_CUERPO = 'platicame de la minuta';
    const CONTINUACION = 'y tambien quiero que revises la transcripcion de la sala';
    const CONTINUACION_CUERPO = 'revises la transcripcion';

    // PCM del microfono: 1 s de silencio calibra el VAD.
    await act(async () => {
      for (let i = 0; i < 10; i += 1) empujarAudio(silencio(BLOQUE_MS));
      await Promise.resolve();
    });

    // 1) La consulta de minuta se despacha sobre el interino con la locucion
    //    abierta, ANTES de que ese mismo interino crezca con el resto del dictado.
    await dictar([{ isFinal: false, transcript: PETICION }], 0);

    // ANTI-VACUIDAD: la IA respondio de verdad con el contrato de la consulta.
    const respuestas = () => onContract.mock.calls
      .map((c) => (c[0] || {}) as Record<string, unknown>)
      .filter((p) => (p.contract as Record<string, unknown> | null)?.respuesta_voz === RESPUESTA_IA);
    await waitFor(() => {
      expect(
        respuestas().length,
        'la consulta flu no llego a la IA: ' + JSON.stringify(onContract.mock.calls.map((c) => c[0])),
      ).toBeGreaterThan(0);
    });

    // 2) El dictado crece en el MISMO interino.
    await dictar([{ isFinal: false, transcript: PETICION + ' ' + CONTINUACION }], 0);

    // A) La caja conserva la peticion Y lo que se siguio diciendo.
    const caja = String(vista.result.current.liveTranscript || '');
    expect(caja, 'la caja perdio la peticion: ' + JSON.stringify(caja)).toContain(PETICION_CUERPO);
    expect(caja, 'la caja perdio la continuacion: ' + JSON.stringify(caja)).toContain(CONTINUACION_CUERPO);

    // 3) Cierre real de la locucion (frontera VAD).
    await cerrarLocucion(1);

    // B) La fila del cierre lleva TODA la locucion.
    const filas = await filasDexie();
    const filaCompleta = filas.filter(
      (f) => f.includes(PETICION_CUERPO) && f.includes(CONTINUACION_CUERPO),
    );
    expect(
      filaCompleta.length,
      'ninguna fila de cierre conserva la locucion completa: ' + JSON.stringify(filas),
    ).toBeGreaterThan(0);
  });

  it('COMANDO con wake INLINE y nombre propio (medido 21:20:48-21:21:27): la orden conserva "soy Luis" y la locucion siguiente se cierra aparte', async () => {
    const onContract = vi.fn();
    await fluDb.conversations.clear();
    const vista = await arrancarEscucha(onContract);

    // TEXTOS LITERALES del log de la ultima prueba (21:20:48 y 21:21:22).
    const COMANDO = 'digo El Comando para que le ponga nombre Okay flu soy Luis'; // 58 chars medidos
    const PREFIJO_PASIVO = 'digo el comando para que le ponga nombre'; // 40 chars: la fila quedo en esto
    const CONTINUACION =
      'Okay ahora vamos a continuar ya puso a todos menos al primer la primera intervención hablarte uno tampoco lo puso que se vuelve a repetir el error anterior que ya se había reportado a la primera intervención no la no le pone el nombre propio está mal o sea no hay una una solución de cada cosa que se está reportando'; // 316 chars medidos
    const COLA_CONTINUACION = 'no hay una una solución de cada cosa que se está reportando';

    // PCM del microfono: 1 s de silencio calibra el VAD.
    await act(async () => {
      for (let i = 0; i < 10; i += 1) empujarAudio(silencio(BLOQUE_MS));
      await Promise.resolve();
    });

    // 1) El comando llega en un INTERINO con wake INLINE: habia texto pasivo ANTES
    //    de "Okay flu". El despacho capturo la frase COMPLETA (medido: commandText
    //    con "soy Luis"; el defecto la recortaba al prefijo de 40).
    await dictar([{ isFinal: false, transcript: COMANDO }], 0);

    const ordenes = () => onContract.mock.calls
      .map((c) => (c[0] || {}) as Record<string, unknown>)
      .filter((p) => (p.contract as Record<string, unknown> | null)?.navegacion);
    await waitFor(() => {
      expect(
        ordenes().length,
        'la orden no se despacho: ' + JSON.stringify(onContract.mock.calls.map((c) => c[0])),
      ).toBeGreaterThan(0);
    });
    const textoOrden = ordenes().map((p) => String(p.transcript || '')).join(' | ').toLowerCase();
    expect(
      textoOrden,
      'la orden se despacho recortada (sin el nombre propio): ' + JSON.stringify(textoOrden),
    ).toContain('soy luis');

    // CONTRATO NUEVO: ejecutar la orden NO borra el dictado en vuelo (el defecto
    // media la linea vaciada al entrar al dispatch). La caja del modulo conserva
    // el mandato completo hasta que el silencio cierra la locucion.
    const cajaTrasOrden = String(vista.result.current.liveTranscript || '');
    expect(
      cajaTrasOrden.toLowerCase(),
      'el dispatch borro el dictado: ' + JSON.stringify(cajaTrasOrden),
    ).toContain('soy luis');

    // 2) CIERRE de la locucion del comando por SILENCIO (medido 21:21:26.564
    //    sr-silence): la fila del comando queda COMPLETA (sin recortes).
    await cerrarLocucion(1);

    // 3) La locucion siguiente (316, medida) llega como resultado NUEVO del ASR
    //    (indice 1): tramo nuevo, caja nueva, sin heredar el comando.
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

    // 4) CIERRE por silencio de la locucion siguiente.
    await cerrarLocucion(2);

    const filas = await filasDexie();
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
    //    reuso con len=40 y borro "soy Luis" y los 316).
    expect(
      filas.some((f) => f.trim().toLowerCase() === PREFIJO_PASIVO),
      'fila recortada al prefijo pasivo: ' + JSON.stringify(filas),
    ).toBe(false);
    // D) La fila del comando conserva el nombre propio: el modulo cierra su
    //    locucion con el texto COMPLETO dictado (58 chars medidos).
    const filaComando = filas.filter((f) => f.toLowerCase().includes('soy luis'));
    expect(
      filaComando.length,
      'la fila del comando perdio el nombre propio: ' + JSON.stringify(filas),
    ).toBeGreaterThan(0);
  });
});
