// ============================================================
// speakerPrimarySeed — Fase E: vincular la voz del participante
// activo (perfil creado: Juan/Luis) a su nombre en diarización.
//
// Problema: la diarización etiquetaba los turnos del niño que crea
// su perfil como «Hablante N» en vez de su nombre (Juan/Luis).
// El perfil se registra sin firma de voz, y sessionPrimary se
// sembraba solo tras el primer commit (con lo que la etiqueta
// automática produjera).
//
// Fix (config-driven, sin regresiones):
//   - roomCapture.seedSessionPrimaryFromActiveParticipant = true
//     (hook): siembra sessionPrimary con el nombre del participante
//     real activo (no anónimo/default).
//   - roomCapture.sessionPrimaryCreateCluster = true (voiceIdentity):
//     en resolveProductionSpeakerAtBoundary, si el participante
//     primario (Juan/Luis) aún no tiene cluster (primer turno) y la
//     voz NO encaja fuertemente con un cluster auto existente ni con
//     el último hablante, se crea su cluster y el turno se etiqueta
//     con su nombre (no «Hablante 1»).
//
// Vectores: 64-D con coseno exacto (L2-normalizados). q(sim) =
// sim·e0 + √(1−sim²)·e1 → coseno con e0 = sim.
// ============================================================
// ------------------------------------------------------------
// P11.11 (2026-10-14): el nombre ya NO se estampa sin MEDIDA. Los mandatos del dueno
// (P10.8/P11.4 y la regla registeredIdentityConfirmed: si el ancla aun no existe,
// tampoco) RETIRARON la conducta Fase E de etiquetar el turno con el nombre: el ANCLA
// 'Juan' se sigue creando (para poder afirmar el nombre en turnos POSTERIORES con medida),
// pero el turno que la crea NO se rotula con el nombre (devuelve el hablante vigente).
// Los 2 casos que median la etiqueta vieja se ALINEAN a la regla nueva (era la
// expectativa, no el codigo; speakerDiarization.js:265-294).
// ------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import { resolveConversationSpeaker } from '../src/voice/lib/voiceIdentity.js';

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
const THRESHOLDS = {
    cosineNewVoiceThreshold: 0.64,
    cosineContinuityThreshold: 0.70,
    productionClusterReuseThreshold: 0.70,
};

// Frase ≥4 palabras y ≥1500 ms de voz → NO cae en findShortUtteranceHistoricalMatch.
const BASE = {
    atTurnBoundary: true,
    voicedSampleCount: 96000,
    sampleRate: 48000,
    utteranceText: 'esta es una frase de prueba para voz',
    thresholds: THRESHOLDS,
    allowNewCluster: true,
};

describe('resolveConversationSpeaker — Fase E: seed del participante primario (Juan/Luis)', () => {
    it('sessionPrimary=Juan, sin clusters, voz fresca → crea el ANCLA Juan y el turno NO lleva el nombre', () => {
        const clusters: any[] = [];
        const diagnosis: Record<string, unknown> = {};
        const r = resolveConversationSpeaker({
            ...BASE,
            signatureVector: query(0.5),
            speakerClusters: clusters,
            lastSpeaker: '',
            lastSignature: null,
            sessionPrimary: 'Juan',
            diagnosis,
        } as any);
        // P11.11: el turno NO se nombra sin MEDIDA; el ANCLA 'Juan' SI se crea (arriba).
        expect(r).toBe('Hablante 1');
        expect(clusters.map((c) => c.label)).toEqual(['Juan']);
        expect(clusters[0].signature).toBeTruthy();
        expect(diagnosis.reason).toBe('production-primary-create-cluster');
    });

    it('sessionPrimary=Juan, cluster auto Hablante 1 que encaja fuerte → NO crea Juan (sin regresión)', () => {
        const clusters: any[] = [{ label: 'Hablante 1', signature: E1 }];
        const diagnosis: Record<string, unknown> = {};
        const r = resolveConversationSpeaker({
            ...BASE,
            signatureVector: query(0.9),
            speakerClusters: clusters,
            lastSpeaker: 'Hablante 1',
            lastSignature: E1,
            sessionPrimary: 'Juan',
            diagnosis,
        } as any);
        expect(r).toBe('Hablante 1');
        expect(clusters.map((c) => c.label)).toEqual(['Hablante 1']);
        expect(diagnosis.reason).toBe('production-last-continuity');
    });

    it('sessionPrimary vacío, sin clusters → comportamiento sin cambio (crea Hablante 1)', () => {
        const clusters: any[] = [];
        const diagnosis: Record<string, unknown> = {};
        const r = resolveConversationSpeaker({
            ...BASE,
            signatureVector: query(0.5),
            speakerClusters: clusters,
            lastSpeaker: '',
            lastSignature: null,
            sessionPrimary: '',
            diagnosis,
        } as any);
        expect(r).toBe('Hablante 1');
        expect(clusters.map((c) => c.label)).toEqual(['Hablante 1']);
        expect(diagnosis.reason).toBe('production-first-cluster');
    });

    it('sessionPrimary=Juan, cluster auto Hablante 1 con voz distinta → abre el ANCLA Juan y el turno NO lleva el nombre', () => {
        // La voz del query (e0) NO encaja con Hablante 1 (E1) ni con el último hablante:
        // sim baja → se crea el cluster del participante primario.
        const clusters: any[] = [{ label: 'Hablante 1', signature: E2 }];
        const diagnosis: Record<string, unknown> = {};
        const r = resolveConversationSpeaker({
            ...BASE,
            signatureVector: query(0.1),
            speakerClusters: clusters,
            lastSpeaker: 'Hablante 1',
            lastSignature: E2,
            sessionPrimary: 'Juan',
            diagnosis,
        } as any);
        // P11.11: ancla creada; el turno NO se nombra (sin coincidencia medida con su voz).
        expect(r).toBe('Hablante 1');
        expect(clusters.map((c) => c.label)).toEqual(['Hablante 1', 'Juan']);
        expect(diagnosis.reason).toBe('production-primary-create-cluster');
    });

    it('PRUEBA DE DETECTOR (el detector no es decorativo): el ANCLA da el nombre SOLO con medida que coincide', () => {
        // Dos lados de la marca: sin ancla, la voz fresca NO se nombra; con ancla 'Juan' y
        // la MISMA voz del query, el nombre SI se afirma.
        const sinAncla: any[] = [];
        const diagA: Record<string, unknown> = {};
        const fresco = resolveConversationSpeaker({
            ...BASE,
            signatureVector: query(0.9),
            speakerClusters: sinAncla,
            lastSpeaker: '',
            lastSignature: null,
            sessionPrimary: 'Juan',
            diagnosis: diagA,
        } as any);
        const conAncla: any[] = [{ label: 'Juan', signature: query(0.9) }];
        const diagB: Record<string, unknown> = {};
        const medido = resolveConversationSpeaker({
            ...BASE,
            signatureVector: query(0.9),
            speakerClusters: conAncla,
            lastSpeaker: 'Juan',
            lastSignature: query(0.9),
            sessionPrimary: 'Juan',
            diagnosis: diagB,
        } as any);
        expect(fresco, 'sin ancla no se afirma el nombre').toBe('Hablante 1');
        expect(medido, 'con ancla y medida coincidente SI').toBe('Juan');
    });
});
