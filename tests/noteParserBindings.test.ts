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
// enunciados con "y integra ...". Spec vigente: el TÍTULO es corto
// ("Super"/"Nota") y los artículos van al BODY (no al título).
// El guard exige que el ítem quede capturado (label+body) y que el
// relleno ("mañana", "integra", "notas") NO se cuele.
// ============================================================
describe('parseNoteIntentText — dictado natural (niños)', () => {
    const combined = (parsed: { label?: string; body?: string } | null) =>
        `${parsed?.label || ''} ${parsed?.body || ''}`.toLowerCase();

    it('"crea una lista para el súper en las notas que traiga …" → captura los ítems', () => {
        const parsed = parseNoteIntentText(
            'crea una lista para el súper en las notas que traiga jabón pan huevo y queso',
        );
        expect(parsed).not.toBeNull();
        const text = combined(parsed);
        expect(text).toContain('jabon');
        expect(text).toContain('queso');
        expect(text).not.toContain('notas');
    });

    it('"genera una nota del súper para mañana y integra jabón cloro croquetas"', () => {
        const parsed = parseNoteIntentText(
            'genera una nota del súper para mañana y integra jabón cloro croquetas avión televisión',
        );
        expect(parsed).not.toBeNull();
        const text = combined(parsed);
        expect(text).toContain('jabon');
        expect(text).toContain('croquetas');
        expect(text).not.toContain('mañana');
        expect(text).not.toContain('manana');
        expect(text).not.toContain('integra');
    });

    it('"crea una nota de la lista del súper para mañana incluye leche pan"', () => {
        const parsed = parseNoteIntentText(
            'crea una nota de la lista del súper para mañana incluye leche pan',
        );
        expect(parsed).not.toBeNull();
        const text = combined(parsed);
        expect(text).toContain('leche');
        expect(text).not.toContain('mañana');
        expect(text).not.toContain('manana');
    });
});
