// ============================================================
// speakerPinnedMismatch.test.ts — Aprendizaje del cluster AUTOMATICO
// ------------------------------------------------------------
// Invariante: un cluster automatico («Hablante N») solo aprende medidas de SU
// MISMA voz.
//
// DEFECTO MEDIDO en el log del dueño (2026-10-18): la firma del cluster se
// mezclaba con TODA medida entrante, sin importar de quién fuera. Un solo
// "Hablante 1" acababa casando con el dueño y con la niña (lastSim
// 0.143/0.192/0.380/0.374) y ya no había forma de separarlos con "soy Luis".
// REGLA: el cluster aprende SOLO medidas que pasan el piso de MISMA VOZ
// (`sameVoiceFloor`). Lo demás es OTRA persona: no se aprende y la voz distinta
// usa/abre SU cluster.
//
// Corte 2026-10-26 (feature/conversacion-modulo-nuevo): las dos secciones de
// decision de este guard se retiraron con su dueno (resolveConversationSpeaker,
// BORRADO en el commit 365eeef5; la decision vive ahora en decidirIdentidad,
// src/voice/conversation/identidad.ts). Queda VIVO el aprendizaje del cluster:
// updateClusterSignature y sameVoiceFloor de src/voice/lib/speakerClusters.js
// siguen consumidos por voiceIdentity.js, api/identity.ts y
// registerParticipantVoice.ts.
// ============================================================
import { describe, expect, it } from 'vitest';
import { sameVoiceFloor, updateClusterSignature } from '../src/voice/lib/speakerClusters.js';
import { compareCosineSignatures } from '../src/voice/lib/speakerCore.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const DIM = 64;
function makeVector(pairs: Array<[number, number]>): number[] {
    const v: number[] = new Array(DIM).fill(0);
    for (const [index, value] of pairs) v[index] = value;
    return v;
}

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
