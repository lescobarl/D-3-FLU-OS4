// ============================================================
// normalizeCommandForDeterministic — PUNTO ÚNICO DE NORMALIZACIÓN
// ------------------------------------------------------------
// El transcript crudo llega CON la wake word pegada y con eco ASR
// duplicado. Esta función (extraída de App.tsx onContractResolved)
// limpia el prefijo de wake word y colapsa los fragmentos duplicados
// para que TODOS los manejadores deterministas reciban un mandato
// limpio. Es la "una tubería" del hub de integración.
// ============================================================
import { describe, expect, it } from 'vitest';
import { normalizeCommandForDeterministic } from '../src/voice/lib/audioMath';

const WAKE_WORDS = ['flu', 'hey flu', 'oye flu', 'okay flu'];

describe('normalizeCommandForDeterministic', () => {
    it('quita la wake word al inicio del mandato', () => {
        expect(normalizeCommandForDeterministic('Flu generame una nota', WAKE_WORDS)).toBe('generame una nota');
    });

    it('quita un wake word compuesto al inicio', () => {
        expect(normalizeCommandForDeterministic('Hey flu crea una cita para mañana', WAKE_WORDS)).toBe('crea una cita para mañana');
    });

    it('quita TODAS las apariciones de wake word (eco ASR duplicado)', () => {
        expect(normalizeCommandForDeterministic('Okay flu generame una nota okay flu genérame una nota', WAKE_WORDS)).toBe('genérame una nota');
    });

    it('colapsa el eco del verbo quedándose con la última aparición completa', () => {
        expect(normalizeCommandForDeterministic('generame una nota genérame una nota para el super', WAKE_WORDS)).toBe('genérame una nota para el super');
    });

    it('quita un fragmento "una/un" huérfano al inicio cuando hay eco sin verbo', () => {
        expect(normalizeCommandForDeterministic('Una nota para el super', WAKE_WORDS)).toBe('nota para el super');
    });

    it('deja intacto el texto sin wake word ni eco', () => {
        const text = 'agrega matemáticas el lunes a las 8';
        expect(normalizeCommandForDeterministic(text, WAKE_WORDS)).toBe(text);
    });

    it('devuelve texto vacío si la entrada está vacía', () => {
        expect(normalizeCommandForDeterministic('', WAKE_WORDS)).toBe('');
        expect(normalizeCommandForDeterministic('   ', WAKE_WORDS)).toBe('');
    });

    it('no rompe con entrada no string', () => {
        expect(normalizeCommandForDeterministic(undefined as unknown as string, WAKE_WORDS)).toBe('');
        expect(normalizeCommandForDeterministic(null as unknown as string, WAKE_WORDS)).toBe('');
    });

    it('sin wake words configuradas devuelve el texto recortado tal cual', () => {
        expect(normalizeCommandForDeterministic('  hola mundo  ', [])).toBe('hola mundo');
    });
});
