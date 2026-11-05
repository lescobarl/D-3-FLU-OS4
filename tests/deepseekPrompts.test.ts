/**
 * services/deepseek — regla de personalizacion (FASE P).
 *
 * POR QUE ESTE TEST: `src/services/deepseek.ts` esta al ~20% (311 sentencias sin
 * cubrir). `buildPersonalizationRule` decide como los rasgos/tono/nivel de
 * explicacion de una persona llegan al LLM. Es PURA (options + idioma -> texto):
 * se fija su contrato, incluido el caso por defecto (sin personalizacion = '').
 */
import { describe, expect, it } from 'vitest';
import { buildPersonalizationRule } from '../src/core/ai/personalization';
import type { AIRequestOptions } from '../src/core/ai/IAIService';

/** Opciones minimas validas (solo `apiKey` es obligatoria) + overrides. */
const opts = (over: Partial<AIRequestOptions> = {}): AIRequestOptions => ({ apiKey: '', ...over });

describe('deepseek — buildPersonalizationRule', () => {
    it('sin personalizacion devuelve cadena vacia (caso por defecto, sin cambios)', () => {
        expect(buildPersonalizationRule(opts(), false)).toBe('');
        expect(buildPersonalizationRule(opts(), true)).toBe('');
    });

    it('con rasgos vacios no añade nada', () => {
        expect(buildPersonalizationRule(opts({ traits: [] }), false)).toBe('');
    });

    it('escribe los rasgos en español', () => {
        const out = buildPersonalizationRule(opts({ traits: ['calmado', 'directo'] }), false);
        expect(out).toContain('Tus rasgos de personalidad son: calmado, directo.');
    });

    it('escribe los rasgos en ingles cuando isEnglish', () => {
        const out = buildPersonalizationRule(opts({ traits: ['calm'] }), true);
        expect(out).toContain('Your personality traits are: calm.');
    });

    it('incluye el tono', () => {
        expect(buildPersonalizationRule(opts({ tone: 'formal' }), false)).toContain('Tu tono de comunicacion es: formal.');
    });

    it('incluye el nivel de explicacion', () => {
        const out = buildPersonalizationRule(opts({ explanationLevel: 'simple' }), false);
        expect(out).toContain('Nivel de explicacion: simple.');
    });

    it('combina rasgos + tono + nivel en una sola regla', () => {
        const out = buildPersonalizationRule(
            opts({ traits: ['breve'], tone: 'cercano', explanationLevel: 'avanzado' }),
            false,
        );
        expect(out).toContain('rasgos');
        expect(out).toContain('tono');
        expect(out).toContain('Nivel de explicacion');
        expect(out.startsWith('\n\n')).toBe(true); // se anexa al prompt
    });
});
