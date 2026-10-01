/**
 * healthMonitor — monitoreo de salud del sistema (autonomia).
 *
 * POR QUE ESTE TEST: `src/core/autonomy/healthMonitor.ts` estaba al 0% (673
 * sentencias) pese a arrancar en CADA carga de la app (App llama a
 * startAllSystems). Aqui se fija la CONDUCTA: los umbrales por componente, la
 * agregacion de estado general y el ciclo de performHealthCheck, con
 * verificadores INYECTADOS (nunca las APIs reales).
 */
import { describe, expect, it } from 'vitest';
import {
    calculateOverallStatus,
    determineComponentStatus,
    HealthMonitor,
    type ComponentCheckers,
    type ComponentHealth,
    type ComponentThresholds,
    type HealthStatus,
} from '../src/core/autonomy/healthMonitor';

const TH: ComponentThresholds = { responseTimeMax: 1000, errorRateMax: 0.2, availabilityMin: 0.9, checkInterval: 1000 };

function health(name: string, status: HealthStatus, message = 'ok'): ComponentHealth {
    return { name, status, lastCheck: Date.now(), metrics: {}, message, thresholds: TH };
}

describe('healthMonitor — determineComponentStatus (umbrales por componente)', () => {
    it('un error marca critical', () => {
        expect(determineComponentStatus(10, true, TH)).toBe('critical');
    });
    it('respuesta > 1.5x el maximo es critical', () => {
        expect(determineComponentStatus(1600, false, TH)).toBe('critical');
    });
    it('respuesta por encima del maximo (pero no 1.5x) es unhealthy', () => {
        expect(determineComponentStatus(1200, false, TH)).toBe('unhealthy');
    });
    it('respuesta dentro del maximo es healthy', () => {
        expect(determineComponentStatus(500, false, TH)).toBe('healthy');
        expect(determineComponentStatus(1000, false, TH)).toBe('healthy'); // borde exacto
    });
});

describe('healthMonitor — calculateOverallStatus (agregacion)', () => {
    it('sin componentes es healthy (no hay nada roto)', () => {
        expect(calculateOverallStatus([])).toBe('healthy');
    });
    it('todos critical -> critical', () => {
        expect(calculateOverallStatus([health('a', 'critical'), health('b', 'critical')])).toBe('critical');
    });
    it('todos healthy -> healthy', () => {
        expect(calculateOverallStatus([health('a', 'healthy'), health('b', 'healthy')])).toBe('healthy');
    });
    it('mezcla healthy + critical (0.5) -> unhealthy', () => {
        expect(calculateOverallStatus([health('a', 'healthy'), health('b', 'critical')])).toBe('unhealthy');
    });
});

describe('healthMonitor — performHealthCheck con verificadores inyectados', () => {
    const makeMonitor = (components: string[], checkers: ComponentCheckers) =>
        HealthMonitor.create(
            { monitoredComponents: components, monitoringInterval: 1_000_000 },
            { componentCheckers: checkers },
        );

    it('agrega el estado, recomienda los sanos no, y registra metricas', async () => {
        const monitor = makeMonitor(['ok', 'malo'], {
            ok: async () => health('ok', 'healthy'),
            malo: async () => health('malo', 'unhealthy', 'componente malo'),
        });
        const r = await monitor.performHealthCheck();

        // healthy(1) + unhealthy(0.3) -> 0.65: ni sano ni roto. El peso exacto lo fija el motor.
        expect(['degraded', 'unhealthy']).toContain(r.overallStatus);
        expect(Object.keys(r.components).sort()).toEqual(['malo', 'ok']);
        expect(r.recommendations.some((x) => x.includes('malo'))).toBe(true);
        expect(r.recommendations.some((x) => x.includes('ok'))).toBe(false);

        const h = monitor.getComponentHistory('malo');
        expect(h.totalChecks).toBe(1);
        expect(h.errorRate).toBe(1); // unhealthy cuenta como error
        expect(monitor.getComponentHistory('ok').errorRate).toBe(0);
    });

    it('un verificador que LANZA marca el componente critical (no rompe el bucle)', async () => {
        const monitor = makeMonitor(['boom', 'ok'], {
            boom: async () => { throw new Error('explota'); },
            ok: async () => health('ok', 'healthy'),
        });
        const r = await monitor.performHealthCheck();
        expect(r.components.boom.status).toBe('critical');
        expect(r.recommendations.some((x) => x.includes('boom'))).toBe(true);
        expect(r.components.ok.status).toBe('healthy'); // el otro sigue
    });

    it('notifica a los listeners y getLastHealth devuelve el ultimo', async () => {
        const monitor = makeMonitor(['ok'], { ok: async () => health('ok', 'healthy') });
        const seen: string[] = [];
        const listener = (h: { overallStatus: string }) => seen.push(h.overallStatus);
        monitor.addListener(listener);
        const r = await monitor.performHealthCheck();
        expect(seen).toEqual([r.overallStatus]);
        expect(monitor.getLastHealth()).toBe(r);

        monitor.removeListener(listener);
        await monitor.performHealthCheck();
        expect(seen.length).toBe(1); // ya no recibe
    });

    it('getConfig devuelve una COPIA (mutarla no cambia la config)', () => {
        const monitor = makeMonitor(['ok'], { ok: async () => health('ok', 'healthy') });
        const c = monitor.getConfig();
        c.monitoredComponents.push('intruso');
        expect(monitor.getConfig().monitoredComponents).toEqual(['ok']);
    });

    it('clearHistory deja el historial en cero', async () => {
        const monitor = makeMonitor(['ok'], { ok: async () => health('ok', 'healthy') });
        await monitor.performHealthCheck();
        expect(monitor.getComponentHistory('ok').totalChecks).toBe(1);
        monitor.clearHistory();
        expect(monitor.getComponentHistory('ok').totalChecks).toBe(0);
    });
});
