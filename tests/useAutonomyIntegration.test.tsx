// @vitest-environment jsdom
/**
 * useAutonomyIntegration — puente motor -> UI de la autonomia.
 *
 * POR QUE ESTE TEST: `src/core/autonomy/useAutonomyIntegration.ts` estaba al 0%
 * (471 sentencias) y arranca los 5 sistemas de autonomia en CADA carga de la app.
 * Los sistemas se sustituyen por DOBLES (evita timers/red reales) y se ejercita
 * la CONDUCTA observable: arranque -> estado activo, el puente evento->notificacion,
 * las acciones de notificacion y el parado al desmontar.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ stops: { health: 0, decision: 0, opt: 0, backup: 0 } }));

vi.mock('../src/core/autonomy/healthMonitor', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/core/autonomy/healthMonitor')>();
    return {
        ...actual,
        startGlobalHealthMonitoring: () => ({
            addListener: () => {},
            start: () => {},
            stop: () => { hoisted.stops.health += 1; },
            getLastHealth: () => null,
            performHealthCheck: async () => ({}),
            getComponentHistory: () => ({ totalChecks: 0, errorRate: 0, availability: 1, avgResponseTime: 0 }),
            updateConfig: () => {},
            getConfig: () => ({}),
        }),
    };
});

vi.mock('../src/core/autonomy/autoRecovery', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/core/autonomy/autoRecovery')>();
    return { ...actual, startGlobalAutoRecovery: () => ({ setHealthMonitor: () => {}, stop: () => {} }) };
});

vi.mock('../src/core/autonomy/decisionEngine', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/core/autonomy/decisionEngine')>();
    return { ...actual, startGlobalDecisionEngine: () => ({ start: () => {}, stop: () => { hoisted.stops.decision += 1; } }) };
});

vi.mock('../src/core/autonomy/autoOptimization', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/core/autonomy/autoOptimization')>();
    return { ...actual, startGlobalAutoOptimization: () => ({ start: () => {}, stop: () => { hoisted.stops.opt += 1; } }) };
});

vi.mock('../src/core/autonomy/backupSystem', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/core/autonomy/backupSystem')>();
    return {
        ...actual,
        startGlobalBackupSystem: () => ({
            start: () => {},
            stop: () => { hoisted.stops.backup += 1; },
            getBackupStats: () => ({ totalBackups: 0, lastBackupTime: null, totalSizeMB: 0 }),
            getAvailableBackups: () => [],
        }),
    };
});

import { useAutonomyIntegration } from '../src/core/autonomy/useAutonomyIntegration';
import { emitAutonomyEvent } from '../src/core/autonomy/autonomyEvents';

describe('useAutonomyIntegration', () => {
    it('arranca los 5 sistemas y queda en estado activo', async () => {
        const { result } = renderHook(() => useAutonomyIntegration());
        await waitFor(() => expect(result.current[0].status).toBe('active'));
        expect(result.current[0].activeSystems).toEqual({
            healthMonitor: true,
            autoRecovery: true,
            decisionEngine: true,
            autoOptimization: true,
            backupSystem: true,
        });
        expect(result.current[0].notifications.some((n) => n.title.includes('autonomía activados'))).toBe(true);
    });

    it('expone las acciones publicas esperadas', async () => {
        const { result } = renderHook(() => useAutonomyIntegration());
        await waitFor(() => expect(result.current[0].status).toBe('active'));
        const actions = result.current[1];
        for (const fn of ['startAllSystems', 'stopAllSystems', 'clearNotifications', 'markNotificationAsRead', 'getSystemConfig', 'updateSystemConfig'] as const) {
            expect(typeof actions[fn]).toBe('function');
        }
    });

    it('el puente convierte eventos del bus en notificaciones y respeta su propio tipo', async () => {
        const { result } = renderHook(() => useAutonomyIntegration());
        await waitFor(() => expect(result.current[0].status).toBe('active'));
        const antes = result.current[0].notifications.length;
            act(() => {
                emitAutonomyEvent({ type: 'ai-provider-changed', level: 'info', message: 'cambio' });
            });
            expect(result.current[0].notifications.length).toBe(antes + 1);
            expect(result.current[0].notifications[0].title).toBe('Proveedor de IA cambiado');

            // su propio tipo NO debe re-alimentar el bucle
            act(() => {
                emitAutonomyEvent({ type: 'autonomy-notification', level: 'info', message: 'eco' });
            });
            expect(result.current[0].notifications.length).toBe(antes + 1);
    });

    it('clearNotifications vacia y markNotificationAsRead marca leida', async () => {
        const { result } = renderHook(() => useAutonomyIntegration());
        await waitFor(() => expect(result.current[0].status).toBe('active'));
        const id = result.current[0].notifications[0].id;
        act(() => result.current[1].markNotificationAsRead(id));
        expect(result.current[0].notifications.find((n) => n.id === id)?.read).toBe(true);
        act(() => result.current[1].clearNotifications());
        expect(result.current[0].notifications).toEqual([]);
    });

    it('al desmontar detiene los sistemas', async () => {
        const { unmount } = renderHook(() => useAutonomyIntegration());
        await waitFor(() => expect(hoisted.stops.health).toBeGreaterThanOrEqual(0));
        unmount();
        expect(hoisted.stops.health).toBeGreaterThan(0);
        expect(hoisted.stops.decision).toBeGreaterThan(0);
        expect(hoisted.stops.opt).toBeGreaterThan(0);
        expect(hoisted.stops.backup).toBeGreaterThan(0);
    });
});
