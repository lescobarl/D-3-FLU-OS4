/**
 * voice/lib/conversationStreamCommit — la capa (492 lineas, 0% de cobertura).
 *
 * POR QUE ESTE TEST: `handleConversationStreamSync` es el ESCRITOR UNICO de la
 * fila de conversacion (preview -> commit -> log -> fila de sesion) y hasta hoy
 * solo estaba vigilado por guards de TEXTO: ningun test EJECUTABA su conducta.
 * Aqui se le da un arnes de `deps` falsas (refs y callbacks grabados) pero con
 * los COLABORADORES REALES (advancePublishedDisplay, wouldShrinkListenLog,
 * reconcileCommitText, resolveMicCommitAction, isDuplicateTurnCommit,
 * resolveInlineWakeAtCommit, resolveTurnSpeakerAtCommit...): el oraculo es la
 * conducta observada por los callbacks, no una reimplementacion de las reglas.
 *
 * La RAMA SEGMENTADA se cubre con snapshots de identidad REALES (cola de
 * identidad incluida): un prior embebido se omite y solo la voz nueva abre fila.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js';
import { createActiveListenState } from '../src/voice/lib/activeListen.js';
import {
    resetTurnSpeakerPreflights,
    scheduleTurnSpeakerPreflight,
} from '../src/voice/lib/turnSpeakerPreflight.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

// Este fichero mide la SEMANTICA del stream (preview -> commit -> fila -> cierre)
// con capturas sin wake; la politica "el ruido de fondo no abre fila" (P8.38) se
// vigila en tests/wakeRowNoiseGuard.test.ts. Aqui se fija la continuidad sin wake
// para que los dos criterios no se mezclen en el mismo oraculo.
const requireWakeAlwaysBefore = FLU_CONFIG.voiceCommands.requireWakeAlways;
beforeEach(() => {
    FLU_CONFIG.voiceCommands.requireWakeAlways = false;
});
afterEach(() => {
    FLU_CONFIG.voiceCommands.requireWakeAlways = requireWakeAlwaysBefore;
});

/** Opciones del log, tal como las lee el test (el typedef las declara `object`). */
type EmitOptions = { speakerName?: string; turnCommit?: boolean; replaceLastRawLog?: boolean };

/** Arnes minimo: refs reales (objetos con .current) y espías grabados. */
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
    isTurnLive: () => false,
    // Memoria del despacho (ultima peticion ACEPTADA): es la que dicta la
    // identidad del turno (ver la cabecera de conversationStreamCommit).
    lastRequestRef: { current: { text: '', at: 0 } },
    fluParticipantRef: { current: { onTurnCommitted: vi.fn<() => void>() } },
  };
  // Overrides del caso: Object.assign mantiene el tipo del arnes (no infiere un objeto nuevo).
  Object.assign(deps, over);
  return deps;
}

/** Opciones del ultimo log emitido, ya tipadas para el test. */
function lastEmitOptions(deps: ReturnType<typeof makeDeps>): EmitOptions {
  return deps.emitConversationLog.mock.calls[0][1] as EmitOptions;
}

// --- Rama segmentada: captura = [relleno corto][fila YA commitida][voz nueva] ---
const PRIOR_ROW = 'el examen de sociales queda para el viernes';
const NOVEL_TAIL = 'entonces hoy repasamos fracciones y hacemos ejercicios practicos';
const SEGMENTABLE_CAPTURE = `hola a todos ${PRIOR_ROW} ${NOVEL_TAIL}`;

/**
 * Snapshots de identidad REALES para el turno 1. La cola de identidad corre en
 * macrotareas (setTimeout 0), asi que se le dan ticks entre encolados.
 */
async function preflightSnapshots(labels: string[]): Promise<void> {
    resetTurnSpeakerPreflights();
    for (const speakerName of labels) {
        scheduleTurnSpeakerPreflight(1, () =>
            Promise.resolve({
                speakerName,
                speakerId: `id-${speakerName}`,
                signatureVector: [1, 0.5, 0.25],
                workingClusters: [],
                reason: 'ok',
                audioStartSample: 0,
                audioStartedAtMs: 0,
            }),
        );
        for (let tick = 0; tick < 3; tick += 1) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }
}

describe('conversationStreamCommit — puertas de entrada', () => {
    it('con la conversacion inactiva no toca NADA (ni preview ni turno)', () => {
        const deps = makeDeps({ conversationActiveRef: { current: false } });

        handleConversationStreamSync(deps, { capture: 'hola' });
        handleConversationStreamSync(deps, { capture: 'hola', turnCommit: true });

        expect(deps.publishedLiveRef.current).toBe('');
        expect(deps.activeTurnIdRef.current).toBe(0);
        expect(deps.openPreviewTurnRef.current).toBe(false);
        expect(deps.scheduleLiveTranscriptUpdate).not.toHaveBeenCalled();
        expect(deps.flushPendingStreamLog).not.toHaveBeenCalled();
        expect(deps.commitTurnToSessionRows).not.toHaveBeenCalled();
    });

    it('captura vacia sin turno nuevo: salida silenciosa (no limpia lo publicado)', () => {
        const deps = makeDeps();

        handleConversationStreamSync(deps, {});

        expect(deps.activeTurnIdRef.current).toBe(0);
        expect(deps.setLiveTranscript).not.toHaveBeenCalled();
        expect(deps.publishedLiveRef.current).toBe('');
    });

    it('captura vacia con parrafo nuevo: resetea el ancla pero NO borra lo publicado', () => {
        const deps = makeDeps({ publishedLiveRef: { current: 'algo previo' } });
        deps.openPreviewTurnRef.current = true;

        handleConversationStreamSync(deps, { newParagraph: true });

        expect(deps.publishedLiveRef.current).toBe('');
        // Lo PUBLICADO (la "ultima frase") lo borra su dueno (el reset de la sesion/voz),
        // no el commit: borrarlo aqui dejaba la zona en blanco = flicker.
        expect(deps.setLiveTranscript).not.toHaveBeenCalled();
        expect(deps.openPreviewTurnRef.current).toBe(false);
    });
});

describe('conversationStreamCommit — preview (sin turnCommit)', () => {
    it('publica la captura, agenda la actualizacion y ABRE turno (id nace una sola vez)', () => {
        const deps = makeDeps();

        handleConversationStreamSync(deps, { capture: 'hola como estas' });

        expect(deps.publishedLiveRef.current).toBe('hola como estas');
        expect(deps.scheduleLiveTranscriptUpdate).toHaveBeenCalledWith('hola como estas');
        expect(deps.openPreviewTurnRef.current).toBe(true);
        expect(deps.activeTurnIdRef.current).toBe(1);

        // Segundo preview del MISMO turno: el id no vuelve a nacer.
        handleConversationStreamSync(deps, { capture: 'hola como estas y algo mas' });

        expect(deps.activeTurnIdRef.current).toBe(1);
        expect(deps.scheduleLiveTranscriptUpdate).toHaveBeenCalledTimes(2);
    });

    it('un preview que ACORTARIA lo publicado se descarta', () => {
        const deps = makeDeps({ publishedLiveRef: { current: 'hola como estas' } });

        handleConversationStreamSync(deps, { capture: 'hola como' });

        expect(deps.publishedLiveRef.current).toBe('hola como estas');
        expect(deps.scheduleLiveTranscriptUpdate).not.toHaveBeenCalled();
        // P9.86b: el ID del turno se acuna AL ABRIR el turno y ANTES de la caja
        // (cambio deliberado 2026-10-11, con guard wakeRowNoiseGuard: "un bloqueo de
        // la frase viva no puede comerse el bump"). El preview se SIGUE descartando
        // (las dos aserciones de arriba); lo que ya no es 0 es el id.
        expect(deps.activeTurnIdRef.current).toBe(1);
    });

    it('en frontera de turno avisa al hablante con atTurnBoundary y sin abrir cluster', () => {
        const deps = makeDeps();

        handleConversationStreamSync(deps, { capture: 'hola', turnBoundary: true, utterance: 'hola' });

        expect(deps.applyConversationSpeaker).toHaveBeenCalledTimes(1);
        const [phrase, fallbackSpeaker, options] = deps.applyConversationSpeaker.mock.calls[0];
        expect(phrase).toBe('hola');
        expect(typeof fallbackSpeaker).toBe('string');
        expect(fallbackSpeaker).not.toBe('');
        expect(options).toEqual({ force: false, atTurnBoundary: true, allowNewCluster: false });
    });

    it('sin frontera de turno no consulta al hablante', () => {
        const deps = makeDeps();

        handleConversationStreamSync(deps, { capture: 'hola' });

        expect(deps.applyConversationSpeaker).not.toHaveBeenCalled();
    });
});

describe('conversationStreamCommit — commit de turno', () => {
    // CONVENCION (2026-10-08, commit e1a9cee): la fila nace en el CIERRE REAL del turno
    // (onend / srGap / split por wake), que el llamante declara con `settlesTurn: true`; un
    // `final` de SEGMENTO de Chrome (solo `turnCommit`) NO escribe fila. Los casos de aqui
    // simulan el cierre real, asi que lo declaran (lo mismo que los llamantes de produccion:
    // transcriptIngress.js:252/307 y wakeTurnCommit.js:122, y el guard wakeRowNoiseGuard).
    it('un commit normal emite log, escribe la fila, cierra el turno y avisa al participante', () => {
        const deps = makeDeps();
        deps.chunkTotalSamplesRef.current = 4800;

        handleConversationStreamSync(deps, { capture: 'hola mundo', turnCommit: true, settlesTurn: true });

        expect(deps.flushPendingStreamLog).toHaveBeenCalledTimes(1);
        expect(deps.activeTurnIdRef.current).toBe(1);
        expect(deps.emitConversationLog).toHaveBeenCalledTimes(1);
        const emitText = deps.emitConversationLog.mock.calls[0][0];
        const emitOpts = lastEmitOptions(deps);
        expect(emitText).toBe('hola mundo');
        expect(emitOpts.turnCommit).toBe(true);
        expect(emitOpts.replaceLastRawLog).toBe(false);
        expect(deps.commitTurnToSessionRows).toHaveBeenCalledTimes(1);
        const [rowText, rowSpeaker, rowOpts] = deps.commitTurnToSessionRows.mock.calls[0];
        expect(rowText).toBe('hola mundo');
        expect(rowOpts).toEqual({ replaceLast: false });
        // La misma locucion va al log y a la fila con EL MISMO hablante.
        expect(rowSpeaker).toBe(emitOpts.speakerName);
        // Sin evidencia acustica (el preflight resuelve DESPUES del commit) la fila se
        // escribe SIN hablante y la resolucion tardia la COMPLETA por identidad de
        // turno: escribir la prediccion inventaba 'Hablante 8/12' para 2 voces reales.
        expect(String(emitOpts.speakerName ?? '')).toBe(String(rowSpeaker ?? ''));

        // Cierre: el turno deja de estar abierto y la sesion queda lista para el siguiente.
        expect(deps.flushPcmAfterTurnCommit).toHaveBeenCalledTimes(1);
        expect(deps.lastCommitAtRef.current).toBeGreaterThan(0);
        expect(deps.turnAudioStartSampleRef.current).toBe(4800);
        expect(deps.openPreviewTurnRef.current).toBe(false);
        expect(deps.publishedLiveRef.current).toBe('');
        // RACIONAL DEL DUENO: la locucion YA se vacio a la conversacion -> la zona arranca de cero.
        // (mismo dueno en el flujo real: el reset de la iteracion nueva).
        expect(deps.setLiveTranscript).toHaveBeenCalledWith('');
        expect(deps.listenStateRef.current.openLine).toBe('');
        expect(deps.listenStateRef.current.pendingInterim).toBe('');
        expect(deps.preflightScheduledForTurnRef.current).toBe(false);
        expect(deps.srGapFiredForOpenLineRef.current).toBe(false);
        expect(deps.lastEmittedTranscriptRef.current).toBe('hola mundo');
        expect(deps.fluParticipantRef.current.onTurnCommitted).toHaveBeenCalledTimes(1);
    });

    it('P9.81: un nombre por CONTINUIDAD sin evidencia NO se estampa (la fila cae a generica)', () => {
        // Log del dueno (2026-10-12): una voz distinta salia con el nombre del hablante
        // anterior (`Identity label=Hablante 1 reason=production-reuse-no-evidence
        // lastSim=0.278 best="Luis"`). El commit NO puede levantar un NOMBRE propio sin
        // evidencia del turno: el duenio de esa regla es `blindSpeakerFallback`
        // (speakerPolicy), que degrada un nombre a etiqueta generica.
        const deps = makeDeps({
            lastLoggedSpeakerRef: { current: 'Luis' },
            lastSpeakerRef: { current: 'Luis' },
            sessionPrimarySpeakerRef: { current: 'Luis' },
            speakerClustersRef: { current: [{ label: 'Luis', signature: [1, 0, 0] }] },
        });

        handleConversationStreamSync(deps, { capture: 'y ahora habla la chica', turnCommit: true });

        const [, speakerName] = deps.commitTurnToSessionRows.mock.calls[0];
        expect(String(speakerName || ''), 'sin evidencia no se hereda el NOMBRE').not.toBe('Luis');
    })

    it('el participante es opcional: sin el, el commit no revienta', () => {
        const deps = makeDeps({ fluParticipantRef: { current: null } });

        expect(() =>
            handleConversationStreamSync(deps, { capture: 'hola', turnCommit: true }),
        ).not.toThrow();
        expect(deps.commitTurnToSessionRows).toHaveBeenCalledTimes(1);
    });

    it('una re-emision del mismo turno no abre fila nueva (doble onend)', () => {
        const deps = makeDeps({
            lastEmittedTranscriptRef: { current: 'hola a todos' },
        });
        deps.lastCommitAtRef.current = 1000;
        deps.lastOnresultAtRef.current = 500;

        handleConversationStreamSync(deps, { capture: 'hola a todos', turnCommit: true });

        // El turno YA se habia abierto antes de descartar la re-emision.
        expect(deps.flushPendingStreamLog).toHaveBeenCalledTimes(1);
        expect(deps.emitConversationLog).not.toHaveBeenCalled();
        expect(deps.commitTurnToSessionRows).not.toHaveBeenCalled();
        expect(deps.flushPcmAfterTurnCommit).not.toHaveBeenCalled();
    });

    it('un commit SIN fila (segmento) no marca la locucion como emitida: el CIERRE la escribe', () => {
        const deps = makeDeps({
            lastEmittedTranscriptRef: { current: 'buenos dias' },
        });
        deps.lastCommitAtRef.current = 1000;
        deps.lastOnresultAtRef.current = 2000; // hubo habla nueva: no es re-emision

        // Segmento de Chrome: escribe la fila de SESION, pero NO la de conversacion.
        handleConversationStreamSync(deps, { capture: 'hola mundo', turnCommit: true });

        expect(deps.emitConversationLog).not.toHaveBeenCalled();
        expect(deps.commitTurnToSessionRows).toHaveBeenCalledTimes(1);
        // P9.59: `lastEmittedTranscriptRef` es el texto de la ULTIMA locucion EMITIDA y es
        // la FUENTE del dedupe; un commit que no emite fila NO puede moverla, o el cierre
        // real (mismo texto, settlesTurn) caia como duplicado y la locucion se perdia.
        expect(deps.lastEmittedTranscriptRef.current).toBe('buenos dias');
        expect(deps.fluParticipantRef.current.onTurnCommitted).toHaveBeenCalledTimes(1);

        // CIERRE REAL: la misma locucion SI se escribe (no se pierde) y deja su marca.
        deps.lastOnresultAtRef.current = 0; // el cierre no trae un resultado nuevo
        handleConversationStreamSync(deps, { capture: 'hola mundo', turnCommit: true, settlesTurn: true });
        expect(deps.emitConversationLog).toHaveBeenCalledTimes(1);
        expect(deps.lastEmittedTranscriptRef.current).toBe('hola mundo');
    });

    it('revision ASR del mismo enunciado: REEMPLAZA la ultima fila y conserva su hablante', () => {
        const deps = makeDeps({
            lastEmittedTranscriptRef: { current: 'hola como estas' },
        });
        deps.lastCommitAtRef.current = 1000;
        deps.lastOnresultAtRef.current = 2000;
        deps.lastLoggedSpeakerRef.current = 'Hablante 2';
        deps.logRowSpeakersRef.current = ['Hablante 2'];
        deps.logRowsTextRef.current = ['hola como estas'];

        handleConversationStreamSync(deps, { capture: 'hola como estas', turnCommit: true });

        // Mismo texto: la fila se REEMPLAZA, pero no se re-emite el log (no hay eco duplicado).
        expect(deps.emitConversationLog).not.toHaveBeenCalled();
        const [, rowSpeaker, rowOpts] = deps.commitTurnToSessionRows.mock.calls[0];
        expect(rowOpts).toEqual({ replaceLast: true });
        // La fila escribe la ETIQUETA que trae el resolver (el commit SIEMPRE la aporta:
        // la evidencia acustica decide el ASCENSO a nombre propio, no si se escribe); el
        // dueno de la fila preserva el nombre propio ya escrito (`preserveProperSpeaker`).
        expect(rowSpeaker).toBe('Hablante 2');
        expect(deps.fluParticipantRef.current.onTurnCommitted).toHaveBeenCalledTimes(1);
    });

    it('la revision ASR con texto NUEVO si reemite el log y reemplaza la fila', () => {
        const deps = makeDeps({
            lastEmittedTranscriptRef: { current: 'hola como estas' },
        });
        deps.lastCommitAtRef.current = 1000;
        deps.lastOnresultAtRef.current = 2000;
        deps.logRowsTextRef.current = ['hola como estas'];

        handleConversationStreamSync(deps, { capture: 'hola como estan', turnCommit: true, settlesTurn: true });

        const emitText = deps.emitConversationLog.mock.calls[0][0];
        const emitOpts = lastEmitOptions(deps);
        expect(emitText).toBe('hola como estan');
        expect(emitOpts.replaceLastRawLog).toBe(true);
        const [rowText, , rowOpts] = deps.commitTurnToSessionRows.mock.calls[0];
        expect(rowText).toBe('hola como estan');
        expect(rowOpts).toEqual({ replaceLast: true });
    });

    it('la fila no se recorta respecto a lo mostrado: se reconcilia el texto del commit', () => {
        // El preview mostro "hola como estas"; el motor corta por ruido ASR a "hola".
        const deps = makeDeps({ publishedLiveRef: { current: 'hola como estas' } });

        handleConversationStreamSync(deps, { capture: 'hola', turnCommit: true, settlesTurn: true });

        const [emitText] = deps.emitConversationLog.mock.calls[0];
        expect(emitText).toBe('hola como estas');
        expect(deps.commitTurnToSessionRows.mock.calls[0][0]).toBe('hola como estas');
    });

    it('la cola flu embebida se despacha al finalizar el turno (no antes)', () => {
        const deps = makeDeps();
        const full = 'hola como estas oye flu que hora es';

        handleConversationStreamSync(deps, { capture: full, turnCommit: true });

        // La fila pasiva se escribe con el texto ANTES de la frontera del wake.
        const [rowText] = deps.commitTurnToSessionRows.mock.calls[0];
        expect(rowText).toBe('hola como estas');
        expect(rowText).not.toContain('oye flu');

        expect(deps.processConversationFluQueryRef.current).toHaveBeenCalledTimes(1);
        const tailCapture = deps.processConversationFluQueryRef.current.mock.calls[0][0];
        const tailAction = deps.processConversationFluQueryRef.current.mock.calls[0][1] as { kind: string; question?: string };
        expect(tailCapture).toContain('oye flu');
        expect(tailAction.kind).toBe('flu');
        expect(tailAction.question).toContain('hora');
    });

    it('con UN solo hablante en el preflight no se trocea: una fila con todo el texto', async () => {
        const deps = makeDeps({
            logRowsTextRef: { current: ['buenos dias a todos'] },
            logRowSpeakersRef: { current: ['Hablante 2'] },
        });
        await preflightSnapshots(['Hablante 2', 'Hablante 2']);

        handleConversationStreamSync(deps, { capture: SEGMENTABLE_CAPTURE, turnCommit: true, settlesTurn: true });

        expect(deps.emitConversationLog).toHaveBeenCalledTimes(1);
        expect(deps.commitTurnToSessionRows).toHaveBeenCalledTimes(1);
        expect(deps.commitTurnToSessionRows.mock.calls[0][0]).toBe(SEGMENTABLE_CAPTURE);
    });

    it('rama SEGMENTADA: el prior embebido se omite y la voz nueva abre fila propia', async () => {
        const deps = makeDeps({
            logRowsTextRef: { current: [PRIOR_ROW, 'buenos dias a todos'] },
            logRowSpeakersRef: { current: ['Hablante 3', 'Hablante 2'] },
        });
        await preflightSnapshots(['Hablante 2', 'Hablante 2', 'Hablante 3', 'Hablante 3']);

        handleConversationStreamSync(deps, { capture: SEGMENTABLE_CAPTURE, turnCommit: true, settlesTurn: true });

        // Solo la voz NUEVA abre fila; el tramo ya commitido no se duplica.
        expect(deps.emitConversationLog).toHaveBeenCalledTimes(1);
        const [emitText, emitOpts] = deps.emitConversationLog.mock.calls[0] as [string, EmitOptions];
        // La cabeza corta del hablante ANTERIOR (< minWordsPerSegment) se ABSORBE en la
        // fila de la voz nueva: el troceo nunca descarta texto (antes se perdia).
        expect(emitText).toBe(`hola a todos ${NOVEL_TAIL}`);
        expect(emitText).not.toContain('examen de sociales');
        expect(emitOpts.turnCommit).toBe(true);
        expect(deps.commitTurnToSessionRows).toHaveBeenCalledTimes(1);
        const [rowText, rowSpeaker] = deps.commitTurnToSessionRows.mock.calls[0];
        expect(rowText).toBe(`hola a todos ${NOVEL_TAIL}`);
        // La fila es de la VOZ NUEVA (la cabeza corta viaja con ella, sin perderse).
        expect(rowSpeaker).toBe('Hablante 3');

        // El turno cierra igual (una sola ruta de cierre) y deja el texto COMPLETO como marca.
        expect(deps.flushPcmAfterTurnCommit).toHaveBeenCalledTimes(1);
        expect(deps.fluParticipantRef.current.onTurnCommitted).toHaveBeenCalledTimes(1);
        expect(deps.lastEmittedTranscriptRef.current).toBe(SEGMENTABLE_CAPTURE);
    });

    it('el id del turno se comparte entre preview y commit (un solo turno, una sola fila)', () => {
        const deps = makeDeps();

        handleConversationStreamSync(deps, { capture: 'hola que tal' });
        const idTrasPreview = deps.activeTurnIdRef.current;
        handleConversationStreamSync(deps, { capture: 'hola que tal', turnCommit: true, settlesTurn: true });

        expect(idTrasPreview).toBe(1);
        expect(deps.activeTurnIdRef.current).toBe(1);
        expect(deps.emitConversationLog).toHaveBeenCalledTimes(1);
        expect(deps.commitTurnToSessionRows).toHaveBeenCalledTimes(1);
    });
});

// P8.43 - UN ID POR PETICION: la identidad del turno la dicta la MISMA memoria del
// despacho (la ultima peticion ACEPTADA: texto + instante) con la ventana compartida
// (`sameRequestWindowMs`). La fila y la ejecucion usan el mismo criterio, asi no pueden
// discrepar. (Sustituye al criterio por "turno vivo", que acuñaba id nuevo cuando
// `processConversationFluQuery` ya habia cerrado el preview y el estado aun no era
// THINKING: la reentrega de 284 ms abria una SEGUNDA fila y el gate del commit, al
// suprimirla, mataba tambien la respuesta del primer turno.)
describe('P8.43 - un id por peticion (la reentrega no abre locucion nueva)', () => {
    const IMAGEN = 'okay flow dame una imagen';

    it('misma emision que la ultima peticion ACEPTADA (dentro de la ventana): no acuña id', () => {
        const deps = makeDeps({
            isTurnLive: () => true,
            lastEmittedTranscriptRef: { current: IMAGEN },
            lastRequestRef: { current: { text: IMAGEN, at: Date.now() } },
        });

        handleConversationStreamSync(deps, { capture: IMAGEN, turnCommit: true });

        expect(deps.activeTurnIdRef.current).toBe(0);
        expect(deps.emitConversationLog).not.toHaveBeenCalled();
        expect(deps.commitTurnToSessionRows).toHaveBeenCalledTimes(1);
    });

    it('misma emision FUERA de la ventana: es una peticion nueva (id y fila)', () => {
        const deps = makeDeps({
            isTurnLive: () => false,
            lastEmittedTranscriptRef: { current: IMAGEN },
            lastRequestRef: { current: { text: IMAGEN, at: Date.now() - 60000 } },
        });

        handleConversationStreamSync(deps, { capture: IMAGEN, turnCommit: true });

        expect(deps.activeTurnIdRef.current).toBe(1);
    });

    it('emision DISTINTA de la ultima peticion: es una locucion nueva (id y fila)', () => {
        const deps = makeDeps({
            isTurnLive: () => true,
            lastEmittedTranscriptRef: { current: IMAGEN },
            lastRequestRef: { current: { text: IMAGEN, at: Date.now() } },
        });

        handleConversationStreamSync(deps, { capture: 'okay flow pon musica', turnCommit: true, settlesTurn: true });

        expect(deps.activeTurnIdRef.current).toBe(1);
        expect(deps.emitConversationLog).toHaveBeenCalledTimes(1);
    });
});
