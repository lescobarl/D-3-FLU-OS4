/**
 * autoOptimization — optimizador de parametros (autonomia).
 *
 * POR QUE ESTE TEST: `src/core/autonomy/autoOptimization.ts` estaba al 0% (595
 * sentencias). Se fija la CONDUCTA observable de ParameterOptimizer: el catalogo
 * de parametros es valido, sin muestras suficientes no se decide nada, y aplicar
 * una optimizacion mueve el valor, marca `applied` y registra historial.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    OPTIMIZABLE_PARAMETERS,
    ParameterOptimizer,
    type OptimizableParameter,
    type OptimizationResult,
} from '../src/core/autonomy/autoOptimization';

const PARAMS = Object.keys(OPTIMIZABLE_PARAMETERS) as OptimizableParameter[];

function metrics(over: Record<string, number> = {}): Record<string, number> {
    return {
        speechRecognitionSuccessRate: 0.9,
        aiResponseTime: 800,
        timeoutRate: 0.02,
        memoryUsage: 300,
        actualUIRefreshRate: 60,
        userFeedback: 0.8,
        systemStability: 0.95,
        timestamp: Date.now(),
        ...over,
    };
}

describe('autoOptimization — catalogo OPTIMIZABLE_PARAMETERS', () => {
    it('cada parametro tiene min<max, step>0, unidad y current dentro de rango', () => {
        const malos = PARAMS.filter((p) => {
            const v = OPTIMIZABLE_PARAMETERS[p];
            return (
                v.min >= v.max ||
                v.step <= 0 ||
                !v.unit ||
                v.current < v.min ||
                v.current > v.max
            );
        });
        expect(malos, `parametros invalidos: ${malos.join(', ')}`).toEqual([]);
    });
});

describe('autoOptimization — ParameterOptimizer', () => {
    it('sin muestras suficientes no decide nada (null)', () => {
        const opt = new ParameterOptimizer();
        expect(opt.evaluateParameter('ai_request_timeout')).toBeNull();
    });

    it('con muestras suficientes devuelve una propuesta bien formada (dentro de rango)', () => {
        const opt = new ParameterOptimizer();
        for (let i = 0; i < 60; i++) opt.recordMetrics(metrics() as never);
        const def = OPTIMIZABLE_PARAMETERS['ai_request_timeout'];
        const r = opt.evaluateParameter('ai_request_timeout');
        expect(r).not.toBeNull();
        if (r) {
            expect(r.oldValue).toBe(def.current);
            expect(r.newValue).toBeGreaterThanOrEqual(def.min);
            expect(r.newValue).toBeLessThanOrEqual(def.max);
            expect(r.applied).toBe(false);
            expect(r.expectedImprovement).toBeGreaterThan(0);
            expect(r.justification.length).toBeGreaterThan(0);
        }
    });

    describe('applyOptimization', () => {
        const PARAM: OptimizableParameter = 'ai_request_timeout';
        let saved: number;
        beforeEach(() => {
            saved = OPTIMIZABLE_PARAMETERS[PARAM].current;
            vi.useFakeTimers(); // evita la evaluacion diferida programada
        });
        afterEach(() => {
            vi.useRealTimers();
            OPTIMIZABLE_PARAMETERS[PARAM].current = saved;
        });

        it('mueve el valor, marca applied y registra historial', () => {
            const opt = new ParameterOptimizer();
            const r: OptimizationResult = {
                parameter: PARAM,
                oldValue: saved,
                newValue: saved + 500,
                expectedImprovement: 0.1,
                affectedMetrics: [],
                justification: 'test',
                timestamp: Date.now(),
                applied: false,
            };
            opt.applyOptimization(r);
            expect(OPTIMIZABLE_PARAMETERS[PARAM].current).toBe(saved + 500);
            expect(r.applied).toBe(true);
            expect(opt.getOptimizationHistory()).toHaveLength(1);
            expect(opt.getParameterValue(PARAM)).toBe(saved + 500);
        });
    });
});
