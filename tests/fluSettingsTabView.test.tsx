// @vitest-environment jsdom
/**
 * FluSettingsTabView — Configuración de FLU.
 *
 * Contactos ya no vive aquí: la vista solo monta los paneles de configuración.
 * Se sustituyen las fronteras de los paneles hijos; el shell (PanelFrame y
 * barra de guardado) se renderiza de verdad.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/components/FluSettingsPanel', () => ({ FluSettingsPanel: () => <div data-testid="mock-flu" /> }));
vi.mock('../src/components/AmbientesPanel', () => ({ AmbientesPanel: () => <div data-testid="mock-ambientes" /> }));
vi.mock('../src/components/PaletasPanel', () => ({ PaletasPanel: () => <div data-testid="mock-paletas" /> }));
vi.mock('../src/components/AssistantSettingsPanel', () => ({ AssistantSettingsPanel: () => <div data-testid="mock-assistant" /> }));
vi.mock('../src/components/ParticipantsPanel', () => ({ ParticipantsPanel: () => <div data-testid="mock-participants" /> }));
vi.mock('../src/components/BrowserProfilesPanel', () => ({ BrowserProfilesPanel: () => <div data-testid="mock-browser" /> }));
vi.mock('../src/components/SearchControlCenter', () => ({ SearchControlCenter: () => <div data-testid="mock-search" /> }));

import { FluSettingsTabView } from '../src/components/FluSettingsTabView';

const propsFor = (over: Record<string, unknown> = {}) => ({
    activeTab: 'settings',
    expandedFrameId: '',
    onToggleExpand: vi.fn(),
    flu: { language: 'es' },
    ambientes: {},
    paletas: {},
    assistant: {},
    participants: {},
    browser: {},
    search: {},
    ...over,
});

describe('FluSettingsTabView', () => {
    it('monta los paneles de configuración una vez y no Contactos', () => {
        render(<FluSettingsTabView {...(propsFor() as any)} />);

        for (const id of [
            'mock-flu',
            'mock-ambientes',
            'mock-paletas',
            'mock-assistant',
            'mock-participants',
            'mock-browser',
            'mock-search',
        ]) {
            expect(screen.getAllByTestId(id)).toHaveLength(1);
        }
        expect(screen.queryByTestId('contacts-panel')).toBeNull();
        expect(screen.queryByRole('tablist')).toBeNull();
    });

    it('mantiene el frame de Configuración y su toggle', () => {
        const onToggleExpand = vi.fn();
        const { container } = render(
            <FluSettingsTabView {...(propsFor({ onToggleExpand }) as any)} />,
        );

        const frame = container.querySelector('[data-frame-id="settings"]') as HTMLElement;
        expect(frame).toBeTruthy();
        expect(frame.querySelector('.panel-frame__title')?.textContent).toContain('Configuraci');
        fireEvent.click(frame.querySelector('.panel-frame__toggle') as HTMLButtonElement);
        expect(onToggleExpand).toHaveBeenCalledWith('settings');
    });
});
