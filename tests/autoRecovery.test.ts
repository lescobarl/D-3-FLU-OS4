/**
 * autoRecovery — evaluador de reglas de recuperacion (autonomia).
 *
 * POR QUE ESTE TEST: `src/core/autonomy/autoRecovery.ts` estaba al 0% (618
 * sentencias). `ConditionEvaluator.evaluateCondition` es la logica PURA que
 * decide si una regla de recuperacion aplica (componente, estado, duracion,
 * fallos consecutivos y condiciones de metrica). Se prueba con entradas
 * sinteticas y fecha controlada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ConditionEvaluator,
    DEFAULT_RECOVERY_RULES,
    type MetricOperator,
    type RecoveryCondition,
    type RecoveryIncident,
} from '../src/core/autonomy/autoRecovery';
import type { ComponentHealth, HealthStatus } from '../src/core/autonomy/healthMonitor';

function comp(
    name: string,
    status: HealthStatus,
    metrics: Record<string, number | string | boolean> = {},
    lastCheck = Date.now(),
): ComponentHealth {
    return {
        name,
        status,
        lastCheck,
        metrics,
        message: 'test',
        thresholds: { responseTimeMax: 1000, errorRateMax: 0.2, availabilityMin: 0.9, checkInterval: 1000 },
    };
}

function incident(component: string, status: RecoveryIncident['status'] = 'active'): RecoveryIncident {
    return {
        id: `i-${component}-${status}`,
        component,
        detectedStatus: 'critical',
        detectedAt: Date.now(),
        actionsTaken: [],
        status,
        metricsAtDetection: {},
    };
}

const evalCond = new ConditionEvaluator();

describe('autoRecovery — ConditionEvaluator.evaluateCondition', () => {
    const base: RecoveryCondition = { component: 'ai-service', healthStatus: 'critical' };

    it('no casa si el componente es otro', () => {
        expect(evalCond.evaluateCondition(base, comp('network', 'critical'), [])).toBe(false);
    });

    it('no casa si el estado de salud es otro', () => {
        expect(evalCond.evaluateCondition(base, comp('ai-service', 'healthy'), [])).toBe(false);
    });

    it('casa con componente y estado correctos', () => {
        expect(evalCond.evaluateCondition(base, comp('ai-service', 'critical'), [])).toBe(true);
    });

    describe('minDurationMs', () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        it('no casa si el problema dura menos del minimo', () => {
            vi.setSystemTime(10_000);
            const c = { ...base, minDurationMs: 5_000 };
            expect(evalCond.evaluateCondition(c, comp('ai-service', 'critical', {}, 8_000), [])).toBe(false);
        });

        it('casa si el problema dura al menos el minimo', () => {
            vi.setSystemTime(10_000);
            const c = { ...base, minDurationMs: 5_000 };
            expect(evalCond.evaluateCondition(c, comp('ai-service', 'critical', {}, 4_000), [])).toBe(true);
        });
    });

    it('minConsecutiveFailures exige N incidentes ACTIVOS del componente', () => {
        const c: RecoveryCondition = { ...base, minConsecutiveFailures: 3 };
        const insuficientes = [incident('ai-service'), incident('network'), incident('ai-service', 'resolved')];
        expect(evalCond.evaluateCondition(c, comp('ai-service', 'critical'), insuficientes)).toBe(false);
        const suficientes = [incident('ai-service'), incident('ai-service'), incident('ai-service'), incident('network')];
        expect(evalCond.evaluateCondition(c, comp('ai-service', 'critical'), suficientes)).toBe(true);
    });

    it('una condicion de metrica ausente NO casa', () => {
        const c: RecoveryCondition = {
            ...base,
            metricConditions: [{ metric: 'noExiste', operator: '>', value: 0 }],
        };
        expect(evalCond.evaluateCondition(c, comp('ai-service', 'critical', {}), [])).toBe(false);
    });

    it('evalua los 6 operadores de metrica', () => {
        const run = (operator: MetricOperator, value: number | string | boolean, metric = 5): boolean =>
            evalCond.evaluateCondition(
                { ...base, metricConditions: [{ metric: 'm', operator, value }] },
                comp('ai-service', 'critical', { m: metric }),
                [],
            );
        expect(run('>', 4)).toBe(true);
        expect(run('>', 5)).toBe(false);
        expect(run('<', 6)).toBe(true);
        expect(run('>=', 5)).toBe(true);
        expect(run('<=', 5)).toBe(true);
        expect(run('===', 5)).toBe(true);
        expect(run('===', 6)).toBe(false);
        expect(run('!==', 6)).toBe(true);
    });

    it('varias condiciones de metrica DEBEN cumplirse todas', () => {
        const c: RecoveryCondition = {
            ...base,
            metricConditions: [
                { metric: 'a', operator: '>', value: 1 },
                { metric: 'b', operator: '>', value: 100 },
            ],
        };
        expect(evalCond.evaluateCondition(c, comp('ai-service', 'critical', { a: 5, b: 2 }), [])).toBe(false);
        expect(evalCond.evaluateCondition(c, comp('ai-service', 'critical', { a: 5, b: 200 }), [])).toBe(true);
    });
});

describe('autoRecovery — catalogo de reglas por defecto', () => {
    it('cada regla declara condicion (componente+estado), accion y prioridad', () => {
        const malas = DEFAULT_RECOVERY_RULES
            .map((r, i) => ({ r, i }))
            .filter(
                ({ r }) =>
                    !r.condition?.component ||
                    !r.condition?.healthStatus ||
                    !r.action ||
                    typeof r.priority !== 'number',
            )
            .map(({ r, i }) => `#${i} ${r.condition?.component ?? '?'}/${r.condition?.healthStatus ?? '?'}`);
        expect(malas, `reglas invalidas: ${malas.join(', ')}`).toEqual([]);
    });
});
