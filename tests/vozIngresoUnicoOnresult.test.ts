// ============================================================
// vozIngresoUnicoOnresult.test.ts — Defecto 2 (2026-10-16)
// ------------------------------------------------------------
// INGRESO UNICO al preview de la frase viva.
//
// Invariante: con conversacion activa, cada evento ASR publica el preview
// EXACTAMENTE UNA vez y la unica entrada es transcriptIngress.js; el bloque
// `onresult` del hook DELEGA (pushMicRecognitionEvent) y no publica una segunda
// vez (duplicacion medida: dos publicaciones por evento).
//
// Aislado a proposito: NO importa el hook, NO usa jsdom, NO arrastra la suite
// global. Solo transcriptIngress.js por conducta + el bloque onresult como texto.
//
// ROJO antes del fix: useFluVoiceAssistant.js:syncConversationStream:2210
// ============================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildConversationIngressCtx } from '../src/voice/lib/conversationIngressBridge.js';
import { processMicConversationIngress } from '../src/voice/lib/transcriptIngress.js';
import { createActiveListenState } from '../src/voice/lib/activeListen.js';

type Publicacion = { capture?: string; turnCommit?: boolean };

/** Una entrada del ingress con las referencias del hook y el preview contado. */
function crearEntrada() {
    const publicaciones: Publicacion[] = [];
    const bindings = {
        conversationActiveRef: { current: true },
        listenStateRef: { current: createActiveListenState() },
        publishedLiveRef: { current: '' },
        openPreviewTurnRef: { current: false },
        logRowsTextRef: { current: [] as string[] },
        logRowSpeakersRef: { current: [] as string[] },
        lastEmittedTranscriptRef: { current: '' },
        lastLoggedSpeakerRef: { current: 'Hablante 1' },
        lastStreamPreviewRef: { current: '' },
        lastCommitAtRef: { current: 0 },
        preflightScheduledForTurnRef: { current: false },
        debugHotPath: false,
        fluDebugHot: () => {},
        getIngressVoiceContext: () => ({}),
        tryDispatchConversationAction: () => false,
        flushTranscriptOnFinal: () => {},
        flushPcmAfterTurnCommit: () => {},
        maybeSwitchRecognitionLocale: () => {},
        commitTurnToSessionRows: () => {},
        syncConversationStream: (payload: Publicacion = {}) => {
            publicaciones.push({
                capture: String(payload?.capture || ''),
                turnCommit: payload?.turnCommit === true,
            });
        },
        markAudioSegmentStart: () => {},
        touchMeaningfulIngress: () => {},
        scheduleIdentityPreflight: () => {},
        peekTurnBridgeText: () => '',
        stashTurnBridgeText: () => {},
        consumeTurnBridgeText: () => '',
        onTurnFinalized: () => {},
    };
    return { ctx: buildConversationIngressCtx(bindings), publicaciones };
}

const HOOK_SRC = 'src/voice/hooks/useFluVoiceAssistant.js';
const ANCLA = 'pushMicRecognitionEvent(event)';

/**
 * Lineas (1-based) del bloque `onresult` que publican el preview POR SU CUENTA.
 * La invariante exige CERO: el unico escritor es el ingress. Devuelve `[-1]`
 * si el ancla desaparece (asi un guard sordo no puede pasar por vaciedad).
 */
export function publicacionesDelOnresult(src: string): number[] {
    const inicio = src.indexOf(ANCLA);
    if (inicio < 0) return [-1];
    const fin = src.indexOf('return', inicio);
    if (fin < inicio) return [-1];
    const cuerpo = src.slice(inicio, fin);
    const base = src.slice(0, inicio).split('\n').length;
    const sitios: number[] = [];
    cuerpo.split('\n').forEach((linea, index) => {
        if (linea.includes('syncConversationStream(')) sitios.push(base + index);
    });
    return sitios;
}

describe('Defecto 2 - el preview se publica UNA vez por evento (puerta = transcriptIngress)', () => {
    it('un interino publica UNA sola vez', () => {
        const { ctx, publicaciones } = crearEntrada();
        processMicConversationIngress({ interimChunks: ['hola'], ctx });
        expect(publicaciones).toHaveLength(1);
        expect(publicaciones[0]).toEqual({ capture: 'hola', turnCommit: false });
    });

    it('un final publica UNA sola vez (cierre de turno)', () => {
        const { ctx, publicaciones } = crearEntrada();
        processMicConversationIngress({ finalChunks: ['hola mundo'], ctx });
        expect(publicaciones).toHaveLength(1);
        expect(publicaciones[0].turnCommit).toBe(true);
        expect(publicaciones[0].capture).toContain('hola mundo');
    });

    it('N interinos publican N previews (no 2N)', () => {
        const { ctx, publicaciones } = crearEntrada();
        processMicConversationIngress({ interimChunks: ['uno'], ctx });
        processMicConversationIngress({ interimChunks: ['uno dos'], ctx });
        processMicConversationIngress({ interimChunks: ['uno dos tres'], ctx });
        expect(publicaciones).toHaveLength(3);
    });

    it('el bloque onresult DELEGA: no publica una segunda vez', () => {
        const src = readFileSync(join(process.cwd(), HOOK_SRC), 'utf8');
        expect(
            publicacionesDelOnresult(src).map(
                (line) => `useFluVoiceAssistant.js:syncConversationStream:${line}`,
            ),
        ).toEqual([]);
    });
});

// P2.4 — prueba de detector: el detector no es decorativo (alimentado el
// duplicado sintetico, la marca; y el caso sordo tambien falla).
describe('Defecto 2 - el detector no es decorativo', () => {
    it('marca el duplicado sintetico del bloque onresult', () => {
        const doble = `${ANCLA}\n  syncConversationStream({ capture: 'x' });\n  return;\n`;
        expect(publicacionesDelOnresult(doble)).toHaveLength(1);
    });

    it('no marca al handler que solo delega en el ingress', () => {
        const delegado = `${ANCLA}\n  return;\n`;
        expect(publicacionesDelOnresult(delegado)).toEqual([]);
    });

    it('el guard SORDO tambien falla: sin el ancla no pasa por vaciedad', () => {
        expect(publicacionesDelOnresult('sin ancla aqui')).toEqual([-1]);
    });
});
