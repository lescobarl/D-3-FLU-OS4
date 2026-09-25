// ============================================================
// noteParserBindings.test.ts — Guard de bindings JS (evita el
// "parseNoteIntentText is not defined" que congeló FLU)
// ============================================================
// tsc NO type-checkea los .js de voice/lib; si un import se pierde,
// el fallo solo aparece en runtime. Este guard ejecuta el resolver
// real con una nota y verifica que los bindings existen.
import { describe, it, expect } from 'vitest';
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter';
import { parseNoteIntentText, parseNoteRemoveIntentText } from '../src/voice/lib/noteIntentParser';

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
// Vaciado de notas por voz (RAÍZ). Bug real: «Okay flu bor Borra
// las notas» no se reconocía (wake desalineado + falta de "todas")
// → el turno caía al LLM y respondía un saludo genérico.
// El wake se normaliza desde FLU_CONFIG.voiceCommands.wakeWords.
// ============================================================
describe('parseNoteRemoveIntentText — vaciado de notas', () => {
    it('«Okay flu bor Borra las notas» (wake configurado + tartamudeo) → vaciar todas', () => {
        expect(parseNoteRemoveIntentText('Okay flu bor Borra las notas')).toEqual({ target: null, all: true });
    });

    it('«Borra las notas» (plural, sin «todas») → vaciar todas', () => {
        expect(parseNoteRemoveIntentText('Borra las notas')).toEqual({ target: null, all: true });
    });

    it('«borra todas las notas» → vaciar todas', () => {
        expect(parseNoteRemoveIntentText('borra todas las notas')).toEqual({ target: null, all: true });
    });

    it('singular sin destino sigue ambiguo (no vacía por error)', () => {
        expect(parseNoteRemoveIntentText('borra la nota')).toBeNull();
    });

    it('borrar UNA nota por destino sigue funcionando', () => {
        expect(parseNoteRemoveIntentText('borra la nota del super')).toEqual({ target: 'Super', all: false });
    });

    it('end-to-end: el árbitro clasifica el comando real como notes.clear', () => {
        const result = resolveDeterministicCommand('Okay flu bor Borra las notas', { language: 'es' }) as {
            matched?: boolean;
            domain?: string;
            action?: { action?: string };
        };
        expect(result?.matched).toBe(true);
        expect(result?.domain).toBe('note');
        expect(result?.action?.action).toBe('notes.clear');
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
