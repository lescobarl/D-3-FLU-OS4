// ============================================================
// noteParserBindings.test.ts — Guard de bindings JS (evita el
// "parseNoteIntentText is not defined" que congeló FLU)
// ============================================================
// tsc NO type-checkea los .js de voice/lib; si un import se pierde,
// el fallo solo aparece en runtime. Este guard ejecuta el resolver
// real con una nota y verifica que los bindings existen.
import { describe, it, expect } from 'vitest';
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter';
import { parseNoteIntentText } from '../src/voice/lib/noteIntentParser';

describe('🧪 Bindings JS (notas) — sin import rotos', () => {
    it('reconocer una nota no lanza ReferenceError y resuelve al dominio note', () => {
        const result = resolveDeterministicCommand('ok flu apunta que tengo que llamar al dentista', {
            language: 'es',
        });
        expect(result).toBeTruthy();
        expect((result as any)?.matched).toBe(true);
        expect((result as any)?.domain).toBe('note');
    });

    it('recognizeNoteIntent produce una etiqueta limpia (via resolveDeterministicCommand)', () => {
        const result = resolveDeterministicCommand('apunta en la lista super comprar conejos', {
            language: 'es',
        });
        expect((result as any)?.matched).toBe(true);
        expect((result as any)?.domain).toBe('note');
        expect((result as any)?.action?.data?.label).toBe('Super: conejos');
    });
});

// ============================================================
// Dictado natural (niños): "nota DEL súper" (contracción) + ítems
// enunciados con "y integra ...". Nace ROJO: NOTE_PARA_SUPER exige
// "de el/de la", no "del", y el limpiador no quita "integra/mañana".
// ============================================================
describe('parseNoteIntentText — dictado natural (niños)', () => {
    it('"genera una nota del súper para mañana y integra jabón cloro croquetas"', () => {
        const parsed = parseNoteIntentText(
            'genera una nota del súper para mañana y integra jabón cloro croquetas avión televisión',
        );
        expect(parsed).not.toBeNull();
        const label = String(parsed?.label || '');
        expect(label.toLowerCase()).toContain('jabon');
        expect(label.toLowerCase()).toContain('croquetas');
        expect(label.toLowerCase()).not.toContain('mañana');
        expect(label.toLowerCase()).not.toContain('manana');
        expect(label.toLowerCase()).not.toContain('integra');
    });

    it('"crea una nota de la lista del súper para mañana incluye leche pan"', () => {
        const parsed = parseNoteIntentText(
            'crea una nota de la lista del súper para mañana incluye leche pan',
        );
        expect(parsed).not.toBeNull();
        const label = String(parsed?.label || '');
        expect(label.toLowerCase()).toContain('leche');
        expect(label.toLowerCase()).not.toContain('mañana');
        expect(label.toLowerCase()).not.toContain('manana');
    });
});
