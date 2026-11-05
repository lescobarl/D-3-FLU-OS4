// @vitest-environment jsdom
// ============================================================
// LogPanel - panel de logs del avatar con toggle ON/OFF (0%).
// ------------------------------------------------------------
// Se sustituye la frontera: el store Zustand del avatar por vi.hoisted.
// El modulo bajo prueba NO se mockea. Se cubren: cabecera y toggle
// (estado, clase activa, title y accion), boton de limpiar condicionado,
// estado vacio segun logsEnabled, render de entradas (tiempo, tipo con
// color, accion y detalle), color por defecto de tipos desconocidos y
// auto-scroll al ultimo log.
// ============================================================
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface LogEntry {
    timestamp: string;
    type: string;
    action: string;
    detail: string;
}

const scroll = vi.hoisted(() => ({ fn: vi.fn() }));

const store = vi.hoisted(() => {
    const state = {
        logsEnabled: false,
        logs: [] as Array<{ timestamp: string; type: string; action: string; detail: string }>,
        toggleLogs: vi.fn(),
        clearLogs: vi.fn(),
    };
    return { state };
});

vi.mock('../src/avatar/store/bunnyStore', () => ({
    useBunnyStore: (selector: (s: typeof store.state) => unknown) => selector(store.state),
}));

import LogPanel from '../src/avatar/components/LogPanel';

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
    timestamp: '2026-10-02T05:44:00.123Z',
    type: 'signal',
    action: 'SET',
    detail: 'senal WAVE',
    ...over,
});

const toggleBtn = (container: HTMLElement) =>
    container.querySelector('.btn-log-toggle') as HTMLButtonElement;

const clearBtn = (container: HTMLElement) =>
    container.querySelector('.btn-clear-logs') as HTMLButtonElement | null;

beforeEach(() => {
    Element.prototype.scrollIntoView = scroll.fn as unknown as typeof Element.prototype.scrollIntoView;
    scroll.fn.mockClear();
    store.state.logsEnabled = false;
    store.state.logs = [];
    store.state.toggleLogs.mockClear();
    store.state.clearLogs.mockClear();
});

// ------------------------------------------------------------
// Bloque A: cabecera y toggle
// ------------------------------------------------------------
describe('LogPanel - cabecera y toggle', () => {
    it('pinta el titulo del panel', () => {
        render(<LogPanel />);

        expect(screen.getByText('LOGS')).toBeTruthy();
    });

    it('desactivado muestra LOGS OFF y el clic llama a toggleLogs', () => {
        const { container } = render(<LogPanel />);

        const btn = toggleBtn(container);
        expect(btn.textContent).toContain('LOGS OFF');
        expect(btn.className).not.toContain('active');
        expect(btn.getAttribute('title')).toBe('Activar logs');

        fireEvent.click(btn);
        expect(store.state.toggleLogs).toHaveBeenCalledTimes(1);
    });

    it('activado muestra LOGS ON, la clase active y title de desactivar', () => {
        store.state.logsEnabled = true;
        const { container } = render(<LogPanel />);

        const btn = toggleBtn(container);
        expect(btn.textContent).toContain('LOGS ON');
        expect(btn.className).toContain('active');
        expect(btn.getAttribute('title')).toBe('Desactivar logs');

        fireEvent.click(btn);
        expect(store.state.toggleLogs).toHaveBeenCalledTimes(1);
    });
});

// ------------------------------------------------------------
// Bloque B: boton de limpiar
// ------------------------------------------------------------
describe('LogPanel - boton de limpiar', () => {
    it('sin logs no aparece el boton de limpiar', () => {
        const { container } = render(<LogPanel />);

        expect(clearBtn(container)).toBeNull();
    });

    it('con logs aparece y el clic llama a clearLogs', () => {
        store.state.logs = [entry()];
        const { container } = render(<LogPanel />);

        const btn = clearBtn(container);
        expect(btn).toBeTruthy();
        fireEvent.click(btn as HTMLButtonElement);
        expect(store.state.clearLogs).toHaveBeenCalledTimes(1);
    });
});

// ------------------------------------------------------------
// Bloque C: estado vacio
// ------------------------------------------------------------
describe('LogPanel - estado vacio', () => {
    it('desactivado sin logs invita a activar el toggle', () => {
        render(<LogPanel />);

        expect(screen.getByText(/desactivados/)).toBeTruthy();
    });

    it('activado sin logs muestra que espera eventos', () => {
        store.state.logsEnabled = true;
        render(<LogPanel />);

        expect(screen.getByText('Esperando eventos...')).toBeTruthy();
    });
});

// ------------------------------------------------------------
// Bloque D: lista de entradas y auto-scroll
// ------------------------------------------------------------
describe('LogPanel - lista de entradas', () => {
    it('pinta una entrada por log con su accion y detalle', () => {
        store.state.logs = [entry(), entry({ type: 'animation', action: 'PLAY', detail: 'Dance' })];
        const { container } = render(<LogPanel />);

        expect(container.querySelectorAll('.log-entry')).toHaveLength(2);
        expect(screen.getByText('SET')).toBeTruthy();
        expect(screen.getByText('Dance')).toBeTruthy();
    });

    it('usa el color del tipo conocido en la etiqueta y el color', () => {
        store.state.logs = [entry({ type: 'signal' })];
        const { container } = render(<LogPanel />);

        const tipo = container.querySelector('.log-type') as HTMLElement;
        expect(tipo.textContent).toBe('[SIGNAL]');
        expect(tipo.style.color).toBe('rgb(255, 107, 107)');
    });

    it('un tipo desconocido cae al color por defecto', () => {
        store.state.logs = [entry({ type: 'raro' })];
        const { container } = render(<LogPanel />);

        const tipo = container.querySelector('.log-type') as HTMLElement;
        expect(tipo.textContent).toBe('[RARO]');
        expect(tipo.style.color).toBe('rgb(255, 255, 255)');
    });

    it('recorta el timestamp ISO a HH:MM:SS y respeta uno sin separador', () => {
        store.state.logs = [
            entry({ timestamp: '2026-10-02T05:44:00.123Z' }),
            entry({ timestamp: 'sin-formato', action: 'RAW', detail: 'crudo' }),
        ];
        render(<LogPanel />);

        expect(screen.getByText('05:44:00')).toBeTruthy();
        expect(screen.getByText('sin-formato')).toBeTruthy();
    });

    it('hace auto-scroll al anadir un log nuevo', () => {
        store.state.logs = [entry()];
        const { container, rerender } = render(<LogPanel />);
        expect(scroll.fn).toHaveBeenCalled();
        const before = scroll.fn.mock.calls.length;

        store.state.logs = [entry(), entry({ type: 'state', action: 'TRANSITION', detail: 'IDLE' })];
        rerender(<LogPanel />);

        expect(container.querySelectorAll('.log-entry')).toHaveLength(2);
        expect(scroll.fn.mock.calls.length).toBeGreaterThan(before);
    });
});
