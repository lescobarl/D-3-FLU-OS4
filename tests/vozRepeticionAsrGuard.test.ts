// ============================================================
// vozRepeticionAsrGuard - la repeticion CONTIGUA del ASR se colapsa
// en CUALQUIER posicion, no solo al principio de la frase.
// ------------------------------------------------------------
// DEFECTO DEL DUENO (2026-10-09, bitacora): la ultima frase mostraba
//   "cer rando cerrando escucha cerrando escucha"
// El bloque "cerrando escucha" esta repetido, pero NO al inicio (delante
// queda la basura "cer rando"). El colapsador solo miraba la CABEZA
// (words[0..size) vs words[size..2*size)) y ademas el colapsador fuerte
// (collapseAsrStutter) solo corria con >=48 chars, asi que esta frase
// corta salia tal cual.
//
// Este guard es de COMPORTAMIENTO y exige la PROPIEDAD (no un texto
// concreto): tras normalizar, NO puede quedar un bloque contiguo repetido.
//
// NAVEGACION: el caso del dueno (1,2) y la invariante de "no comerse una
// repeticion NO contigua" (5) fijan las dos orillas.
import { describe, expect, it } from 'vitest';
import { collapseRepeatedSpeech, normalizeMicText } from '../src/voice/lib/speechMerge.js';

/** Predicado del DETECTOR: existe un bloque de >=2 palabras repetido SEGUIDO. */
function tieneBloqueContiguoRepetido(text: string): boolean {
    const words = String(text || '')
        .split(/\s+/)
        .filter(Boolean);
    for (let size = Math.max(2, Math.floor(words.length / 2)); size >= 2; size -= 1) {
        for (let i = 0; i + size * 2 <= words.length; i += 1) {
            const head = words.slice(i, i + size).join(' ').toLowerCase();
            const mid = words.slice(i + size, i + size * 2).join(' ').toLowerCase();
            if (head && head === mid) return true;
        }
    }
    return false;
}

describe('vozRepeticionAsrGuard - la repeticion contigua se colapsa en cualquier posicion', () => {
    it('colapsa el bloque repetido que NO esta al inicio (defecto del dueno)', () => {
        const bruto = 'cer rando cerrando escucha cerrando escucha';
        const limpio = normalizeMicText(bruto);
        expect(
            tieneBloqueContiguoRepetido(limpio),
            `quedo un bloque contiguo repetido: "${limpio}"`,
        ).toBe(false);
    });

    it('el colapsador subyacente quita la repeticion en medio, no solo en la cabeza', () => {
        expect(collapseRepeatedSpeech('alfa beta gamma beta gamma')).toBe('alfa beta gamma');
    });

    it('conserva el caso historico anclado al inicio', () => {
        expect(collapseRepeatedSpeech('a b a b c')).toBe('a b c');
    });
});

describe('vozRepeticionAsrGuard - el detector no es decorativo (control negativo)', () => {
    it('marca una repeticion contigua y perdona una limpia', () => {
        expect(tieneBloqueContiguoRepetido('cer rando cerrando escucha cerrando escucha')).toBe(true);
        expect(tieneBloqueContiguoRepetido('cer rando cerrando escucha')).toBe(false);
    });
});

describe('vozRepeticionAsrGuard - invariante: NO se elimina una palabra cuya repeticion no es contigua', () => {
    it('conserva el arranque legitimo que reaparece al final', () => {
        expect(normalizeMicText('hola ya hola')).toBe('hola ya hola');
        expect(normalizeMicText('hola ya estamos listos hola')).toBe('hola ya estamos listos hola');
    });
});

describe('vozRepeticionAsrGuard - un bloque de NUMEROS repetido es DATO, no eco del ASR', () => {
    it('no colapsa la repeticion de un bloque de numeros (dictado contando)', () => {
        const contando = 'voy en el 31 32 33 34 33 34 35 36 y sigo';
        expect(normalizeMicText(contando)).toContain('33 34 33 34');
    });

    it('el detector distingue DATO de eco: numeros no se tocan, palabras si', () => {
        expect(normalizeMicText('foo bar foo bar')).toBe('foo bar');
        expect(normalizeMicText('12 13 12 13')).toBe('12 13 12 13');
    });
});
