// @vitest-environment jsdom
// ============================================================
// settingsSaveContext.test.tsx — Barra GLOBAL Guardar/Restablecer
// ------------------------------------------------------------
// Guard de comportamiento del registro: un solo "Guardar configuración"
// confirma TODOS los paneles con borrador y un solo "Restablecer" los
// restablece, sin botones locales.
// ============================================================
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import {
    SettingsSaveProvider,
    SettingsSaveBar,
    useSettingsSaveRegistration,
} from '../src/components/SettingsSaveContext';

function Panel({
    id,
    onCommit,
    onReset,
}: {
    id: string;
    onCommit?: () => void;
    onReset?: () => void;
}) {
    useSettingsSaveRegistration(id, { commit: onCommit, reset: onReset });
    return null;
}

describe('SettingsSaveContext — barra global', () => {
    it('un solo Guardar confirma todos los paneles registrados', () => {
        const commitA = vi.fn();
        const commitB = vi.fn();
        const { container } = render(
            <SettingsSaveProvider>
                <Panel id="a" onCommit={commitA} />
                <Panel id="b" onCommit={commitB} />
                <SettingsSaveBar />
            </SettingsSaveProvider>,
        );

        fireEvent.click(container.querySelector('[data-testid="settings-save-all"]')!);

        expect(commitA).toHaveBeenCalledTimes(1);
        expect(commitB).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[data-testid="settings-save-feedback"]')?.textContent).toContain(
            'guardada',
        );
    });

    it('un solo Restablecer restablece todos los paneles registrados', () => {
        const resetA = vi.fn();
        const resetB = vi.fn();
        const { container } = render(
            <SettingsSaveProvider>
                <Panel id="a" onReset={resetA} />
                <Panel id="b" onReset={resetB} />
                <SettingsSaveBar language="en" />
            </SettingsSaveProvider>,
        );

        fireEvent.click(container.querySelector('[data-testid="settings-reset-all"]')!);

        expect(resetA).toHaveBeenCalledTimes(1);
        expect(resetB).toHaveBeenCalledTimes(1);
    });

    it('al desmontar un panel deja de recibir el commit global', () => {
        const commitA = vi.fn();
        const { container, rerender } = render(
            <SettingsSaveProvider>
                <Panel id="a" onCommit={commitA} />
                <SettingsSaveBar />
            </SettingsSaveProvider>,
        );
        rerender(
            <SettingsSaveProvider>
                <SettingsSaveBar />
            </SettingsSaveProvider>,
        );

        fireEvent.click(container.querySelector('[data-testid="settings-save-all"]')!);
        expect(commitA).not.toHaveBeenCalled();
    });

    it('sin provider la barra no renderiza (no rompe)', () => {
        const { container } = render(<SettingsSaveBar />);
        expect(container.querySelector('[data-testid="settings-save-bar"]')).toBeNull();
    });
});
