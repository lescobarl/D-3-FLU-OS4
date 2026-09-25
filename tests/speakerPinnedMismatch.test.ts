// ============================================================
// speakerPinnedMismatch.test.ts — Guard de diarización
// ------------------------------------------------------------
// Invariante: un perfil/hablante REGISTRADO (p. ej. el participante
// "Luis") NO debe forzarse sobre una voz que NO coincide con su firma.
// Antes, `registered-pinned-*` devolvía el nombre registrado aun con
// similitud baja → voces distintas (la hija) se etiquetaban "Luis".
// ============================================================
import { describe, expect, it } from 'vitest';
import { resolveConversationSpeaker } from '../src/voice/lib/voiceIdentity.js';

const DIM = 64;
function makeVector(pairs: Array<[number, number]>): number[] {
    const v: number[] = new Array(DIM).fill(0);
    for (const [index, value] of pairs) v[index] = value;
    return v;
}

// e0 = voz del titular ("Luis"); e2 = otra voz (otra persona), ortogonal.
const LUIS_VOICE = makeVector([[0, 1]]);
const OTHER_VOICE = makeVector([[2, 1]]);

const THRESHOLDS = {
    cosineNewVoiceThreshold: 0.64,
    cosineContinuityThreshold: 0.7,
    productionClusterReuseThreshold: 0.7,
    cosineRegisteredMatchThreshold: 0.72,
    cosineMatchThreshold: 0.76,
};

const BASE = {
    voicedSampleCount: 96000,
    sampleRate: 48000,
    utteranceText: 'esta es una frase de prueba para voz',
    thresholds: THRESHOLDS,
    allowNewCluster: true,
    atTurnBoundary: false,
};

describe('resolveConversationSpeaker — no forzar el perfil registrado con voz distinta', () => {
    it('una voz distinta NO se etiqueta con el participante registrado', () => {
        const clusters: any[] = [
            { label: 'Luis', signature: LUIS_VOICE },
            { label: 'Hablante 1', signature: OTHER_VOICE },
        ];
        const diagnosis: Record<string, unknown> = {};
        const r = resolveConversationSpeaker({
            ...BASE,
            signatureVector: OTHER_VOICE,
            speakerClusters: clusters,
            preferSpeaker: 'Luis',
            sessionPrimary: 'Luis',
            diagnosis,
        } as any);
        expect(r).toBe('Hablante 1');
    });

    it('una voz que SÍ coincide con el registrado se mantiene', () => {
        const clusters: any[] = [
            { label: 'Luis', signature: LUIS_VOICE },
            { label: 'Hablante 1', signature: OTHER_VOICE },
        ];
        const diagnosis: Record<string, unknown> = {};
        const r = resolveConversationSpeaker({
            ...BASE,
            signatureVector: LUIS_VOICE,
            speakerClusters: clusters,
            preferSpeaker: 'Luis',
            sessionPrimary: 'Luis',
            diagnosis,
        } as any);
        expect(r).toBe('Luis');
    });
});
