// @vitest-environment jsdom
// ============================================================
// controlsPanel.test.tsx - Panel de controles del rig (FK/IK)
// ------------------------------------------------------------
// Panel presentacional que lista los controles del rig agrupados
// por categoria. Su unica frontera es el store zustand
// (`bunnyStore`), que se mockea con `vi.hoisted` para observar
// `addLog` sin tocar estado global. Se prueban: cabecera,
// agrupacion y orden de categorias, numero total de botones,
// titulo/bone por control, color por categoria y el log que
// dispara cada clic (incluido el branch que hoy es no-op).
// ============================================================
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

const bunny = vi.hoisted(() => {
    const state = {
        logsEnabled: false,
        addLog: vi.fn(),
        playAnimation: vi.fn(),
        setSignal: vi.fn(),
        setState: vi.fn(),
    };
    const useBunnyStore = (
        selector?: (s: typeof state) => unknown,
    ) => (selector ? selector(state) : state);
    (useBunnyStore as unknown as { getState: () => typeof state }).getState = () => state;
    return { state, useBunnyStore };
});

vi.mock('../src/avatar/store/bunnyStore', () => ({
    useBunnyStore: bunny.useBunnyStore,
    ensureAvatarPantsVisible: () => {},
}));

import ControlsPanel from '../src/avatar/components/ControlsPanel';

beforeEach(() => {
    bunny.state.logsEnabled = false;
    bunny.state.addLog.mockClear();
    bunny.state.playAnimation.mockClear();
    bunny.state.setSignal.mockClear();
    bunny.state.setState.mockClear();
});

function normalizeColor(hex: string): string {
    const probe = document.createElement('span');
    probe.style.color = hex;
    return probe.style.color;
}

const categoryLabels = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.control-category-label')).map((n) => n.textContent);

const allButtons = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('button.btn-control')) as HTMLButtonElement[];

// ------------------------------------------------------------
// Bloque A: cabecera y estructura
// ------------------------------------------------------------
describe('ControlsPanel - cabecera', () => {
    it('renderiza el titulo y el badge del panel', () => {
        const { container } = render(<ControlsPanel />);

        expect(container.querySelector('.panel-title')!.textContent).toBe('CONTROLS (RIG)');
        expect(container.querySelector('.panel-badge')!.textContent).toBe('API');
    });
});

// ------------------------------------------------------------
// Bloque B: categorias, orden y colores
// ------------------------------------------------------------
describe('ControlsPanel - categorias', () => {
    it('muestra las seis categorias en el orden definido', () => {
        const { container } = render(<ControlsPanel />);

        expect(categoryLabels(container)).toEqual([
            'Tronco',
            'Brazo Izquierdo',
            'Brazo Derecho',
            'Pierna Izquierda',
            'Pierna Derecha',
            'IK Effectors',
        ]);
    });

    it('el numero total de botones de control es 43', () => {
        const { container } = render(<ControlsPanel />);

        expect(allButtons(container)).toHaveLength(43);
    });

    it('reparte los controles por categoria (6/4/4/3/3/23)', () => {
        const { container } = render(<ControlsPanel />);

        const groups = Array.from(container.querySelectorAll('.control-category'));
        const counts = Object.fromEntries(
            groups.map((g) => [
                g.querySelector('.control-category-label')!.textContent,
                g.querySelectorAll('button.btn-control').length,
            ]),
        );

        expect(counts).toEqual({
            Tronco: 6,
            'Brazo Izquierdo': 4,
            'Brazo Derecho': 4,
            'Pierna Izquierda': 3,
            'Pierna Derecha': 3,
            'IK Effectors': 23,
        });
    });

    it('cada categoria pinta su etiqueta con su color', () => {
        const { container } = render(<ControlsPanel />);

        const labels = container.querySelectorAll('.control-category-label') as NodeListOf<HTMLElement>;

        expect(labels[0].style.color).toBe(normalizeColor('#ff6b6b'));
        expect(labels[5].style.color).toBe(normalizeColor('#dfe6e9'));
    });
});

// ------------------------------------------------------------
// Bloque C: boton -> titulo, bone y label
// ------------------------------------------------------------
describe('ControlsPanel - botones de control', () => {
    it('el titulo de un control de tronco lleva id, bone y label', () => {
        const { container } = render(<ControlsPanel />);

        const head = container.querySelector('[data-control="Bunny_Ctrl_Head"]') as HTMLButtonElement;

        expect(head.title).toBe('Bunny_Ctrl_Head\nBone: head\nHead');
        expect(head.querySelector('.btn-label')!.textContent).toBe('Head');
    });

    it('un effector lleva el bone del hueso correcto (LeftHandThumb -> thumb_03_l)', () => {
        const { container } = render(<ControlsPanel />);

        const thumb = container.querySelector(
            '[data-control="Bunny_Ctrl_LeftHandThumbEffector"]',
        ) as HTMLButtonElement;

        expect(thumb.title).toBe(
            'Bunny_Ctrl_LeftHandThumbEffector\nBone: thumb_03_l\nL Thumb IK',
        );
    });

    it('cada boton expone un data-control unico y no vacio', () => {
        const { container } = render(<ControlsPanel />);

        const ids = allButtons(container).map((b) => b.getAttribute('data-control'));

        expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
        expect(new Set(ids).size).toBe(43);
    });
});

// ------------------------------------------------------------
// Bloque D: clic -> addLog (con formato exacto)
// ------------------------------------------------------------
describe('ControlsPanel - clic registra log', () => {
    it('el clic registra una entrada component/control_select con su detalle', () => {
        const { container } = render(<ControlsPanel />);

        fireEvent.click(container.querySelector('[data-control="Bunny_Ctrl_Hips"]')!);

        expect(bunny.state.addLog).toHaveBeenCalledTimes(1);
        const entry = bunny.state.addLog.mock.calls[0][0];
        expect(entry).toEqual({
            timestamp: expect.any(String),
            type: 'component',
            action: 'control_select',
            detail: 'Bunny_Ctrl_Hips (Hips) \u2192 bone: pelvis',
        });
        expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);
    });

    it('clics en controles distintos generan una entrada por cada uno', () => {
        const { container } = render(<ControlsPanel />);

        fireEvent.click(container.querySelector('[data-control="Bunny_Ctrl_Head"]')!);
        fireEvent.click(container.querySelector('[data-control="Bunny_Ctrl_Spine2"]')!);

        expect(bunny.state.addLog).toHaveBeenCalledTimes(2);
        expect(bunny.state.addLog.mock.calls[0][0].detail).toBe(
            'Bunny_Ctrl_Head (Head) \u2192 bone: head',
        );
        expect(bunny.state.addLog.mock.calls[1][0].detail).toBe(
            'Bunny_Ctrl_Spine2 (Spine2) \u2192 bone: spine_03',
        );
    });

    it('con logsEnabled=true el clic sigue registrando (el branch es no-op)', () => {
        bunny.state.logsEnabled = true;
        const { container } = render(<ControlsPanel />);

        fireEvent.click(container.querySelector('[data-control="Bunny_Ctrl_Neck"]')!);

        expect(bunny.state.addLog).toHaveBeenCalledTimes(1);
    });

    it('el clic solo toca addLog, no otras acciones del store', () => {
        const { container } = render(<ControlsPanel />);

        fireEvent.click(container.querySelector('[data-control="Bunny_Ctrl_LeftFoot"]')!);

        expect(bunny.state.addLog).toHaveBeenCalledTimes(1);
        expect(bunny.state.playAnimation).not.toHaveBeenCalled();
        expect(bunny.state.setSignal).not.toHaveBeenCalled();
        expect(bunny.state.setState).not.toHaveBeenCalled();
    });
});
