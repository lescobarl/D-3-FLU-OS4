// ============================================================
// speakerSoloCoalesce — fix de diarización «Hablante 2» fantasma.
//
// Caso real detectado (una sola persona hablando):
//   22:39:25  Hablante 2  "Okay Flow sabes cantar"
//   22:39:43  Hablante 1  "…"
//   22:39:54  Hablante 1  "…"
// El mismo timbre abrió H2 por una similitud intermedia.
//
// Fix (genérico, config-driven, sin parches):
//   - roomCapture.soloNewVoiceFactor = 0.82 (config).
//   - En sesión efectivamente solitaria (1 cluster auto) el umbral de
//     apertura se aprieta: NEW_VOICE_OPEN = NEW_VOICE_EFF × 0.82.
//     Con thresholds de producción (NEW_VOICE 0.64 → NEW_VOICE_EFF 0.68)
//     el límite pasa de 0.68 a 0.5576.
//   - Sims intermedias (0.5576–0.68) → coalesce al hablante existente.
//   - Voz genuinamente distinta (sim < 0.5576) → sigue abriendo H2.
//   - Multi-hablante (≥2 clusters) → NO se altera: sims 0.60 abren H3.
//
// Vectores: 64-D con coseno exacto (L2-normalizados, dimensión
// preservada). q(sim) = sim·e0 + √(1−sim²)·e1 → coseno con e0 = sim.
// ============================================================
// Los argumentos se castean a `any`: módulos JS sin checkJs y TS infiere
// tipos demasiado estrechos de los parámetros con default. El test valida
// comportamiento en runtime, no el shape de tipos inferido.
// ============================================================
import { describe, it, expect } from 'vitest';
import { resolveConversationSpeaker } from '../src/voice/lib/voiceIdentity.js';
import { assignSpeakerStrictCosine } from '../src/voice/lib/speakerCosineStrict.js';
import { anchorResolvedToLastLogged } from '../src/voice/lib/speakerPolicy.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

// ---- helpers de vectores deterministas -----------------------
const DIM = 64;

function makeVector(pairs: Array<[number, number]>): number[] {
    const v: number[] = new Array(DIM).fill(0);
    for (const [index, value] of pairs) v[index] = value;
    return v;
}

// e0 = voz A (Hablante 1); e2 = voz B (Hablante 2), ortogonal a la rama del query.
const E1 = makeVector([[0, 1]]);
const E2 = makeVector([[2, 1]]);

// q(sim) = sim·e0 + √(1−sim²)·e1 (e1 ortogonal a e0 y a e2) → coseno(q, e0) = sim.
function query(sim: number): number[] {
    return makeVector([[0, sim], [1, Math.sqrt(1 - sim * sim)]]);
}

// Thresholds equivalentes a producción (conversationSpeakerThresholds):
//   NEW_VOICE = 0.64 → NEW_VOICE_EFF = 0.68 (classroom +0.04)
//   REUSE     = 0.70 → REUSE_EFF     = 0.67 (classroom −0.03)
//   CONTINUITY= 0.70
//   NEW_VOICE_OPEN = 0.68 × 0.82 = 0.5576
const THRESHOLDS = {
    cosineNewVoiceThreshold: 0.64,
    cosineContinuityThreshold: 0.70,
    productionClusterReuseThreshold: 0.70,
};

// Frase ≥4 palabras y ≥1500 ms de voz → NO cae en findShortUtteranceHistoricalMatch
// (isShortUtteranceContext: words < 3 OR durationMs < 1500; 96000 @48kHz = 2s).
const BASE = {
    atTurnBoundary: true,
    voicedSampleCount: 96000,
    sampleRate: 48000,
    utteranceText: 'esta es una frase de prueba para voz',
    thresholds: THRESHOLDS,
    allowNewCluster: true,
};

describe('resolveConversationSpeaker — solo coalesce (main thread)', () => {
    it('solo (1 cluster) sim 0.60 (borde, 0.5576–0.68) → coalesce a Hablante 1', () => {
        const clusters: any[] = [{ label: 'Hablante 1', signature: E1 }];
        const diagnosis: Record<string, unknown> = {};
        const r = resolveConversationSpeaker({
            ...BASE,
            signatureVector: query(0.6),
            speakerClusters: clusters,
            lastSpeaker: 'Hablante 1',
            lastSignature: E1,
            diagnosis,
        } as any);
        expect(r).toBe('Hablante 1');
        expect(clusters.map((c) => c.label)).toEqual(['Hablante 1']);
        expect(diagnosis.reason).toBe('production-solo-coalesce');
    });

    it('solo (1 cluster) sim 0.50 (genuinamente distinta < 0.5576) → abre Hablante 2', () => {
        const clusters: any[] = [{ label: 'Hablante 1', signature: E1 }];
        const diagnosis: Record<string, unknown> = {};
        const r = resolveConversationSpeaker({
            ...BASE,
            signatureVector: query(0.5),
            speakerClusters: clusters,
            lastSpeaker: 'Hablante 1',
            lastSignature: E1,
            diagnosis,
        } as any);
        expect(r).toBe('Hablante 2');
        expect(clusters.map((c) => c.label)).toEqual(['Hablante 1', 'Hablante 2']);
        expect(diagnosis.reason).toBe('production-forced-new-voice');
    });

    it('solo (1 cluster) sim 0.60 con lastSignature ausente → usa cluster de lastSpeaker y coalesce', () => {
        const clusters: any[] = [{ label: 'Hablante 1', signature: E1 }];
        const r = resolveConversationSpeaker({
            ...BASE,
            signatureVector: query(0.6),
            speakerClusters: clusters,
            lastSpeaker: 'Hablante 1',
            lastSignature: null,
        } as any);
        expect(r).toBe('Hablante 1');
    });

    it('multi-hablante (2 clusters) sim 0.60 → abre Hablante 3 (no alterado)', () => {
        const clusters: any[] = [
            { label: 'Hablante 1', signature: E1 },
            { label: 'Hablante 2', signature: E2 },
        ];
        const r = resolveConversationSpeaker({
            ...BASE,
            signatureVector: query(0.6),
            speakerClusters: clusters,
            lastSpeaker: 'Hablante 1',
            lastSignature: E1,
        } as any);
        expect(r).toBe('Hablante 3');
    });
});

describe('assignSpeakerStrictCosine — solo coalesce (worker path)', () => {
    const workerBase = {
        continuityThreshold: 0.70,
        newVoiceThreshold: 0.68,
        matchThresholdCluster: 0.76,
        soloNewVoiceFactor: 0.82,
    };

    it('solo (1 cluster) sim 0.60 → solo-coalesce / Hablante 1', () => {
        const r = assignSpeakerStrictCosine(query(0.6), {
            ...workerBase,
            clusters: [{ label: 'Hablante 1', signature: E1 }],
            lastSpeaker: 'Hablante 1',
            lastSignature: E1,
        } as any);
        expect(r.speakerName).toBe('Hablante 1');
        expect(r.reason).toBe('solo-coalesce');
        expect(r.similarity).toBeCloseTo(0.6, 5);
    });

    it('solo (1 cluster) sim 0.50 → abre Hablante 2 (voz genuina)', () => {
        const r = assignSpeakerStrictCosine(query(0.5), {
            ...workerBase,
            clusters: [{ label: 'Hablante 1', signature: E1 }],
            lastSpeaker: 'Hablante 1',
            lastSignature: E1,
        } as any);
        expect(r.speakerName).toBe('Hablante 2');
        expect(r.reason).toBe('forced-new-voice-below-threshold');
    });

    it('multi-hablante (2 clusters) sim 0.60 → abre Hablante 3 (no alterado)', () => {
        const r = assignSpeakerStrictCosine(query(0.6), {
            ...workerBase,
            clusters: [
                { label: 'Hablante 1', signature: E1 },
                { label: 'Hablante 2', signature: E2 },
            ],
            lastSpeaker: 'Hablante 1',
            lastSignature: E1,
        } as any);
        expect(r.speakerName).toBe('Hablante 3');
    });
});

describe('anchorResolvedToLastLogged — coalesce de commit solitario', () => {
    it('soloSession + preflightSpeaker === sticky (H1) → coalesce a Hablante 1', () => {
        const r = anchorResolvedToLastLogged('Hablante 2', 'Hablante 1', {
            preflightReady: true,
            preflightSpeaker: 'Hablante 1',
            soloSession: true,
        } as any);
        expect(r).toBe('Hablante 1');
    });

    it('soloSession + preflightSpeaker = Hablante 2 (voz genuina) → se preserva Hablante 2', () => {
        const r = anchorResolvedToLastLogged('Hablante 2', 'Hablante 1', {
            preflightReady: true,
            preflightSpeaker: 'Hablante 2',
            soloSession: true,
        } as any);
        expect(r).toBe('Hablante 2');
    });

    it('soloSession=false → comportamiento sin cambio (devuelve resolved)', () => {
        const r = anchorResolvedToLastLogged('Hablante 2', 'Hablante 1', {
            preflightReady: true,
            preflightSpeaker: 'Hablante 1',
            soloSession: false,
        } as any);
        expect(r).toBe('Hablante 2');
    });
});

describe('config — soloNewVoiceFactor (sin hardcode)', () => {
    it('roomCapture.soloNewVoiceFactor = 0.82 y classroomMultiSpeaker = true', () => {
        const room = FLU_CONFIG.voiceIdentity?.capture?.roomCapture;
        expect(room?.soloNewVoiceFactor).toBe(0.82);
        expect(room?.classroomMultiSpeaker).toBe(true);
    });

    it('thresholds de producción: NEW_VOICE 0.64, CONTINUITY 0.70, REUSE 0.70', () => {
        const thresholds = FLU_CONFIG.voiceIdentity?.capture?.conversationSpeakerThresholds;
        expect(thresholds?.cosineNewVoiceThreshold).toBe(0.64);
        expect(thresholds?.cosineContinuityThreshold).toBe(0.70);
        expect(thresholds?.productionClusterReuseThreshold).toBe(0.70);
    });
});
