// ============================================================
// ingressSimulation — INYECTA eventos sintéticos de Chrome en el
// INGRESS real (createConversationIngressRuntime) y valida lo que
// llega a la transcripción. No mocks de la lógica: se ejecutan
// pushMicSpeechEvent → processMicConversationIngress → commit.
//
// Casos que reproduce el usuario:
//   «hola andas por ahi» dicho con pausas (Chrome parte en varios
//   resultados finales) y con final truncado.
// ============================================================
import { describe, it, expect } from 'vitest';
import { createConversationIngressRuntime } from '../src/voice/lib/conversationIngressBridge.js';
import { pushMicSpeechEvent, pushRecognitionEndEvent } from '../src/voice/lib/micEventProducer.js';
import { createActiveListenState } from '../src/voice/lib/activeListen.js';
import { resolveLogRowAction } from '../src/voice/lib/conversationStream.js';
import { normalizeMicText } from '../src/voice/lib/speechMerge.js';

const SEQUENCE_1_18 = Array.from({ length: 18 }, (_, i) => String(i + 1)).join(' ');

/** Evento con forma de SpeechRecognitionEvent de Chrome. */
function chromeEvent(specs: Array<{ isFinal?: boolean; transcript: string }>, resultIndex = 0) {
    const results = specs.map((s) => ({
        isFinal: Boolean(s.isFinal),
        0: { transcript: s.transcript, confidence: 0.9 },
        length: 1,
    }));
    return { resultIndex, results };
}

interface StreamPayload {
    capture?: string;
    turnCommit?: boolean;
    newParagraph?: boolean;
}

function createHarness({ conversationActive = true }: { conversationActive?: boolean } = {}) {
    const listenStateRef = { current: createActiveListenState() };
    const publishedLiveRef = { current: '' };
    const lastStreamPreviewRef = { current: '' };
    const logRowsTextRef = { current: [] as string[] };
    const logRowSpeakersRef = { current: [] as string[] };
    const lastEmittedTranscriptRef = { current: '' };
    const lastLoggedSpeakerRef = { current: 'Hablante 1' };
    const lastCommitAtRef = { current: 0 };
    const preflightScheduledForTurnRef = { current: false };
    const openPreviewTurnRef = { current: false };

    const previews: string[] = [];

    const bindings = {
        conversationActiveRef: { current: conversationActive },
        listenStateRef,
        publishedLiveRef,
        lastStreamPreviewRef,
        logRowsTextRef,
        logRowSpeakersRef,
        lastEmittedTranscriptRef,
        lastLoggedSpeakerRef,
        lastCommitAtRef,
        preflightScheduledForTurnRef,
        openPreviewTurnRef,
        debugHotPath: false,
        fluDebugHot: () => {},
        getIngressVoiceContext: () => ({}),
        tryDispatchConversationAction: () => false,
        flushTranscriptOnFinal: () => {},
        flushPcmAfterTurnCommit: () => {},
        maybeSwitchRecognitionLocale: () => {},
        commitTurnToSessionRows: () => {},
        syncConversationStream: (payload: StreamPayload = {}) => {
            const capture = payload?.capture || '';
            if (!capture) return;
            if (payload?.turnCommit) {
                // Mismas reglas de fila que el hook (resolveLogRowAction).
                const rows = logRowsTextRef.current;
                const action = resolveLogRowAction({
                    activeLogStream: false,
                    newParagraph: Boolean(payload.newParagraph),
                    turnBoundary: true,
                    turnCommit: true,
                    lastEmitted: lastEmittedTranscriptRef.current,
                    lastCommitted: rows.at(-1) || '',
                    capture,
                    logRowContext: { msSinceLastCommit: Date.now() - lastCommitAtRef.current },
                });
                if (action.replaceLast && rows.length) rows[rows.length - 1] = capture;
                else rows.push(capture);
                lastEmittedTranscriptRef.current = capture;
                publishedLiveRef.current = capture;
                lastCommitAtRef.current = Date.now();
            } else {
                previews.push(capture);
                publishedLiveRef.current = capture;
            }
        },
        markAudioSegmentStart: () => {},
        touchMeaningfulIngress: () => {},
        scheduleIdentityPreflight: () => {},
        peekTurnBridgeText: () => '',
        stashTurnBridgeText: () => {},
        consumeTurnBridgeText: () => '',
        onTurnFinalized: () => {},
    };

    const runtime = createConversationIngressRuntime({ getBindings: () => bindings });

    return {
        runtime,
        bindings,
        listenStateRef,
        publishedLiveRef,
        lastStreamPreviewRef,
        commits: logRowsTextRef.current,
        previews,
        inject(event: unknown) {
            pushMicSpeechEvent(event as never, runtime.queue);
            runtime.drainAll();
        },
        end() {
            pushRecognitionEndEvent(runtime.queue);
            runtime.drainAll();
        },
    };
}

describe('ingress SIM — «hola andas por ahi»', () => {
    it('interinos acumulativos + final: llega la frase completa', () => {
        const h = createHarness();
        h.inject(chromeEvent([{ transcript: 'hola' }], 0));
        h.inject(chromeEvent([{ transcript: 'hola andas' }], 0));
        h.inject(chromeEvent([{ transcript: 'hola andas por' }], 0));
        h.inject(chromeEvent([{ transcript: 'hola andas por ahi' }], 0));
        h.inject(chromeEvent([{ isFinal: true, transcript: 'hola andas por ahi' }], 0));

        const last = h.commits.at(-1) || '';
        expect(last).toBe('hola andas por ahi');
    });

    it('Chrome parte la frase en varios finales (pausas): NO se pierde el arranque', () => {
        const h = createHarness();
        h.inject(chromeEvent([{ isFinal: true, transcript: 'hola' }], 0));
        h.inject(
            chromeEvent(
                [{ isFinal: true, transcript: 'hola' }, { isFinal: true, transcript: 'andas' }],
                1,
            ),
        );
        h.inject(
            chromeEvent(
                [
                    { isFinal: true, transcript: 'hola' },
                    { isFinal: true, transcript: 'andas' },
                    { isFinal: true, transcript: 'por' },
                ],
                2,
            ),
        );
        h.inject(
            chromeEvent(
                [
                    { isFinal: true, transcript: 'hola' },
                    { isFinal: true, transcript: 'andas' },
                    { isFinal: true, transcript: 'por' },
                    { isFinal: true, transcript: 'ahi' },
                ],
                3,
            ),
        );

        const joined = h.commits.join(' | ');
        expect(joined).toContain('hola');
        expect(joined).toContain('andas');
        expect(joined).toContain('ahi');
    });

    it('final truncado tras interino largo conserva la frase completa', () => {
        const h = createHarness();
        h.inject(chromeEvent([{ transcript: 'hoy quiero una receta de pan' }], 0));
        h.inject(chromeEvent([{ isFinal: true, transcript: 'hoy quiero' }], 0));

        const all = h.commits.join(' | ');
        expect(all).toContain('pan');
    });

    it('reconocimiento abortado a mitad: al cerrar se sella lo escuchado', () => {
        const h = createHarness();
        h.inject(chromeEvent([{ transcript: 'hola andas por ahi' }], 0));
        h.end();

        const all = h.commits.join(' | ');
        expect(all).toContain('hola andas por ahi');
    });

    it('Chrome reinicia a mitad de frase: no se pierde la primera parte', () => {
        const h = createHarness();
        // Sesión 1: Chrome aborta tras «hola andas».
        h.inject(chromeEvent([{ transcript: 'hola andas' }], 0));
        h.end();
        // Sesión 2: reconoce la cola.
        h.inject(chromeEvent([{ isFinal: true, transcript: 'por ahi' }], 0));
        h.end();

        const all = h.commits.join(' | ');
        expect(all).toContain('hola andas');
        expect(all).toContain('por ahi');
    });

    it('la misma frase dicha dos veces no se reduce a la última palabra', () => {
        const h = createHarness();
        for (let attempt = 0; attempt < 2; attempt += 1) {
            h.inject(chromeEvent([{ transcript: 'hola andas' }], 0));
            h.inject(chromeEvent([{ transcript: 'hola andas por' }], 0));
            h.inject(chromeEvent([{ isFinal: true, transcript: 'hola andas por ahi' }], 0));
            h.end();
        }

        const all = h.commits.join(' | ');
        expect(all).toContain('hola andas por ahi');
        expect(h.commits.some((row) => row.trim() === 'por')).toBe(false);
    });

    it('alternativas del MISMO resultado con la más corta al final: NO encoge la fila', () => {
        const h = createHarness();
        // Chrome log real: seq=6 final "1 2 3" → "123" → "1 2" (más corta al final).
        h.inject(
            chromeEvent(
                [
                    { isFinal: true, transcript: '1 2 3' },
                    { isFinal: true, transcript: '123' },
                    { isFinal: true, transcript: '1 2' },
                ],
                0,
            ),
        );

        const last = (h.commits.at(-1) || '').replace(/\s+/g, '');
        expect(last).toBe('123');
        expect(h.commits.some((row) => row.trim() === '1 2')).toBe(false);
    });

    it('final corto (solo el wake) al final NO borra la interacción ya dictada', () => {
        const h = createHarness();
        h.inject(
            chromeEvent(
                [
                    { isFinal: true, transcript: 'ok flu borra las notas' },
                    { isFinal: true, transcript: 'ok flu' },
                ],
                0,
            ),
        );

        const all = h.commits.join(' | ');
        expect(all).toContain('ok flu borra las notas');
        expect(h.commits.some((row) => row.trim() === 'ok flu')).toBe(false);
    });
});

// ============================================================
// PRUEBA DE ESCRITORIO: dictado «1..18» en la PRIMERA iteración.
// Chrome puede mandar la secuencia en un final, en N resultados
// (uno por número) o en N eventos seguidos.
// ============================================================
describe('ingress SIM — dictado «1..18» no debe borrarse', () => {
    it('normalizeMicText conserva la secuencia completa', () => {
        expect(normalizeMicText(SEQUENCE_1_18)).toBe(SEQUENCE_1_18);
    });

    it('un solo final con la secuencia completa → se conserva', () => {
        const h = createHarness();
        h.inject(chromeEvent([{ isFinal: true, transcript: SEQUENCE_1_18 }], 0));
        const last = (h.commits.at(-1) || '').replace(/\s+/g, ' ');
        expect(last).toBe(SEQUENCE_1_18);
    });

    it('Chrome parte en N resultados (uno por número) → no se pierde el arranque', () => {
        const h = createHarness();
        const specs = Array.from({ length: 18 }, (_, i) => ({ isFinal: true, transcript: String(i + 1) }));
        h.inject(chromeEvent(specs, 0));
        const all = h.commits.join(' | ');
        expect(all).toContain('1');
        expect(all).toContain('18');
    });

    it('N eventos seguidos (uno por número) → el primero no se borra', () => {
        const h = createHarness();
        for (let n = 1; n <= 18; n += 1) {
            h.inject(chromeEvent([{ isFinal: true, transcript: String(n) }], 0));
        }
        const all = h.commits.join(' | ');
        expect(all).toContain('1');
        expect(all).toContain('18');
        expect(h.commits.every((row) => row.trim().length > 0)).toBe(true);
    });

    it('interinos acumulativos 1..18 y luego el final idéntico (log real seq=28..36) → no se borra', () => {
        const h = createHarness();
        // Interinos acumulativos: "1", "1 2", … "1 2 … 18" (como Chrome en el log).
        for (let n = 1; n <= 18; n += 1) {
            h.inject(
                chromeEvent(
                    [{ transcript: Array.from({ length: n }, (_, i) => String(i + 1)).join(' ') }],
                    0,
                ),
            );
        }
        // Final con la secuencia completa (y sus variantes con dígito duplicado).
        h.inject(
            chromeEvent(
                [
                    { isFinal: true, transcript: SEQUENCE_1_18 },
                    { isFinal: true, transcript: '1 2 3 4 5 6 7 8 9 10 11 12 13 14 14 15 16 17 18' },
                    { isFinal: true, transcript: '1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 16 17 18' },
                ],
                0,
            ),
        );

        const last = (h.commits.at(-1) || '').replace(/\s+/g, ' ').trim();
        expect(last.length).toBeGreaterThan(0);
        expect(last).toContain('18');
        expect(last.startsWith('1 2 3')).toBe(true);
        expect(h.commits.every((row) => row.trim().length > 0)).toBe(true);
    });
});

// ============================================================
// RUTEO: reproduce la pérdida de la PRIMERA interacción.
// Con `conversationActive=false` (modo comando) el texto NO entra
// al ingress → no hay fila (por eso se perdía). Encendido, sí.
// ============================================================
describe('ingress SIM — ruteo apagado vs encendido', () => {
    it('ruteo APAGADO (modo comando): el dictado no entra al ingress → pérdida reproducida', () => {
        const h = createHarness({ conversationActive: false });
        h.inject(chromeEvent([{ isFinal: true, transcript: SEQUENCE_1_18 }], 0));
        const all = h.commits.join(' | ');
        expect(all).not.toContain('18');
    });

    it('ruteo ENCENDIDO (modo conversación): el mismo dictado se commitea', () => {
        const h = createHarness({ conversationActive: true });
        h.inject(chromeEvent([{ isFinal: true, transcript: SEQUENCE_1_18 }], 0));
        expect((h.commits.at(-1) || '').replace(/\s+/g, ' ')).toBe(SEQUENCE_1_18);
    });
});
