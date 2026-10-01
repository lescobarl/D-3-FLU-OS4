/**
 * decisionEngine — evaluador de factores de proveedor de IA (autonomia).
 *
 * POR QUE ESTE TEST: `src/core/autonomy/decisionEngine.ts` estaba al 0% (525
 * sentencias). `FactorEvaluator` decide, a partir de las metricas de proveedor,
 * los FACTORES (tiempo de respuesta, tasa de exito, coste) que pesan en la
 * decision de cambiar de proveedor de IA.
 *
 * HALLAZGO (documentado, no oculto): `getAllProviderMetrics()` NO usa las
 * metricas grabadas por `recordProviderMetrics`; devuelve datos de EJEMPLO
 * hardcodeados en config para openrouter/gemini (el propio fuente lo admite:
 * "Por ahora usamos datos de ejemplo"). Por eso el test fija el contrato actual
 * (factores por proveedor conocido) y no "aprende" de metricas grabadas.
 */
import { describe, expect, it } from 'vitest';
import { FactorEvaluator } from '../src/core/autonomy/decisionEngine';
import { AI_PROVIDER_IDS } from '../src/core/config/sharedConfig';

describe('decisionEngine — FactorEvaluator.evaluateAIProviderFactors', () => {
    it('sin metricas conocidas del proveedor no hay factores', () => {
        expect(new FactorEvaluator().evaluateAIProviderFactors('proveedor-inexistente')).toEqual([]);
    });

    it('produce los factores de tiempo y exito, normalizados 0-1', () => {
        const factors = new FactorEvaluator().evaluateAIProviderFactors(AI_PROVIDER_IDS.OPENROUTER);
        const names = factors.map((f) => f.name);
        expect(names).toContain('response_time');
        expect(names).toContain('success_rate');
        for (const f of factors) {
            expect(f.value).toBeGreaterThanOrEqual(0);
            expect(f.value).toBeLessThanOrEqual(1);
            expect(f.weight).toBeGreaterThan(0);
            expect(['improving', 'worsening', 'stable']).toContain(f.trend);
        }
    });

    it('gemini tambien produce factores', () => {
        const factors = new FactorEvaluator().evaluateAIProviderFactors(AI_PROVIDER_IDS.GEMINI);
        expect(factors.length).toBeGreaterThan(0);
    });

    it('grabar metricas de un proveedor no cambia los factores (stub actual)', () => {
        const ev = new FactorEvaluator();
        ev.recordProviderMetrics({
            provider: AI_PROVIDER_IDS.OPENROUTER,
            avgResponseTime: 1,
            successRate: 1,
            costPer1kTokens: 0,
            co2Emissions: 0,
            perceivedLatency: 1,
            responseQuality: 1,
            lastUpdated: Date.now(),
            requestCount: 1,
        } as never);
        const conMetricas = ev.evaluateAIProviderFactors(AI_PROVIDER_IDS.OPENROUTER);
        const sinMetricas = new FactorEvaluator().evaluateAIProviderFactors(AI_PROVIDER_IDS.OPENROUTER);
        expect(conMetricas.map((f) => f.name)).toEqual(sinMetricas.map((f) => f.name));
    });

    it('evaluateSwitchAIOptions devuelve un array', () => {
        expect(Array.isArray(new FactorEvaluator().evaluateSwitchAIOptions(AI_PROVIDER_IDS.OPENROUTER))).toBe(true);
    });
});
