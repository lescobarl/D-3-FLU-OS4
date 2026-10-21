// ============================================================
// speakerIdentityNoInheritance.test.ts — Guard de diarización
// ------------------------------------------------------------
// Invariante 1: una etiqueta NO se hereda por continuidad sin
// evidencia de voz. Antes, `anchorLastSpeaker` etiquetaba «sigue
// siendo el de antes» y ADEMÁS mezclaba la voz entrante en la firma
// del clúster, así que un solo clúster acababa casando con toda la
// sala (la TV, FLU y el titular con el mismo nombre).
//
// Invariante 2: un nombre propio (persona registrada) solo se afirma
// con coincidencia contra su ancla. Nunca por línea de tiempo.
// ============================================================
import { describe, expect, it } from 'vitest';
import { resolveConversationSpeaker } from '../src/voice/lib/voiceIdentity.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const DIM = 64;
function makeVector(pairs: Array<[number, number]>): number[] {
    const v: number[] = new Array(DIM).fill(0);
    for (const [index, value] of pairs) v[index] = value;
    return v;
}

// Tres voces ortogonales entre sí: el titular, la TV y FLU.
const LUIS = makeVector([[0, 1]]);
const TV = makeVector([[1, 1]]);

const PROD = FLU_CONFIG.voiceIdentity.capture.conversationSpeakerThresholds;

function turno(
    vector: number[],
    clusters: any[],
    last: { speaker: string; signature: number[] },
    extra: Record<string, unknown> = {},
): string {
    const label = resolveConversationSpeaker({
        voicedSampleCount: 96000,
        sampleRate: 48000,
        utteranceText: 'esta es una frase de prueba para voz',
        thresholds: PROD,
        allowNewCluster: true,
        atTurnBoundary: true,
        signatureVector: vector,
        speakerClusters: clusters,
        lastSpeaker: last.speaker,
        lastSignature: last.signature,
        ...extra,
    } as any);
    last.speaker = label;
    last.signature = vector;
    return label;
}

describe('la etiqueta no se hereda por continuidad sin evidencia de voz', () => {
    it('la TV repetida no se etiqueta como el titular registrado', () => {
        const clusters: any[] = [{ label: 'Luis', signature: [...LUIS] }];
        const last = { speaker: '', signature: [] as number[] };
        for (let i = 0; i < 6; i += 1) {
            expect(
                turno(TV, clusters, last, { preferSpeaker: 'Luis', sessionPrimary: 'Luis' }),
                `turno de TV ${i}`,
            ).not.toBe('Luis');
        }
    });

    it('el titular conserva su nombre después de una racha de la TV', () => {
        const clusters: any[] = [{ label: 'Luis', signature: [...LUIS] }];
        const last = { speaker: '', signature: [] as number[] };
        for (let i = 0; i < 6; i += 1) {
            turno(TV, clusters, last, { preferSpeaker: 'Luis', sessionPrimary: 'Luis' });
        }
        expect(
            turno(LUIS, clusters, last, { preferSpeaker: 'Luis', sessionPrimary: 'Luis' }),
        ).toBe('Luis');
    });

    it('un clúster no aprende la voz que solo pasaba por continuidad', () => {
        const clusters: any[] = [{ label: 'Luis', signature: [...LUIS] }];
        const last = { speaker: '', signature: [] as number[] };
        for (let i = 0; i < 6; i += 1) {
            turno(TV, clusters, last, { preferSpeaker: 'Luis', sessionPrimary: 'Luis' });
        }
        const luis = clusters.find((c) => c.label === 'Luis');
        expect(luis?.signature).toEqual(LUIS);
    });

    it('un turno previo mal etiquetado no arrastra el nombre al siguiente', () => {
        // El caso del log: un turno de la TV quedó como 'Luis' y, a partir de
        // ahí, TODOS los turnos de la TV heredaban el nombre. Ocurre tanto en
        // frontera de turno como fuera de ella.
        for (const atTurnBoundary of [true, false]) {
            const clusters: any[] = [{ label: 'Luis', signature: [...LUIS] }];
            const last = { speaker: 'Luis', signature: [...TV] };
            expect(
                turno(TV, clusters, last, {
                    preferSpeaker: 'Luis',
                    sessionPrimary: 'Luis',
                    atTurnBoundary,
                }),
                `atTurnBoundary=${atTurnBoundary}`,
            ).not.toBe('Luis');
        }
    });

    it('tres voces distintas no colapsan en una sola etiqueta', () => {
        // Voces ORTOGONALES (sim 0) son un extremo artificial; se usan voces en la
        // banda MEDIDA de "otra persona" (~0.60): misma voz 0.69-0.74 / distinta
        // ~0.58-0.60. Criterio VIGENTE (mandato 2026-10-18): un turno sostenido que
        // no casa con ninguna voz abre SU etiqueta; no existe rama de herencia por
        // "sin evidencia".
        const c = Math.sqrt(0.6);
        const s = Math.sqrt(1 - 0.6);
        const voces = [
            makeVector([[0, c], [1, s]]),
            makeVector([[0, c], [2, s]]),
            makeVector([[0, c], [3, s]]),
        ];
        const clusters: any[] = [];
        const last = { speaker: '', signature: [] as number[] };
        const labels = new Set<string>();
        for (let ronda = 0; ronda < 4; ronda += 1) {
            for (const voz of voces) labels.add(turno(voz, clusters, last));
        }
        expect(labels.size).toBeGreaterThanOrEqual(3);
    });
});
