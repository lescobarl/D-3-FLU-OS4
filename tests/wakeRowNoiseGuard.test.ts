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
 * REGLA (un solo dueno): con `voiceCommands.requireWakeAlways` (aula/casa), una
 * captura SIN wake en conversacion activa NO es un turno del usuario -> NO se
 * emite su fila de conversacion (ni la ve el usuario ni la lee la IA). Su texto
 * sigue en la transcripcion viva, y la fila de SESION se sigue escribiendo
 * (`commitTurnToSessionRows`), que es la via del dictado/minuta. Una captura
 * MIXTA ("... ok flu <orden>") conserva su fila pasiva: su wake la marca como
 * turno.
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
  it('una captura SIN wake (TV/aula) no emite fila, pero si su fila de sesion', () => {
    const deps = makeDeps();

    handleConversationStreamSync(deps, { capture: RUIDO, turnCommit: true });

    // No hay fila de conversacion (lo que ve el usuario y lo que lee la IA).
    expect(deps.emitConversationLog).not.toHaveBeenCalled();
    // El turno CIERRA igual: sin esto quedaria abierto y el siguiente se fusionaria.
    expect(deps.flushPcmAfterTurnCommit).toHaveBeenCalledTimes(1);
    expect(deps.flushPendingStreamLog).toHaveBeenCalledTimes(1);
    expect(deps.openPreviewTurnRef.current).toBe(false);
    expect(deps.publishedLiveRef.current).toBe('');
    expect(deps.fluParticipantRef.current.onTurnCommitted).toHaveBeenCalledTimes(1);
    // Dictado/minuta: la fila de SESION si recibe el texto (via separada del log).
    expect(deps.commitTurnToSessionRows).toHaveBeenCalledTimes(1);
    expect(deps.commitTurnToSessionRows.mock.calls[0][0]).toBe(RUIDO);
  });

  it('una orden CON wake si abre su fila', () => {
    const deps = makeDeps();

    handleConversationStreamSync(deps, { capture: ORDEN, turnCommit: true });

    expect(deps.emitConversationLog).toHaveBeenCalledTimes(1);
    expect(deps.emitConversationLog.mock.calls[0][0]).toBe(ORDEN);
    expect(deps.commitTurnToSessionRows).toHaveBeenCalledTimes(1);
  });

  it('la captura MIXTA conserva su fila pasiva y despacha la cola flu', () => {
    const deps = makeDeps();

    handleConversationStreamSync(deps, { capture: MIXTA, turnCommit: true });

    expect(deps.emitConversationLog).toHaveBeenCalledTimes(1);
    const [emitText] = deps.emitConversationLog.mock.calls[0] as [string];
    expect(emitText).toBe('el cocodrilo se pone a aventar cosas');
    expect(emitText).not.toContain('flow');
    expect(deps.processConversationFluQueryRef.current).toHaveBeenCalledTimes(1);
  });

  it('con la continuidad sin wake (requireWakeAlways=false) la misma captura si abre fila', () => {
    FLU_CONFIG.voiceCommands.requireWakeAlways = false;
    const deps = makeDeps();

    handleConversationStreamSync(deps, { capture: RUIDO, turnCommit: true });

    // La regla es de configuracion, no un cambio silencioso del modo antiguo.
    expect(deps.emitConversationLog).toHaveBeenCalledTimes(1);
  });
});

// P2.4 - prueba de detector: el MISMO texto, con y sin wake, discrimina.
describe('P8.36 - el ruido de fondo no acuna id de turno (si lo moviera, la resolucion duplicaria)', () => {
  it('un FINAL de ruido no acuna id; una orden con wake si', () => {
    const ruido = makeDeps();
    handleConversationStreamSync(ruido, { capture: RUIDO, turnCommit: true });
    expect(ruido.activeTurnIdRef.current).toBe(0);

    const orden = makeDeps();
    handleConversationStreamSync(orden, { capture: ORDEN, turnCommit: true });
    expect(orden.activeTurnIdRef.current).toBe(1);
  });

  it('un PREVIEW de ruido no mueve el id del turno VIVO (antes lo movia: 1 -> 2)', () => {
    const deps = makeDeps();

    handleConversationStreamSync(deps, { capture: ORDEN, turnCommit: true });
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

// P2.4 - prueba de detector: el MISMO texto, con y sin wake, discrimina.
describe('P8.38 - el detector no es decorativo', () => {
  it('la marca distingue la captura sin wake de la misma con wake', () => {
    const conRuido = makeDeps();
    handleConversationStreamSync(conRuido, { capture: RUIDO, turnCommit: true });
    const conWake = makeDeps();
    handleConversationStreamSync(conWake, { capture: `okay flow ${RUIDO}`, turnCommit: true });

    expect(conRuido.emitConversationLog).toHaveBeenCalledTimes(0);
    expect(conWake.emitConversationLog).toHaveBeenCalledTimes(1);
  });

  it('la marca no depende del tamano del texto (ruido largo y ruido corto)', () => {
    const corto = makeDeps();
    handleConversationStreamSync(corto, { capture: 'el cocodrilo', turnCommit: true });
    const largo = makeDeps();
    handleConversationStreamSync(largo, { capture: MIXTA.replace('okay flow pon musica', '').trim(), turnCommit: true });

    expect(corto.emitConversationLog).toHaveBeenCalledTimes(0);
    expect(largo.emitConversationLog).toHaveBeenCalledTimes(0);
  });
});
