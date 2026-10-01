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
 * NO CUBIERTO (declarado): la RAMA SEGMENTADA (planAsrTurnSegments >= 2 tramos)
 * exige un preflight con snapshots de diarizacion y prior embebido; necesita su
 * propio arnes y va aparte.
 */
import { describe, expect, it, vi } from 'vitest';
import { handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js';
import { createActiveListenState } from '../src/voice/lib/activeListen.js';

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

    it('captura vacia con parrafo nuevo: si limpia el preview abierto', () => {
        const deps = makeDeps({ publishedLiveRef: { current: 'algo previo' } });
        deps.openPreviewTurnRef.current = true;

        handleConversationStreamSync(deps, { newParagraph: true });

        expect(deps.publishedLiveRef.current).toBe('');
        expect(deps.setLiveTranscript).toHaveBeenCalledWith('');
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
        expect(deps.activeTurnIdRef.current).toBe(0);
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
    it('un commit normal emite log, escribe la fila, cierra el turno y avisa al participante', () => {
        const deps = makeDeps();
        deps.chunkTotalSamplesRef.current = 4800;

        handleConversationStreamSync(deps, { capture: 'hola mundo', turnCommit: true });

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
        expect(String(rowSpeaker)).not.toBe('');

        // Cierre: el turno deja de estar abierto y la sesion queda lista para el siguiente.
        expect(deps.flushPcmAfterTurnCommit).toHaveBeenCalledTimes(1);
        expect(deps.lastCommitAtRef.current).toBeGreaterThan(0);
        expect(deps.turnAudioStartSampleRef.current).toBe(4800);
        expect(deps.openPreviewTurnRef.current).toBe(false);
        expect(deps.publishedLiveRef.current).toBe('');
        expect(deps.setLiveTranscript).toHaveBeenLastCalledWith('');
        expect(deps.listenStateRef.current.openLine).toBe('');
        expect(deps.listenStateRef.current.pendingInterim).toBe('');
        expect(deps.preflightScheduledForTurnRef.current).toBe(false);
        expect(deps.srGapFiredForOpenLineRef.current).toBe(false);
        expect(deps.lastEmittedTranscriptRef.current).toBe('hola mundo');
        expect(deps.fluParticipantRef.current.onTurnCommitted).toHaveBeenCalledTimes(1);
    });

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

    it('cuando NADA refresca el stream, la fila se escribe igual y el eco no se duplica', () => {
        const deps = makeDeps({
            lastEmittedTranscriptRef: { current: 'HOLA MUNDO' },
        });
        deps.lastCommitAtRef.current = 1000;
        deps.lastOnresultAtRef.current = 2000; // hubo habla nueva: no es re-emision

        handleConversationStreamSync(deps, { capture: 'hola mundo', turnCommit: true });

        expect(deps.emitConversationLog).not.toHaveBeenCalled();
        expect(deps.commitTurnToSessionRows).toHaveBeenCalledTimes(1);
        expect(deps.lastEmittedTranscriptRef.current).toBe('hola mundo');
        expect(deps.fluParticipantRef.current.onTurnCommitted).toHaveBeenCalledTimes(1);
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

        handleConversationStreamSync(deps, { capture: 'hola como estan', turnCommit: true });

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

        handleConversationStreamSync(deps, { capture: 'hola', turnCommit: true });

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

    it('el id del turno se comparte entre preview y commit (un solo turno, una sola fila)', () => {
        const deps = makeDeps();

        handleConversationStreamSync(deps, { capture: 'hola que tal' });
        const idTrasPreview = deps.activeTurnIdRef.current;
        handleConversationStreamSync(deps, { capture: 'hola que tal', turnCommit: true });

        expect(idTrasPreview).toBe(1);
        expect(deps.activeTurnIdRef.current).toBe(1);
        expect(deps.emitConversationLog).toHaveBeenCalledTimes(1);
        expect(deps.commitTurnToSessionRows).toHaveBeenCalledTimes(1);
    });
});
