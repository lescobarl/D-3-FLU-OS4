// @vitest-environment jsdom
// ============================================================
// autonomyStatusPanel.test.tsx - Panel de estado de autonomia
// ------------------------------------------------------------
// Componente PRESENTACIONAL puro: recibe `state` y `actions` por
// props, no toca stores ni red (importa solo tipos). Se prueban
// las reglas que importan: color + texto por estado global, el
// punto activo/inactivo de cada sistema y su mapeo a cada flag,
// la seccion de salud SOLO cuando hay metricas (con su redondeo y
// su fallback a 0) y el cableado de botones y notificaciones a las
// actions recibidas.
// ============================================================
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import { AutonomyStatusPanel } from '../src/core/autonomy/AutonomyStatusPanel';
import type {
    AutonomyState,
    AutonomyActions,
} from '../src/core/autonomy/useAutonomyIntegration';

function makeState(over: Record<string, unknown> = {}): AutonomyState {
    return {
        status: 'active',
        activeSystems: {
            healthMonitor: true,
            autoRecovery: true,
            decisionEngine: true,
            autoOptimization: true,
            backupSystem: true,
        },
        healthMetrics: null,
        activeIncidents: [],
        recentDecisions: [],
        backupStats: { totalBackups: 0, lastBackupTime: null, totalSizeMB: 0 },
        notifications: [],
        ...over,
    } as unknown as AutonomyState;
}

function makeActions(): AutonomyActions {
    return {
        startAllSystems: vi.fn(),
        stopAllSystems: vi.fn(),
        createManualBackup: vi.fn(),
        restoreFromLatestBackup: vi.fn(),
        forceHealthCheck: vi.fn(),
        runManualOptimization: vi.fn(),
        clearNotifications: vi.fn(),
        markNotificationAsRead: vi.fn(),
        getSystemConfig: vi.fn(),
        updateSystemConfig: vi.fn(),
    } as unknown as AutonomyActions;
}

// Normaliza un color hex igual que lo hace jsdom (rgb vs hex).
function normalizeColor(hex: string): string {
    const probe = document.createElement('span');
    probe.style.color = hex;
    return probe.style.color;
}

const statusNode = (container: HTMLElement) =>
    container.querySelector('.flu-autonomy-panel__status') as HTMLElement;

const systemRows = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.flu-autonomy-panel__system')).map((row) => ({
        name: row.querySelector('.flu-autonomy-panel__system-name')!.textContent,
        status: row.querySelector('.flu-autonomy-panel__system-status') as HTMLElement,
    }));

const DOTS = { on: '\u25cf', off: '\u25cb' };

// ------------------------------------------------------------
// Bloque A: estado global -> color y texto
// ------------------------------------------------------------
describe('AutonomyStatusPanel - estado global (color y texto)', () => {
    it('status active muestra "Activo" en verde', () => {
        const { container } = render(
            <AutonomyStatusPanel state={makeState({ status: 'active' })} actions={makeActions()} />,
        );

        const node = statusNode(container);
        expect(node.textContent).toBe('Activo');
        expect(node.style.color).toBe(normalizeColor('#22c55e'));
    });

    it('status degraded muestra "Rendimiento reducido" en ambar', () => {
        const { container } = render(
            <AutonomyStatusPanel state={makeState({ status: 'degraded' })} actions={makeActions()} />,
        );

        const node = statusNode(container);
        expect(node.textContent).toBe('Rendimiento reducido');
        expect(node.style.color).toBe(normalizeColor('#f59e0b'));
    });

    it('status critical muestra "Critico" (con tilde) en rojo', () => {
        const { container } = render(
            <AutonomyStatusPanel state={makeState({ status: 'critical' })} actions={makeActions()} />,
        );

        const node = statusNode(container);
        expect(node.textContent).toBe('Cr\u00edtico');
        expect(node.style.color).toBe(normalizeColor('#ef4444'));
    });

    it('status disabled y un status desconocido comparten gris pero distinto texto', () => {
        const disabled = render(
            <AutonomyStatusPanel state={makeState({ status: 'disabled' })} actions={makeActions()} />,
        );
        expect(statusNode(disabled.container).textContent).toBe('Desactivado');
        expect(statusNode(disabled.container).style.color).toBe(normalizeColor('#6b7280'));
        disabled.unmount();

        const unknown = render(
            <AutonomyStatusPanel state={makeState({ status: 'lo-que-sea' })} actions={makeActions()} />,
        );
        expect(statusNode(unknown.container).textContent).toBe('Desconocido');
        expect(statusNode(unknown.container).style.color).toBe(normalizeColor('#6b7280'));
    });

    it('status initializing muestra "Inicializando..."', () => {
        const { container } = render(
            <AutonomyStatusPanel state={makeState({ status: 'initializing' })} actions={makeActions()} />,
        );

        expect(statusNode(container).textContent).toBe('Inicializando...');
    });
});

// ------------------------------------------------------------
// Bloque B: sistemas activos -> punto y clase
// ------------------------------------------------------------
describe('AutonomyStatusPanel - sistemas activos', () => {
    it('con todos los sistemas activos pinta 5 puntos llenos y clase active', () => {
        const { container } = render(<AutonomyStatusPanel state={makeState()} actions={makeActions()} />);

        const rows = systemRows(container);
        expect(rows).toHaveLength(5);
        for (const row of rows) {
            expect(row.status.textContent).toBe(DOTS.on);
            expect(row.status.className).toContain('active');
        }
    });

    it('cada flag se mapea a SU fila (mezcla de activos e inactivos)', () => {
        const { container } = render(
            <AutonomyStatusPanel
                state={makeState({
                    activeSystems: {
                        healthMonitor: false,
                        autoRecovery: true,
                        decisionEngine: false,
                        autoOptimization: true,
                        backupSystem: false,
                    },
                })}
                actions={makeActions()}
            />,
        );

        const byName = Object.fromEntries(systemRows(container).map((r) => [r.name, r.status]));

        expect(byName['Health Monitor'].textContent).toBe(DOTS.off);
        expect(byName['Health Monitor'].className).toContain('inactive');
        expect(byName['Auto Recovery'].textContent).toBe(DOTS.on);
        expect(byName['Auto Recovery'].className).toContain('active');
        expect(byName['Decision Engine'].textContent).toBe(DOTS.off);
        expect(byName['Auto Optimization'].textContent).toBe(DOTS.on);
        expect(byName['Backup System'].textContent).toBe(DOTS.off);
    });
});

// ------------------------------------------------------------
// Bloque C: metricas de salud (condicional + redondeo)
// ------------------------------------------------------------
describe('AutonomyStatusPanel - metricas de salud', () => {
    it('sin healthMetrics no renderiza la seccion de salud', () => {
        const { container } = render(
            <AutonomyStatusPanel state={makeState({ healthMetrics: null })} actions={makeActions()} />,
        );

        expect(container.querySelector('.flu-autonomy-panel__health')).toBeNull();
    });

    it('con healthMetrics formatea disponibilidad/tiempo/error con Math.round', () => {
        const { container } = render(
            <AutonomyStatusPanel
                state={makeState({
                    healthMetrics: {
                        aggregatedMetrics: { availability: 0.987, avgResponseTime: 123.6, errorRate: 0.012 },
                    },
                })}
                actions={makeActions()}
            />,
        );

        const metrics = Array.from(
            container.querySelectorAll('.flu-autonomy-panel__health-metric'),
        ).map((node) => node.textContent);

        expect(metrics).toEqual([
            'Disponibilidad:99%',
            'Tiempo de respuesta:124ms',
            'Tasa de error:1%',
        ]);
    });

    it('metricas ausentes caen a 0 (no NaN)', () => {
        const { container } = render(
            <AutonomyStatusPanel
                state={makeState({ healthMetrics: { aggregatedMetrics: {} } })}
                actions={makeActions()}
            />,
        );

        const metrics = Array.from(
            container.querySelectorAll('.flu-autonomy-panel__health-metric'),
        ).map((node) => node.textContent);

        expect(metrics).toEqual(['Disponibilidad:0%', 'Tiempo de respuesta:0ms', 'Tasa de error:0%']);
    });
});

// ------------------------------------------------------------
// Bloque D: acciones (botones y notificaciones)
// ------------------------------------------------------------
describe('AutonomyStatusPanel - cableado de acciones', () => {
    it('los tres botones llaman a su action y solo a la suya', () => {
        const actions = makeActions();
        const { container } = render(<AutonomyStatusPanel state={makeState()} actions={actions} />);

        const buttons = Array.from(
            container.querySelectorAll('.flu-autonomy-panel__actions button'),
        ) as HTMLButtonElement[];
        expect(buttons.map((b) => b.textContent)).toEqual([
            'Verificar Salud',
            'Crear Backup',
            'Optimizar',
        ]);

        fireEvent.click(buttons[0]);
        fireEvent.click(buttons[1]);
        fireEvent.click(buttons[2]);

        expect(actions.forceHealthCheck).toHaveBeenCalledTimes(1);
        expect(actions.createManualBackup).toHaveBeenCalledTimes(1);
        expect(actions.runManualOptimization).toHaveBeenCalledTimes(1);
        expect(actions.clearNotifications).not.toHaveBeenCalled();
        expect(actions.startAllSystems).not.toHaveBeenCalled();
    });

    it('al pulsar una notificacion la marca como leida con su id', () => {
        const actions = makeActions();
        const { container } = render(
            <AutonomyStatusPanel
                state={makeState({
                    notifications: [
                        { id: 'n-1', type: 'info', title: 'Aviso', message: 'm', timestamp: 1, read: false },
                    ],
                })}
                actions={actions}
            />,
        );

        fireEvent.click(container.querySelector('.flu-autonomy-panel__notification')!);

        expect(actions.markNotificationAsRead).toHaveBeenCalledTimes(1);
        expect(actions.markNotificationAsRead).toHaveBeenCalledWith('n-1');
    });
});

// ------------------------------------------------------------
// Bloque E: notificaciones (condicional, slice y contador)
// ------------------------------------------------------------
describe('AutonomyStatusPanel - notificaciones', () => {
    it('sin notificaciones no hay seccion; con 4 pinta solo 3 y cuenta las NO leidas de todas', () => {
        const empty = render(
            <AutonomyStatusPanel state={makeState({ notifications: [] })} actions={makeActions()} />,
        );
        expect(empty.container.querySelector('.flu-autonomy-panel__notifications')).toBeNull();
        empty.unmount();

        const { container } = render(
            <AutonomyStatusPanel
                state={makeState({
                    notifications: [
                        { id: 'n1', type: 'info', title: 'Uno', message: 'm1', timestamp: 1, read: false },
                        { id: 'n2', type: 'info', title: 'Dos', message: 'm2', timestamp: 2, read: true },
                        { id: 'n3', type: 'warning', title: 'Tres', message: 'm3', timestamp: 3, read: true },
                        { id: 'n4', type: 'error', title: 'Cuatro', message: 'm4', timestamp: 4, read: false },
                    ],
                })}
                actions={makeActions()}
            />,
        );

        const items = container.querySelectorAll('.flu-autonomy-panel__notification');
        expect(items).toHaveLength(3);
        const titles = Array.from(items).map((n) => n.textContent);
        expect(titles).toEqual(['Uno' + 'm1', 'Dos' + 'm2', 'Tres' + 'm3']);
        expect(container.querySelector('.flu-autonomy-panel__notifications-title')!.textContent).toBe(
            'Notificaciones (2)',
        );
    });

    it('la notificacion leida lleva clase read y su tipo va en la clase', () => {
        const { container } = render(
            <AutonomyStatusPanel
                state={makeState({
                    notifications: [
                        { id: 'a', type: 'error', title: 'A', message: 'ma', timestamp: 1, read: true },
                        { id: 'b', type: 'success', title: 'B', message: 'mb', timestamp: 2, read: false },
                    ],
                })}
                actions={makeActions()}
            />,
        );

        const read = container.querySelector('[class*="--error"]') as HTMLElement;
        const unread = container.querySelector('[class*="--success"]') as HTMLElement;

        expect(read.className).toContain('flu-autonomy-panel__notification--error');
        expect(read.className).toContain('read');
        expect(unread.className).toContain('flu-autonomy-panel__notification--success');
        expect(unread.className).not.toContain('read');
    });
});
