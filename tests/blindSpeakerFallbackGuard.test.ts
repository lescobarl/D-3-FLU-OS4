// ============================================================
// #1 — SIN EVIDENCIA, LA ETIQUETA NO HEREDA UN NOMBRE PROPIO (guard de CONDUCTA)
// ------------------------------------------------------------
// Medido (sesion real del dueno, 2026-10-05): `SpeakerTrace ... snap=0
// fallback="luis" last="luis"` -> TODOS los turnos sin audio se rotulaban con el
// nombre del dueno, incluidas voces de mujeres del salon. La causa raiz de "no
// hay audio" es E0 (bufér desacoplado, ya arreglado), pero la REGLA tiene que
// valer por si sola: un NOMBRE PROPIO no se hereda a ciegas (ni por continuidad
// ni cuando no hay audio), solo entra por wake ("ok flu soy Ana") o por
// diarizacion de AUDIO. El habla pasiva ya lo cumple (resolveSpeakerByText);
// esto cubre el relleno de la CONVERSACION.
// ============================================================
import { describe, it, expect } from 'vitest';
import { blindSpeakerFallback } from '../src/voice/lib/speakerPolicy.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const GENERIC = FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker;

/** Marca de infraccion: el relleno devuelve un nombre propio (se heredaria a ciegas). */
export function blindNameLeakOffenders(label: string, resultado: string): string[] {
    return resultado === label && label !== GENERIC && !/^Hablante\s*\d+$/i.test(label)
        ? [`sin evidencia la etiqueta hereda el nombre propio "${label}"`]
        : [];
}

describe('#1 — el relleno sin evidencia no hereda un nombre propio', () => {
    it('un nombre propio degrada al label generico', () => {
        for (const nombre of ['luis', 'Luis', 'LUIS', 'Ana', 'Montse']) {
            const out = blindSpeakerFallback(nombre);
            expect(out, nombre).toBe(GENERIC);
            expect(blindNameLeakOffenders(nombre, out), nombre).toEqual([]);
        }
    });

    it('una etiqueta automatica y el generico se conservan', () => {
        expect(blindSpeakerFallback('Hablante 2')).toBe('Hablante 2');
        expect(blindSpeakerFallback(GENERIC)).toBe(GENERIC);
    });

    it('vacio (o basura) cae al generico', () => {
        for (const entrada of ['', '   ', 'undefined', 'false']) {
            expect(blindSpeakerFallback(entrada), JSON.stringify(entrada)).toBe(GENERIC);
        }
    });
});

// Prueba de detector (P2.4): el MISMO criterio marca la herencia del nombre y no
// marca la etiqueta generica; sin esto el guard seria teatro.
describe('#1 — el detector no es decorativo', () => {
    it('marca la herencia del nombre propio y no marca el generico', () => {
        expect(blindNameLeakOffenders('luis', 'luis')).toHaveLength(1);
        expect(blindNameLeakOffenders('luis', GENERIC)).toEqual([]);
        expect(blindNameLeakOffenders('Hablante 3', 'Hablante 3')).toEqual([]);
    });
});
