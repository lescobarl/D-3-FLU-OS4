// ============================================================
// speakerPrimarySeed — el participante activo NO es un default de identidad.
//
// Historia: la "Fase E" creaba el ANCLA del participante primario (Juan/Luis) con la
// PRIMERA voz que sonara, para que sus turnos salieran con su nombre. MEDIDO en la
// sesion real del dueno (2026-10-18): esa primera voz era la TV, y el nombre del
// onboarding quedo bendecido como ancla de un desconocido; ademas las ramas de ventana
// corta estampaban el nombre con medidas de 0.741 (banda de "misma voz", no de
// identidad).
//
// MANDATO 2026-10-18 (regla vigente, la que este test mide):
//   - el nombre del participante activo NUNCA se estampa por defecto ni por cercania;
//   - un ancla con NOMBRE PROPIO no se crea con una voz arbitraria: solo entra por su
//     DATO ("ok flu soy Juan", registerSpeakerIdentity) o por una identidad registrada;
//   - el nombre se AFIRMA solo con coincidencia MEDIDA y ventana SOSTENIDA contra un
//     ancla que ya existe (`canAssertSpeakerName`, piso 0.76);
//   - cada voz desconocida recibe su «Hablante N» estable.
// Vectores: 64-D con coseno exacto (L2-normalizados).
// q(sim) = sim·e0 + √(1−sim²)·e1 → coseno con e0 = sim.
// ============================================================
import { describe, it, expect } from 'vitest';
import { resolveConversationSpeaker } from '../src/voice/lib/voiceIdentity.js';

// ---- helpers de vectores deterministas -----------------------
const DIM = 64;

function makeVector(pairs: Array<[number, number]>): number[] {
    const v: number[] = new Array(DIM).fill(0);
    for (const [index, value] of pairs) v[index] = value;
    return v;
}

// e0 = voz A (Hablante 1); e2 = voz B, ortogonal a la rama del query.
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

// Frase ≥4 palabras y ≥1500 ms de voz → ventana SOSTENIDA (no cae en la regla corta).
const BASE = {
    atTurnBoundary: true,
    voicedSampleCount: 96000,
    sampleRate: 48000,
    utteranceText: 'esta es una frase de prueba para voz',
    thresholds: THRESHOLDS,
    allowNewCluster: true,
};

describe('resolveConversationSpeaker — el nombre del participante NO es un default', () => {
    it('sessionPrimary=Juan SIN ancla y voz fresca → NO crea ancla «Juan»; la voz es «Hablante 1»', () => {
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
        // El cluster que nace es ANONIMO: si esa primera voz es la TV, no queda bautizada.
        expect(r).toBe('Hablante 1');
        expect(clusters.map((c) => c.label)).toEqual(['Hablante 1']);
        expect(diagnosis.reason).toBe('production-first-cluster');
    });

    it('sessionPrimary=Juan con cluster auto que encaja fuerte → sigue «Hablante 1» (sin regresión)', () => {
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

    it('sessionPrimary=Juan con otra voz → abre «Hablante 2», NUNCA un ancla con su nombre', () => {
        // La voz del query (0.6 contra el cluster Hablante 1, 0 contra la firma del ultimo
        // turno) es una voz distinta pero no una identidad: se abre una etiqueta ANONIMA nueva.
        const clusters: any[] = [{ label: 'Hablante 1', signature: E1 }];
        const diagnosis: Record<string, unknown> = {};
        const r = resolveConversationSpeaker({
            ...BASE,
            signatureVector: query(0.6),
            speakerClusters: clusters,
            lastSpeaker: 'Hablante 1',
            lastSignature: E2,
            sessionPrimary: 'Juan',
            diagnosis,
        } as any);
        expect(r).toBe('Hablante 2');
        expect(clusters.map((c) => c.label)).toEqual(['Hablante 1', 'Hablante 2']);
        expect(diagnosis.reason).toBe('production-forced-new-voice');
    });

    it('PRUEBA DE DETECTOR: el nombre SOLO se afirma con ancla previa y medida que coincide', () => {
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

    it('PRUEBA DE DETECTOR: en ventana CORTA el nombre NO se afirma aunque el ancla exista', () => {
        // Misma voz y mismo ancla que el caso anterior, pero 2 palabras y <1.5 s: la medida
        // corta fluctua dentro de la banda de "misma voz" (la mujer midio 0.741 contra Luis),
        // asi que el turno conserva su etiqueta anonima (mandato 2026-10-18).
        const clusters: any[] = [
            { label: 'Juan', signature: query(0.9) },
            { label: 'Hablante 1', signature: query(0.9) },
        ];
        const diagnosis: Record<string, unknown> = {};
        const r = resolveConversationSpeaker({
            ...BASE,
            signatureVector: query(0.9),
            speakerClusters: clusters,
            lastSpeaker: 'Hablante 1',
            lastSignature: query(0.9),
            utteranceText: 'hola juan',
            voicedSampleCount: 20000,
            sessionPrimary: 'Juan',
            diagnosis,
        } as any);
        expect(r).toBe('Hablante 1');
    });
});
