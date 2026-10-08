/**
 * P8.38 - El RUIDO DE FONDO no abre fila de conversacion (aula/casa).
 *
 * DEFECTO MEDIDO (2026-10-03, banco de simulacion sobre la app real): con la
 * wake word ya exigida SIEMPRE (P8.37), las 3 frases de ambiente de la escena
 * "salon + TV" seguian apareciendo como FILAS de usuario (3 de 3), atribuidas a
 * "Hablante 1", mientras a la IA solo llegaba 1 contrato (el legitimo). La traza
 * del escritor del store mostro el camino: la captura de ambiente se commitea en
 * el stream (`handleConversationStreamSync`, turnCommit) y el log crudo del
 * payload abre la fila por el escritor unico `commitUserTurnRow`. El camino de
 * RECHAZO del hook no la escribe: cuando llega ahi, la fila ya existe.
 *
 * REGLA VIGENTE (dueno, 2026-10-06 — corrige P8.38): la wake SOLO es compuerta
 * de ACCION (¿se ejecuta el comando?), NUNCA de fila. La TRANSCRIPCION se registra
 * SIEMPRE en la conversacion, con o sin wake y con la bandera puesta. Lo unico que
 * NO abre fila es la re-emision de la MISMA locucion viva (`ambientRowBlocked`). La
 * respuesta de FLU sigue exigiendo la wake (eso lo decide el ingress, no la fila).
 * Una captura MIXTA ("... ok flu <orden>") se registra igual: su wake es compuerta
 * de la ACCION, no de la fila.
 *
 * El oraculo es la conducta observada por los callbacks (colaboradores REALES:
 * wakeTurnCommit, conversationStream, speakerPolicy), no una reimplementacion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js';
import { createActiveListenState } from '../src/voice/lib/activeListen.js';
import { resetTurnSpeakerPreflights } from '../src/voice/lib/turnSpeakerPreflight.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const RUIDO = 'se puso el cocodrilo';
const ORDEN = 'okay flow platicame de huatulco';
const MIXTA = 'el cocodrilo se pone a aventar cosas okay flow pon musica';

/** Arnes minimo: refs reales (objetos con .current) y espias grabados. */
function makeDeps(over: Record<string, unknown> = {}) {
  const deps = {
    conversationActiveRef: { current: true },
    publishedLiveRef: { current: '' },
    listenStateRef: { current: createActiveListenState() },
    openPreviewTurnRef: { current: false },
    setLiveTranscript: vi.fn<(value: string) => void>(),
    scheduleLiveTranscriptUpdate: vi.fn<(capture: string) => void>(),
    applyConversationSpeaker: vi.fn<(phrase: string, fallback: string, options?: object) => void>(),
    flushPendingStreamLog: vi.fn<() => void>(),
    logRowsTextRef: { current: [] as string[] },
    activeTurnIdRef: { current: 0 },
    flushPcmAfterTurnCommit: vi.fn<() => void>(),
    lastCommitAtRef: { current: 0 },
    lastOnresultAtRef: { current: 0 },
    turnAudioStartSampleRef: { current: 0 },
    chunkTotalSamplesRef: { current: 0 },
    preflightScheduledForTurnRef: { current: true },
    srGapFiredForOpenLineRef: { current: true },
    processConversationFluQueryRef: {
      current: vi.fn<(capture: string, action: object) => void>(),
    },
    lastEmittedTranscriptRef: { current: '' },
    emitConversationLog: vi.fn<(capture: string, options?: object) => boolean>(() => true),
    createSpeakerAudioResolver: vi.fn<(options?: object) => object>(() =>
      () => Promise.resolve({ speakerName: 'Hablante 1' }),
    ),
    sessionPrimarySpeakerRef: { current: '' },
    lastLoggedSpeakerRef: { current: '' },
    logRowSpeakersRef: { current: [] as string[] },
    speakerClustersRef: { current: [] as object[] },
    setSpeakerClusters: vi.fn<(clusters: object[]) => void>(),
    lastSpeakerRef: { current: '' },
    lastTurnSignatureRef: { current: null as number[] | null },
    lastLogLineTextRef: { current: '' },
    commitTurnToSessionRows: vi.fn<(capture: string, speakerName: string, options?: object) => void>(),
    fluParticipantRef: { current: { onTurnCommitted: vi.fn<() => void>() } },
  };
  Object.assign(deps, over);
  return deps;
}

const requireWakeAlwaysBefore = FLU_CONFIG.voiceCommands.requireWakeAlways;

beforeEach(() => {
  resetTurnSpeakerPreflights();
  FLU_CONFIG.voiceCommands.requireWakeAlways = true;
});

afterEach(() => {
  FLU_CONFIG.voiceCommands.requireWakeAlways = requireWakeAlwaysBefore;
});

describe('P8.38 - el ruido de fondo no abre fila de conversacion', () => {
  it('una captura SIN wake (TV/aula) TAMBIEN registra su fila: la transcripcion es siempre', () => {
    const deps = makeDeps();

    handleConversationStreamSync(deps, { capture: RUIDO, turnCommit: true, settlesTurn: true });

    // La transcripcion se ve SIEMPRE (la bandera no gatea la fila, solo la accion).
    expect(deps.emitConversationLog).toHaveBeenCalledTimes(1);
    expect(deps.emitConversationLog.mock.calls[0][0]).toBe(RUIDO);
    // El turno CIERRA igual: sin esto quedaria abierto y el siguiente se fusionaria.
    expect(deps.flushPcmAfterTurnCommit).toHaveBeenCalledTimes(1);
    expect(deps.flushPendingStreamLog).toHaveBeenCalledTimes(1);
    expect(deps.openPreviewTurnRef.current).toBe(false);
    expect(deps.publishedLiveRef.current).toBe('');
    expect(deps.fluParticipantRef.current.onTurnCommitted).toHaveBeenCalledTimes(1);
    // Dictado/minuta: la fila de SESION tambien recibe el texto.
    expect(deps.commitTurnToSessionRows).toHaveBeenCalledTimes(1);
    expect(deps.commitTurnToSessionRows.mock.calls[0][0]).toBe(RUIDO);
  });

  it('una orden CON wake si abre su fila', () => {
    const deps = makeDeps();

    handleConversationStreamSync(deps, { capture: ORDEN, turnCommit: true, settlesTurn: true });

    expect(deps.emitConversationLog).toHaveBeenCalledTimes(1);
    expect(deps.emitConversationLog.mock.calls[0][0]).toBe(ORDEN);
    expect(deps.commitTurnToSessionRows).toHaveBeenCalledTimes(1);
  });

  it('la captura MIXTA conserva su fila pasiva y despacha la cola flu', () => {
    const deps = makeDeps();

    handleConversationStreamSync(deps, { capture: MIXTA, turnCommit: true, settlesTurn: true });

    expect(deps.emitConversationLog).toHaveBeenCalledTimes(1);
    const [emitText] = deps.emitConversationLog.mock.calls[0] as [string];
    expect(emitText).toBe('el cocodrilo se pone a aventar cosas');
    expect(emitText).not.toContain('flow');
    expect(deps.processConversationFluQueryRef.current).toHaveBeenCalledTimes(1);
  });

  it('con la continuidad sin wake (requireWakeAlways=false) la misma captura si abre fila', () => {
    FLU_CONFIG.voiceCommands.requireWakeAlways = false;
    const deps = makeDeps();

    handleConversationStreamSync(deps, { capture: RUIDO, turnCommit: true, settlesTurn: true });

    // La regla es de configuracion, no un cambio silencioso del modo antiguo.
    expect(deps.emitConversationLog).toHaveBeenCalledTimes(1);
  });
});

// P2.4 - prueba de detector: el MISMO texto, con y sin wake, discrimina.
describe('P8.36 - el id del turno se acuna para todo COMMIT con fila', () => {
  it('un FINAL sin wake TAMBIEN acuna id (su fila lo necesita); una orden con wake, tambien', () => {
    const ruido = makeDeps();
    handleConversationStreamSync(ruido, { capture: RUIDO, turnCommit: true, settlesTurn: true });
    expect(ruido.activeTurnIdRef.current).toBe(1);

    const orden = makeDeps();
    handleConversationStreamSync(orden, { capture: ORDEN, turnCommit: true, settlesTurn: true });
    expect(orden.activeTurnIdRef.current).toBe(1);
  });

  it('un PREVIEW de ruido no mueve el id del turno VIVO (antes lo movia: 1 -> 2)', () => {
    const deps = makeDeps();

    handleConversationStreamSync(deps, { capture: ORDEN, turnCommit: true, settlesTurn: true });
    expect(deps.activeTurnIdRef.current).toBe(1);

    // El ruido de fondo entre el commit y la RESOLUCION: la resolucion escribe la
    // fila con `activeTurnIdRef.current`, asi que si el ruido acunara id (2) la
    // fila se AGREGARIA en vez de reutilizarse -> dos filas de la misma frase.
    handleConversationStreamSync(deps, { capture: RUIDO });
    expect(deps.activeTurnIdRef.current).toBe(1);
    expect(deps.openPreviewTurnRef.current).toBe(false);

    // El mismo preview SIN ruido (una orden real) si abre turno nuevo.
    handleConversationStreamSync(deps, { capture: `okay flow ${ORDEN}` });
    expect(deps.activeTurnIdRef.current).toBe(2);
  });
});

// P8.49 - DECISION DE PRODUCTO fijada en el DEFAULT (no en una copia): la voz del
// usuario NUNCA se descarta en silencio. Este caso lee la config de fabrica; si
// alguien vuelve a exigir la wake por defecto, cae aqui (el sintoma que reporto el
// dueno: "la transcripcion aparece en la ultima frase y NO se ve en la conversacion").
describe('P8.49 - por defecto la captura SIN wake SI se refleja en la conversacion', () => {
  it('con la config de fabrica, una captura sin wake en conversacion activa abre su fila', () => {
    FLU_CONFIG.voiceCommands.requireWakeAlways = requireWakeAlwaysBefore; // el default real del repo
    const deps = makeDeps();

    handleConversationStreamSync(deps, { capture: RUIDO, turnCommit: true, settlesTurn: true });

    expect(deps.emitConversationLog).toHaveBeenCalledTimes(1);
    expect(deps.emitConversationLog.mock.calls[0][0]).toBe(RUIDO);
  });
});

// P2.4 - prueba de DETECTOR: si alguien vuelve a poner la wake como compuerta de
// FILA (el defecto que el dueno reporto el 2026-10-06), este caso cae en ROJO: la
// captura SIN wake dejaria de emitir. La marca ya no depende del tamano ni del texto.
describe('P8.84 - el detector no es decorativo (la fila NO depende de la wake)', () => {
  it('una captura SIN wake emite fila (infractor: volver a gatear la fila por wake)', () => {
    const sinWake = makeDeps();
    handleConversationStreamSync(sinWake, { capture: RUIDO, turnCommit: true, settlesTurn: true });
    expect(sinWake.emitConversationLog).toHaveBeenCalledTimes(1);

    // Control: la MISMA captura con wake tambien emite (la wake no cambia la fila).
    const conWake = makeDeps();
    handleConversationStreamSync(conWake, { capture: `okay flow ${RUIDO}`, turnCommit: true, settlesTurn: true });
    expect(conWake.emitConversationLog).toHaveBeenCalledTimes(1);
  });

  it('la marca no depende del tamano del texto (mas de 60 s de dictado)', () => {
    const largo = makeDeps();
    handleConversationStreamSync(largo, {
      capture: MIXTA.replace('okay flow pon musica', '').trim().repeat(4),
      turnCommit: true, settlesTurn: true,
    });
    expect(largo.emitConversationLog).toHaveBeenCalledTimes(1);
  });
});
