// ============================================================
// IDENTIDAD DE HABLANTE DE LA SESION
// ------------------------------------------------------------
// Defecto medido en la conversacion del dueno (2026-09-29): solo el PRIMER turno
// quedo con su nombre; el resto cayo a «Hablante 1». Causa: la presentacion por
// voz ("soy Luis") solo etiquetaba ESE turno (y guardaba el perfil de voz), pero
// NO fijaba el hablante primario de la sesion; los turnos siguientes iban sin
// `sessionPrimary` y el diarizador devolvia su etiqueta automatica.
//
// Invariante: (a) con primario de sesion, TODOS los turnos de esa voz llevan su
// nombre; (b) el control inverso: una voz DISTINTA no hereda el nombre.
// ============================================================
import { describe, it, expect } from 'vitest';
import { resolveConversationSpeaker } from '../src/voice/lib/speakerDiarization';

/** El hook fija el primario de sesion al oir la presentacion (mismo criterio del guard). */
export function hookSetsSessionPrimary(src: string): boolean {
    return /if \(introducedName && isProperSpeakerName\(introducedName\)\) sessionPrimarySpeakerRef\.current = introducedName/.test(
        src,
    );
}

const vozA = Array.from({ length: 512 }, (_, i) => Math.sin(i * 0.1));
const vozB = Array.from({ length: 512 }, (_, i) => Math.cos(i * 0.37));

const turno = (
    clusters: { label?: string; signature?: number[] }[],
    vector: number[],
    extra: Record<string, unknown> = {},
) =>
    resolveConversationSpeaker({
        speakerClusters: clusters,
        sessionPrimary: 'Luis',
        signatureVector: vector,
        voicedSampleCount: 48000,
        minVoicedSamples: 12000,
        sampleRate: 48000,
        utteranceText: 'siguiente carta por favor',
        atTurnBoundary: true,
        allowNewCluster: true,
        ...extra,
    } as never) as string;

describe('el hablante primario de la sesion conserva su nombre', () => {
    it('la MISMA voz mantiene el nombre en todos los turnos', () => {
        const clusters: { label?: string; signature?: number[] }[] = [];
        const r1 = turno(clusters, vozA);
        const r2 = turno(clusters, vozA, { lastSpeaker: r1 });
        const r3 = turno(clusters, vozA, { lastSpeaker: r2 });

        expect([r1, r2, r3]).toEqual(['Luis', 'Luis', 'Luis']);
    });

    it('CONTROL: una voz DISTINTA no hereda el nombre', () => {
        const clusters: { label?: string; signature?: number[] }[] = [];
        const r1 = turno(clusters, vozA);
        expect(r1).toBe('Luis');
        const otra = turno(clusters, vozB, { lastSpeaker: r1 });
        expect(otra).not.toBe('Luis');
    });

    it('GUARD: el hook fija el primario de sesion al detectar la presentacion por voz', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const hook = fs.readFileSync(
            path.join(process.cwd(), 'src', 'voice', 'hooks', 'useFluVoiceAssistant.js'),
            'utf8',
        );
        expect(hookSetsSessionPrimary(hook)).toBe(true);
    });
});

// P2.4 - prueba de detector: alimentado el infractor sintetico, la marca.
describe('identidad de hablante - el detector no es decorativo', () => {
    it('marca el hook que fija el primario y no el que no lo hace', () => {
        expect(hookSetsSessionPrimary('if (introducedName && isProperSpeakerName(introducedName)) sessionPrimarySpeakerRef.current = introducedName')).toBe(true)
        expect(hookSetsSessionPrimary('const x = introducedName')).toBe(false)
    })
})