// @vitest-environment jsdom
// ============================================================
// BunnyControlCenter - pantalla principal de control del avatar (0%).
// ------------------------------------------------------------
// Contenedor de composicion: se sustituyen SOLO las fronteras (el store
// Zustand, el resolutor de color bunnySceneColor y los paneles hijos/visor
// 3D) con vi.mock + vi.hoisted. El modulo bajo prueba NO se mockea. Se
// cubren: cabecera y subtitulo, estado con su color, animacion visible/
// oculta (guion), senal, accion de reset, montaje de los paneles hijos,
// estructura del layout y reactividad ante rerender y estados borde.
// ============================================================
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => {
    const state = {
        currentState: 'IDLE',
        currentAnimation: 'Idle_2' as string | null,
        isPlaying: true,
        currentSignal: 'NONE',
        reset: vi.fn(),
    };
    const bunnyStateColor = vi.fn(() => '#0000ff');
    return { state, bunnyStateColor };
});

vi.mock('../src/avatar/store/bunnyStore', () => ({
    useBunnyStore: (selector: (s: typeof deps.state) => unknown) => selector(deps.state),
}));

vi.mock('../src/avatar/config/bunnySceneConfig', () => ({
    bunnyStateColor: deps.bunnyStateColor,
}));

vi.mock('../src/avatar/components/BunnyViewer', () => ({
    default: () => <div data-testid="child-viewer" />,
}));
vi.mock('../src/avatar/components/ComponentPanel', () => ({
    default: () => <div data-testid="child-component" />,
}));
vi.mock('../src/avatar/components/AnimationPanel', () => ({
    default: () => <div data-testid="child-animation" />,
}));
vi.mock('../src/avatar/components/SignalPanel', () => ({
    default: () => <div data-testid="child-signal" />,
}));
vi.mock('../src/avatar/components/ControlsPanel', () => ({
    default: () => <div data-testid="child-controls" />,
}));
vi.mock('../src/avatar/components/LogPanel', () => ({
    default: () => <div data-testid="child-logs" />,
}));

import BunnyControlCenter from '../src/avatar/components/BunnyControlCenter';

const statusItems = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.status-item')) as HTMLElement[];

const DASH = String.fromCharCode(8212);

beforeEach(() => {
    deps.state.currentState = 'IDLE';
    deps.state.currentAnimation = 'Idle_2';
    deps.state.isPlaying = true;
    deps.state.currentSignal = 'NONE';
    deps.state.reset.mockClear();
    deps.bunnyStateColor.mockClear();
    deps.bunnyStateColor.mockReturnValue('#0000ff');
});

// ------------------------------------------------------------
// Bloque A: cabecera y estado
// ------------------------------------------------------------
describe('BunnyControlCenter - cabecera y estado', () => {
    it('pinta el titulo y el subtitulo', () => {
        render(<BunnyControlCenter />);

        expect(screen.getByText(/Bunny Control Center/)).toBeTruthy();
        expect(screen.getByText(/FLU OS 2.0/)).toBeTruthy();
    });

    it('muestra el estado actual con el color resuelto', () => {
        const { container } = render(<BunnyControlCenter />);

        expect(statusItems(container)[0].textContent).toContain('IDLE');
        const strong = statusItems(container)[0].querySelector('strong') as HTMLElement;
        expect(strong.style.color).toBe('rgb(0, 0, 255)');
    });

    it('muestra la animacion actual cuando esta reproduciendose', () => {
        render(<BunnyControlCenter />);

        expect(screen.getByText('Idle_2')).toBeTruthy();
    });

    it('con isPlaying=false oculta la animacion y pinta un guion', () => {
        deps.state.isPlaying = false;
        const { container } = render(<BunnyControlCenter />);

        expect(screen.queryByText('Idle_2')).toBeNull();
        expect(statusItems(container)[1].textContent).toContain(DASH);
    });

    it('edge: isPlaying=true sin animacion tambien pinta un guion', () => {
        deps.state.currentAnimation = null;
        const { container } = render(<BunnyControlCenter />);

        expect(statusItems(container)[1].textContent).toContain(DASH);
    });

    it('muestra la senal actual', () => {
        deps.state.currentSignal = 'WAVE';
        render(<BunnyControlCenter />);

        expect(screen.getByText('WAVE')).toBeTruthy();
    });
});

// ------------------------------------------------------------
// Bloque B: reset y layout
// ------------------------------------------------------------
describe('BunnyControlCenter - reset y layout', () => {
    it('el boton Reset llama a reset una sola vez', () => {
        render(<BunnyControlCenter />);

        fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
        expect(deps.state.reset).toHaveBeenCalledTimes(1);
    });

    it('monta los seis paneles hijos', () => {
        render(<BunnyControlCenter />);

        for (const id of [
            'child-viewer',
            'child-component',
            'child-animation',
            'child-signal',
            'child-controls',
            'child-logs',
        ]) {
            expect(screen.getByTestId(id)).toBeTruthy();
        }
    });

    it('coloca el visor, los cuatro paneles y los logs en su region', () => {
        const { container } = render(<BunnyControlCenter />);

        expect(container.querySelector('section.bcc-viewer')?.contains(screen.getByTestId('child-viewer'))).toBe(true);
        const aside = container.querySelector('aside.bcc-controls') as HTMLElement;
        expect(aside.querySelectorAll('[data-testid]')).toHaveLength(4);
        expect(container.querySelector('footer.bcc-footer')?.contains(screen.getByTestId('child-logs'))).toBe(true);
    });

    it('consulta el color del estado exactamente una vez por render', () => {
        render(<BunnyControlCenter />);

        expect(deps.bunnyStateColor).toHaveBeenCalledTimes(1);
        expect(deps.bunnyStateColor).toHaveBeenCalledWith('IDLE');
    });

    it('edge: un estado desconocido se pasa tal cual al resolutor', () => {
        deps.state.currentState = 'RARO';
        render(<BunnyControlCenter />);

        expect(screen.getByText('RARO')).toBeTruthy();
        expect(deps.bunnyStateColor).toHaveBeenCalledWith('RARO');
    });

    it('al rerender con nuevo estado actualiza textos y vuelve a resolver color', () => {
        const { rerender } = render(<BunnyControlCenter />);

        deps.state.currentState = 'THINKING';
        deps.state.currentAnimation = 'Walk';
        deps.state.currentSignal = 'THINK';
        rerender(<BunnyControlCenter />);

        expect(screen.getByText('THINKING')).toBeTruthy();
        expect(screen.getByText('Walk')).toBeTruthy();
        expect(screen.getByText('THINK')).toBeTruthy();
        expect(deps.bunnyStateColor).toHaveBeenCalledWith('THINKING');
        expect(deps.bunnyStateColor).toHaveBeenCalledTimes(2);
    });
});
