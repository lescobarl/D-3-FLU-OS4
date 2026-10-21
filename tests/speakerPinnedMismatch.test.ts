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
import { sameVoiceFloor, updateClusterSignature } from '../src/voice/lib/speakerClusters.js';
import { compareCosineSignatures } from '../src/voice/lib/speakerCore.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

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

// ============================================================
// Regresión: el lazo de realimentación del pin.
// ------------------------------------------------------------
// Antes, el pin del registrado hacía `updateClusterSignature(pinnedCluster,
// vector)` al acertar, y esa firma mezcla el vector entrante con más peso que
// el acumulado. Cada turno acercaba el ancla del titular a la voz que acababa
// de sonar, así que la TV (o cualquier otra voz) terminaba pasando el umbral y
// TODA la sala se etiquetaba con su nombre. El umbral del pin era además el
// más bajo de la tabla: más laxo que «es la misma voz que un cluster».
// ============================================================
describe('pin del registrado: el ancla no se contamina (regresión)', () => {
    const PROD = FLU_CONFIG.voiceIdentity.capture.conversationSpeakerThresholds;

    const LUIS = makeVector([[0, 1]]);
    /** Voz con coseno exacto `sim` respecto a la del titular. */
    const haciaLuis = (sim: number) => makeVector([[0, sim], [1, Math.sqrt(1 - sim * sim)]]);

    function llamar(vector: number[], clusters: any[]) {
        return resolveConversationSpeaker({
            voicedSampleCount: 96000,
            sampleRate: 48000,
            utteranceText: 'esta es una frase de prueba para voz',
            thresholds: PROD,
            allowNewCluster: true,
            atTurnBoundary: false,
            signatureVector: vector,
            speakerClusters: clusters,
            lastSpeaker: 'Luis',
            lastSignature: LUIS,
            preferSpeaker: 'Luis',
            sessionPrimary: 'Luis',
        } as any);
    }

    // El bug: la firma del cluster se mezclaba con la voz entrante en cada
    // turno, así que el ancla derivaba hacia la voz que acababa de sonar.
    // El umbral de estas similitudes cubre toda la banda de decisión (por
    // encima del pin, justo por debajo y muy por debajo).
    it('el ancla no deriva con ninguna similitud de la voz entrante', () => {
        for (const sim of [0.9, 0.84, 0.8, 0.7]) {
            const clusters: any[] = [{ label: 'Luis', signature: [...LUIS] }];
            llamar(haciaLuis(sim), clusters);
            expect(clusters[0].signature, `sim=${sim}`).toEqual(LUIS);
        }
    });

    it('turnos repetidos de otra voz no arrastran el ancla', () => {
        const clusters: any[] = [{ label: 'Luis', signature: [...LUIS] }];
        for (let i = 0; i < 8; i++) llamar(haciaLuis(0.8), clusters);
        expect(clusters[0].signature).toEqual(LUIS);
    });

    it('una voz claramente distinta no se etiqueta con su nombre', () => {
        const clusters: any[] = [{ label: 'Luis', signature: [...LUIS] }];
        expect(llamar(haciaLuis(0.7), clusters)).not.toBe('Luis');
    });
});

// ============================================================
// Aprendizaje del cluster AUTOMATICO («Hablante N»): una sola voz por cluster.
// ------------------------------------------------------------
// DEFECTO MEDIDO en el log del dueño (2026-10-18): la firma del cluster se mezclaba
// con TODA medida entrante, sin importar de quién fuera. Un solo "Hablante 1"
// acababa casando con el dueño y con la niña (lastSim 0.143/0.192/0.380/0.374) y
// ya no había forma de separarlos con "soy Luis".
// REGLA: el cluster aprende SOLO medidas que pasan el piso de MISMA VOZ
// (`sameVoiceFloor`, el mismo de la diarización). Lo demás es OTRA persona: no se
// aprende y la voz distinta usa/abre SU cluster.
// ============================================================
describe('updateClusterSignature: un cluster no aprende una voz por debajo del piso de MISMA VOZ', () => {
    const VOZ = makeVector([[0, 1]]);
    /** Voz con coseno exacto `sim` respecto a `VOZ`. */
    const otraVoz = (sim: number) =>
        makeVector([[0, sim], [1, Math.sqrt(1 - sim * sim)]]);

    it('DETECTOR: una medida por debajo del piso NO contamina la firma ni su historial', () => {
        const piso = sameVoiceFloor();
        expect(piso, 'el piso es el de la diarizacion').toBe(
            FLU_CONFIG.voiceIdentity.capture.conversationSpeakerThresholds.productionClusterReuseThreshold,
        );
        const cluster: any = { label: 'Hablante 1', signature: [...VOZ], signatureHistory: [[...VOZ]] };
        updateClusterSignature(cluster, otraVoz(piso - 0.1));
        expect(cluster.signature, 'la firma de la voz se conserva intacta').toEqual(VOZ);
        expect(cluster.signatureHistory, 'tampoco entra al historial de medidas').toEqual([[...VOZ]]);
    });

    it('CONTROL legitimo: la MISMA voz (por encima del piso) si aprende', () => {
        const cluster: any = { label: 'Hablante 1', signature: [...VOZ], signatureHistory: [[...VOZ]] };
        const medida = otraVoz(Math.min(0.95, sameVoiceFloor() + 0.2));
        const antes = compareCosineSignatures(cluster.signature, medida);
        updateClusterSignature(cluster, medida);
        expect(compareCosineSignatures(cluster.signature, medida), 'la medida legitima acerca la firma').toBeGreaterThan(antes);
        expect(cluster.signatureHistory).toHaveLength(2);
    });

    it('repetir la voz ajena turno tras turno nunca la acerca al cluster', () => {
        const cluster: any = { label: 'Hablante 1', signature: [...VOZ], signatureHistory: [[...VOZ]] };
        const ajena = otraVoz(0.2);
        for (let i = 0; i < 10; i++) updateClusterSignature(cluster, ajena);
        expect(cluster.signature).toEqual(VOZ);
    });
});
