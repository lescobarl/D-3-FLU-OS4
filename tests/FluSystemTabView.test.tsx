// @vitest-environment jsdom
// ============================================================
// FluSystemTabView - vista presentacional de la pestaña Sistemas Autónomos.
// ------------------------------------------------------------
// El módulo bajo prueba es un contenedor puro: envuelve AutonomyStatusPanel
// (colaborador real, presentacional sin hooks) en su PanelFrame expandible
// dentro de FluTabPanel. Solo se sustituyen las props de estado/acciones,
// que aquí se construyen como datos de prueba; no se mockea ningún módulo.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluSystemTabView } from '../src/components/FluSystemTabView';
import type { AutonomyState, AutonomyActions, SystemHealth, RestoreResult } from '../src/core/autonomy';

const HEALTH: SystemHealth = {
    overallStatus: 'healthy',
    components: {},
    timestamp: 0,
    recommendations: [],
    aggregatedMetrics: { availability: 0.98, avgResponseTime: 120, errorRate: 0.02, uptime: 100 },
};

const RESTORE: RestoreResult = {
    success: true,
    restoredComponents: [],
    failedComponents: [],
    message: '',
    backupTimestamp: 0,
    durationMs: 0,
};

function makeState(over: Partial<AutonomyState> = {}): AutonomyState {
    return {
        status: 'active',
        activeSystems: {
            healthMonitor: true,
            autoRecovery: false,
            decisionEngine: true,
            autoOptimization: false,
            backupSystem: true,
        },
        healthMetrics: null,
        activeIncidents: [],
        recentDecisions: [],
        backupStats: { totalBackups: 0, lastBackupTime: null, totalSizeMB: 0 },
        notifications: [],
        ...over,
    };
}

function makeActions(over: Partial<AutonomyActions> = {}): AutonomyActions {
    return {
        startAllSystems: vi.fn(),
        stopAllSystems: vi.fn(),
        createManualBackup: vi.fn(),
        restoreFromLatestBackup: vi.fn(async (): Promise<RestoreResult> => RESTORE),
        forceHealthCheck: vi.fn(async (): Promise<SystemHealth> => HEALTH),
        runManualOptimization: vi.fn(),
        clearNotifications: vi.fn(),
        markNotificationAsRead: vi.fn(),
        getSystemConfig: vi.fn(() => ({})),
        updateSystemConfig: vi.fn(),
        ...over,
    };
}

const mount = (
    over: Partial<{
        activeTab: string;
        expandedFrameId: string;
        onToggleExpand: (frameId: string) => void;
        state: AutonomyState;
        actions: AutonomyActions;
    }> = {},
) => {
    const onToggleExpand = vi.fn();
    const props = {
        activeTab: 'system',
        expandedFrameId: '',
        onToggleExpand,
        state: makeState(),
        actions: makeActions(),
        ...over,
    };
    const view = render(<FluSystemTabView {...props} />);
    return { ...props, onToggleExpand, ...view };
};

const tabpanel = (container: HTMLElement) => container.querySelector('#flu-tabpanel-system') as HTMLElement;
const frame = (container: HTMLElement) => container.querySelector('[data-frame-id="autonomy"]') as HTMLElement;

beforeEach(() => {
    vi.clearAllMocks();
});

describe('FluSystemTabView - shell (tab y frame)', () => {
    it('usa el id de panel de la pestaña system', () => {
        const { container } = mount();

        expect(tabpanel(container).id).toBe('flu-tabpanel-system');
        expect(tabpanel(container).getAttribute('role')).toBe('tabpanel');
    });

    it('queda visible solo cuando system es la pestaña activa', () => {
        const activa = mount({ activeTab: 'system' });
        expect(tabpanel(activa.container).hidden).toBe(false);
        activa.unmount();

        const otra = mount({ activeTab: 'workspace' });
        expect(tabpanel(otra.container).hidden).toBe(true);
    });

    it('el frame de autonomía lleva id, título y clase propios', () => {
        const { container } = mount();

        expect(frame(container)).toBeTruthy();
        expect(frame(container).className).toContain('panel-frame--autonomy');
        expect(frame(container).querySelector('.panel-frame__title')?.textContent).toBe('Sistemas Autónomos');
    });

    it('el toggle avisa onToggleExpand("autonomy")', () => {
        const { container, onToggleExpand } = mount();

        fireEvent.click(frame(container).querySelector('.panel-frame__toggle') as HTMLElement);

        expect(onToggleExpand).toHaveBeenCalledWith('autonomy');
    });

    it('expandedFrameId="autonomy" marca el frame expandido', () => {
        const expandido = mount({ expandedFrameId: 'autonomy' });
        expect(frame(expandido.container).className).toContain('panel-frame--expanded');
        expandido.unmount();

        const plegado = mount({ expandedFrameId: '' });
        expect(frame(plegado.container).className).not.toContain('panel-frame--expanded');
    });
});

describe('FluSystemTabView - estado en AutonomyStatusPanel', () => {
    it('traduce el estado general a texto visible', () => {
        const activo = mount({ state: makeState({ status: 'active' }) });
        expect(screen.getByText('Activo')).toBeTruthy();
        activo.unmount();

        mount({ state: makeState({ status: 'degraded' }) });
        expect(screen.getByText('Rendimiento reducido')).toBeTruthy();
    });

    it('pinta un indicador por sistema con su estado activo/inactivo', () => {
        const { container } = mount();

        const nombres = Array.from(container.querySelectorAll('.flu-autonomy-panel__system-name')).map(
            (el) => el.textContent,
        );
        expect(nombres).toEqual([
            'Health Monitor',
            'Auto Recovery',
            'Decision Engine',
            'Auto Optimization',
            'Backup System',
        ]);

        const indicadores = container.querySelectorAll('.flu-autonomy-panel__system-status');
        expect(indicadores[0].className).toContain('active');
        expect(indicadores[0].textContent).toBe('●');
        expect(indicadores[1].className).toContain('inactive');
        expect(indicadores[1].textContent).toBe('○');
    });

    it('los botones de acción delegan en las acciones recibidas', () => {
        const forceHealthCheck = vi.fn();
        const createManualBackup = vi.fn();
        const runManualOptimization = vi.fn();
        mount({ actions: makeActions({ forceHealthCheck, createManualBackup, runManualOptimization }) });

        fireEvent.click(screen.getByRole('button', { name: 'Verificar Salud' }));
        fireEvent.click(screen.getByRole('button', { name: 'Crear Backup' }));
        fireEvent.click(screen.getByRole('button', { name: 'Optimizar' }));

        expect(forceHealthCheck).toHaveBeenCalledTimes(1);
        expect(createManualBackup).toHaveBeenCalledTimes(1);
        expect(runManualOptimization).toHaveBeenCalledTimes(1);
    });
});

describe('FluSystemTabView - salud y notificaciones', () => {
    it('con healthMetrics muestra la salud agregada redondeada', () => {
        mount({ state: makeState({ healthMetrics: HEALTH }) });

        expect(screen.getByText('Salud del Sistema')).toBeTruthy();
        expect(screen.getByText('98%')).toBeTruthy();
        expect(screen.getByText('120ms')).toBeTruthy();
        expect(screen.getByText('2%')).toBeTruthy();
    });

    it('sin healthMetrics no muestra la sección de salud', () => {
        mount({ state: makeState({ healthMetrics: null }) });

        expect(screen.queryByText('Salud del Sistema')).toBeNull();
    });

    it('cuenta las no leídas y marca como leída al pulsar una notificación', () => {
        const markNotificationAsRead = vi.fn();
        const notifications = [
            { id: 'n1', type: 'info' as const, title: 'Uno', message: 'm1', timestamp: 0, read: false },
            { id: 'n2', type: 'warning' as const, title: 'Dos', message: 'm2', timestamp: 0, read: true },
        ];
        const { container } = mount({
            state: makeState({ notifications }),
            actions: makeActions({ markNotificationAsRead }),
        });

        expect(screen.getByText('Notificaciones (1)')).toBeTruthy();
        const items = container.querySelectorAll('.flu-autonomy-panel__notification');
        expect(items).toHaveLength(2);

        fireEvent.click(items[0]);
        expect(markNotificationAsRead).toHaveBeenCalledWith('n1');
    });
});
