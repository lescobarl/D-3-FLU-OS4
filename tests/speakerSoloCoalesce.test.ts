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
//   - roomCapture.soloNewVoiceFactor (config) aprieta el umbral de apertura en
//     sesión efectivamente solitaria (1 cluster auto): NEW_VOICE_OPEN =
//     NEW_VOICE_EFF × factor.
//   - MANDATO 2026-10-18: `production-reuse-no-evidence` se RETIRÓ. Un turno
//     SOSTENIDO que no casa con ninguna voz ya NO hereda la etiqueta del anterior
//     (así se mezclaban dos personas en un solo "Hablante N"): abre SU etiqueta.
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

describe('resolveConversationSpeaker — separación sin relajación de solo (main thread)', () => {
    it('solo (1 cluster) sim 0.60 (voz distinta) → separa a Hablante 2', () => {
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
        expect(r).toBe('Hablante 2');
        expect(clusters.map((c) => c.label)).toEqual(['Hablante 1', 'Hablante 2']);
        expect(diagnosis.reason).toMatch(/forced-new-voice|new-voice/);
    });

        it('solo (1 cluster) sim 0.50 (POR DEBAJO de la banda de evidencia 0.58) -> voz DISTINTA, etiqueta DISTINTA', () => {
        // MANDATO 2026-10-18: en un turno SOSTENIDO, una medida que NO casa con la voz
        // anterior es OTRA voz (lastSim 0.143/0.192/0.380/0.374 en el log del dueno). Antes
        // se reusaba la etiqueta del anterior (`production-reuse-no-evidence`) y una sola
        // "Hablante 1" representaba al dueno y a la nina; ese reuso se retiro.
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
        expect(r, 'la voz distinta NO hereda la etiqueta del anterior').toBe('Hablante 2');
        expect(clusters.map((c) => c.label)).toEqual(['Hablante 1', 'Hablante 2']);
        expect(diagnosis.reason).toBe('production-forced-new-voice');
    });

    it('solo (1 cluster) sim 0.60 con lastSignature ausente → separa a Hablante 2', () => {
        const clusters: any[] = [{ label: 'Hablante 1', signature: E1 }];
        const r = resolveConversationSpeaker({
            ...BASE,
            signatureVector: query(0.6),
            speakerClusters: clusters,
            lastSpeaker: 'Hablante 1',
            lastSignature: null,
        } as any);
        expect(r).toBe('Hablante 2');
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
    it('roomCapture.soloNewVoiceFactor = 1.0 y classroomMultiSpeaker = true', () => {
        const room = FLU_CONFIG.voiceIdentity?.capture?.roomCapture;
        expect(room?.soloNewVoiceFactor).toBe(1.0);
        expect(room?.classroomMultiSpeaker).toBe(true);
    });

    it('thresholds de producción: NEW_VOICE 0.64, CONTINUITY 0.80, REUSE 0.66 (medidos 2026-10-07)', () => {
        const thresholds = FLU_CONFIG.voiceIdentity?.capture?.conversationSpeakerThresholds;
        expect(thresholds?.cosineNewVoiceThreshold).toBe(0.64);
        expect(thresholds?.cosineContinuityThreshold).toBe(0.80);
        expect(thresholds?.productionClusterReuseThreshold).toBe(0.66);
    });
});
