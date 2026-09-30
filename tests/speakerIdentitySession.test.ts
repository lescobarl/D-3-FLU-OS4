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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveConversationSpeaker } from '../src/voice/lib/speakerDiarization';
import {
    clearSessionPrimarySpeaker,
    setSessionPrimarySpeaker,
} from '../src/voice/lib/sessionPrimarySpeaker';

const hookSource = () =>
    readFileSync(join(process.cwd(), 'src', 'voice', 'hooks', 'useFluVoiceAssistant.js'), 'utf8');

/**
 * El hook enruta la presentacion por voz al DUENO UNICO del primario
 * (`setSessionPrimarySpeaker`, fuente 'presented'): ya no escribe el ref a mano.
 */
export function hookRoutesPresentedToOwner(src: string): boolean {
    return /setSessionPrimarySpeaker\(sessionPrimarySpeakerRef,\s*introducedName,\s*'presented'\)/.test(src);
}

/** Escritores DIRECTOS del ref en un fuente (debe ser 0: el dueno es el modulo). */
export function directSessionPrimaryWrites(src: string): number {
    return (src.match(/sessionPrimarySpeakerRef\.current\s*=/g) || []).length;
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

    it('GUARD: el hook enruta la presentacion por voz al dueno unico del primario', () => {
        expect(hookRoutesPresentedToOwner(hookSource())).toBe(true);
    });

    it('GUARD: no queda ningun escritor DIRECTO del ref en src (dueno unico)', () => {
        expect(directSessionPrimaryWrites(hookSource())).toBe(0);
        expect(
            directSessionPrimaryWrites(
                readFileSync(join(process.cwd(), 'src', 'voice', 'lib', 'turnSpeakerCommit.js'), 'utf8'),
            ),
        ).toBe(0);
    });
});

// P2.4 - prueba de detector: alimentado el infractor sintetico, la marca.
describe('identidad de hablante - el detector no es decorativo', () => {
    it('marca el hook que enruta la presentacion y no el que la ignora', () => {
        expect(hookRoutesPresentedToOwner("setSessionPrimarySpeaker(sessionPrimarySpeakerRef, introducedName, 'presented')")).toBe(true)
        expect(hookRoutesPresentedToOwner('const x = introducedName')).toBe(false)
        expect(directSessionPrimaryWrites('sessionPrimarySpeakerRef.current = name')).toBe(1)
        expect(directSessionPrimaryWrites('setSessionPrimarySpeaker(ref, name)')).toBe(0)
    })
})

describe('precedencia del primario de sesion - decide el dueno unico', () => {
    const nuevoRef = () => ({ current: '' });

    it('presented MANDA: el participante no lo pisa', () => {
        const ref = nuevoRef();
        expect(setSessionPrimarySpeaker(ref, 'Luis', 'presented')).toBe(true);
        expect(setSessionPrimarySpeaker(ref, 'Juan', 'participant')).toBe(false);
        expect(ref.current).toBe('Luis');
    });

    it('participant siembra y presented lo puede corregir', () => {
        const ref = nuevoRef();
        expect(setSessionPrimarySpeaker(ref, 'Juan', 'participant')).toBe(true);
        expect(setSessionPrimarySpeaker(ref, 'Luis', 'presented')).toBe(true);
        expect(ref.current).toBe('Luis');
    });

    it('resolved solo RELLENA si esta vacio', () => {
        const ref = nuevoRef();
        expect(setSessionPrimarySpeaker(ref, 'Luis', 'resolved')).toBe(true);
        expect(setSessionPrimarySpeaker(ref, 'Juan', 'resolved')).toBe(false);
        expect(ref.current).toBe('Luis');
    });

    it('no acepta etiquetas automaticas ni vacio', () => {
        const ref = nuevoRef();
        expect(setSessionPrimarySpeaker(ref, 'Hablante 1', 'presented')).toBe(false);
        expect(setSessionPrimarySpeaker(ref, '', 'participant')).toBe(false);
        expect(ref.current).toBe('');
    });

    it('clear limpia el ref y su rango (sesion nueva vuelve a sembrar)', () => {
        const ref = nuevoRef();
        setSessionPrimarySpeaker(ref, 'Luis', 'presented');
        clearSessionPrimarySpeaker(ref);
        expect(ref.current).toBe('');
        expect(setSessionPrimarySpeaker(ref, 'Juan', 'participant')).toBe(true);
    });
});