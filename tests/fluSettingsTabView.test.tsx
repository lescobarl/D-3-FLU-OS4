// @vitest-environment jsdom
// ============================================================
// FluSettingsTabView - vista contenedora de la pestana Configuracion.
// ------------------------------------------------------------
// El modulo bajo prueba es un contenedor presentacional: recibe por
// props los bundles ya resueltos y los reparte entre 12 paneles.
//
// FRONTERA sustituida: los 12 paneles hijos son colaboradores que por
// dentro hablan con stores (zustand), persistencia (Dexie/localStorage)
// y red. Se reemplazan por dobles que registran las props recibidas, de
// modo que se prueba SOLO la conducta del contenedor (agrupacion,
// visibilidad, reparto de props y shell). El modulo bajo prueba NUNCA
// se mockea; los shells (FluShellTabs, PanelFrame, SettingsSaveContext)
// quedan reales porque son la estructura que esta vista configura.
//
//   Bloque A - submenu de secciones (SETTINGS_GROUPS) y su callback.
//   Bloque B - visibilidad del grupo activo (atributo hidden).
//   Bloque C - reparto de cada bundle a su panel.
//   Bloque D - shell: PanelFrame, FluTabPanel y SettingsSaveBar.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const captured = vi.hoisted(() => ({ props: {} as Record<string, Record<string, unknown>> }));

// Los dobles solo capturan props; no importan nada de los paneles reales.
function mockChild(name: string, testId: string) {
    return function MockChild(props: Record<string, unknown>) {
        captured.props[name] = props;
        return <div data-testid={testId} />;
    };
}

vi.mock('../src/components/FluSettingsPanel', () => ({ FluSettingsPanel: mockChild('flu', 'mock-flu') }));
vi.mock('../src/components/AmbientesPanel', () => ({ AmbientesPanel: mockChild('ambientes', 'mock-ambientes') }));
vi.mock('../src/components/PaletasPanel', () => ({ PaletasPanel: mockChild('paletas', 'mock-paletas') }));
vi.mock('../src/components/AssistantSettingsPanel', () => ({ AssistantSettingsPanel: mockChild('assistant', 'mock-assistant') }));
vi.mock('../src/components/ParticipantsPanel', () => ({ ParticipantsPanel: mockChild('participants', 'mock-participants') }));
vi.mock('../src/components/BrowserProfilesPanel', () => ({ BrowserProfilesPanel: mockChild('browser', 'mock-browser') }));
vi.mock('../src/components/SearchControlCenter', () => ({ SearchControlCenter: mockChild('search', 'mock-search') }));
vi.mock('../src/components/ContactsPanel', () => ({ ContactsPanel: mockChild('contacts', 'mock-contacts') }));
vi.mock('../src/components/AgendaPanel', () => ({ AgendaPanel: mockChild('agenda', 'mock-agenda') }));
vi.mock('../src/components/ShoppingPanel', () => ({ ShoppingPanel: mockChild('shopping', 'mock-shopping') }));
vi.mock('../src/components/MateriaGrisPanel', () => ({ MateriaGrisPanel: mockChild('materiaGris', 'mock-materia-gris') }));

import { FluSettingsTabView, SETTINGS_GROUPS } from '../src/components/FluSettingsTabView';
import type { FluSettingsTabViewProps, SettingsGroupId } from '../src/components/FluSettingsTabView';
import type { FluSettingsPanelProps } from '../src/components/FluSettingsPanel';
import type { AmbientesPanelProps } from '../src/components/AmbientesPanel';
import type { PaletasPanelProps } from '../src/components/PaletasPanel';
import type { AssistantSettingsPanelProps } from '../src/components/AssistantSettingsPanel';
import type { ParticipantsPanelProps } from '../src/components/ParticipantsPanel';
import type { BrowserProfilesPanelProps } from '../src/components/BrowserProfilesPanel';
import type { SearchControlCenterProps } from '../src/components/SearchControlCenter';
import type { ContactsPanelProps } from '../src/components/ContactsPanel';
import type { AgendaPanelProps } from '../src/components/AgendaPanel';
import type { ShoppingPanelProps } from '../src/components/ShoppingPanel';
import type { MateriaGrisPanelProps } from '../src/components/MateriaGrisPanel';

function propsFor(over: Partial<FluSettingsTabViewProps> = {}): FluSettingsTabViewProps {
    return {
        activeTab: 'settings',
        expandedFrameId: '',
        onToggleExpand: () => {},
        group: 'flu',
        onGroupChange: () => {},
        flu: { marker: 'flu', language: 'es' } as unknown as FluSettingsPanelProps,
        ambientes: { marker: 'ambientes' } as unknown as AmbientesPanelProps,
        paletas: { marker: 'paletas' } as unknown as PaletasPanelProps,
        assistant: { marker: 'assistant' } as unknown as AssistantSettingsPanelProps,
        participants: { marker: 'participants' } as unknown as ParticipantsPanelProps,
        browser: { marker: 'browser' } as unknown as BrowserProfilesPanelProps,
        search: { marker: 'search' } as unknown as SearchControlCenterProps,
        contacts: { marker: 'contacts' } as unknown as ContactsPanelProps,
        agenda: { marker: 'agenda' } as unknown as AgendaPanelProps,
        shopping: { marker: 'shopping' } as unknown as ShoppingPanelProps,
        materiaGris: { marker: 'materiaGris' } as unknown as MateriaGrisPanelProps,
        ...over,
    };
}

function groupEl(container: HTMLElement, id: SettingsGroupId): HTMLElement {
    return container.querySelector(`.flu-settings-group--${id}`) as HTMLElement;
}

function settingsTablist() {
    return screen.getByRole('tablist', { name: 'Secciones de ajustes' });
}

beforeEach(() => {
    captured.props = {};
});

describe('FluSettingsTabView - Bloque A: submenu de secciones', () => {
    it('SETTINGS_GROUPS declara las tres secciones en orden', () => {
        expect(SETTINGS_GROUPS.map((g) => g.id)).toEqual(['flu', 'data', 'management']);
    });

    it('renderiza un tab por seccion con su etiqueta', () => {
        render(<FluSettingsTabView {...propsFor()} />);
        const tabs = within(settingsTablist()).getAllByRole('tab');
        expect(tabs).toHaveLength(3);
        expect(tabs[0].textContent).toBe('FLU');
        expect(tabs[1].textContent).toBe('Mis datos');
    });

    it('marca la seccion activa con aria-selected y clase is-active', () => {
        render(<FluSettingsTabView {...propsFor({ group: 'data' })} />);
        const list = settingsTablist();
        expect(within(list).getByRole('tab', { name: 'Mis datos' }).getAttribute('aria-selected')).toBe('true');
        expect(within(list).getByRole('tab', { name: 'Mis datos' }).className).toContain('is-active');
        expect(within(list).getByRole('tab', { name: 'FLU' }).getAttribute('aria-selected')).toBe('false');
        expect(within(list).getByRole('tab', { name: 'FLU' }).className).not.toContain('is-active');
    });

    it('al pulsar una seccion avisa onGroupChange con su id', () => {
        const onGroupChange = vi.fn();
        render(<FluSettingsTabView {...propsFor({ onGroupChange })} />);
        const tabs = within(settingsTablist()).getAllByRole('tab');
        fireEvent.click(tabs[2]);
        expect(onGroupChange).toHaveBeenCalledWith('management');
        expect(onGroupChange).toHaveBeenCalledTimes(1);
    });
});

describe('FluSettingsTabView - Bloque B: visibilidad por grupo', () => {
    it('solo el grupo activo queda visible; los demas llevan hidden', () => {
        const { container } = render(<FluSettingsTabView {...propsFor({ group: 'flu' })} />);
        expect(groupEl(container, 'flu').hasAttribute('hidden')).toBe(false);
        expect(groupEl(container, 'data').hasAttribute('hidden')).toBe(true);
        expect(groupEl(container, 'management').hasAttribute('hidden')).toBe(true);
    });

    it('el grupo Mis datos monta ContactsPanel y oculta los otros dos', () => {
        const { container } = render(<FluSettingsTabView {...propsFor({ group: 'data' })} />);
        expect(groupEl(container, 'data').hasAttribute('hidden')).toBe(false);
        expect(groupEl(container, 'flu').hasAttribute('hidden')).toBe(true);
        expect(groupEl(container, 'management').hasAttribute('hidden')).toBe(true);
        expect(within(groupEl(container, 'data')).getByTestId('mock-contacts')).toBeTruthy();
    });

    it('el grupo Gestion da a AgendaPanel un testId propio y monta Shopping y MateriaGris', () => {
        const { container } = render(<FluSettingsTabView {...propsFor({ group: 'management' })} />);
        expect(groupEl(container, 'management').hasAttribute('hidden')).toBe(false);
        expect(captured.props.agenda.testId).toBe('settings-agenda-panel');
        expect(within(groupEl(container, 'management')).getByTestId('mock-shopping')).toBeTruthy();
        expect(within(groupEl(container, 'management')).getByTestId('mock-materia-gris')).toBeTruthy();
    });
});

describe('FluSettingsTabView - Bloque C: reparto de props', () => {
    it('pasa cada bundle a su panel correspondiente', () => {
        render(<FluSettingsTabView {...propsFor()} />);
        expect(captured.props.flu.marker).toBe('flu');
        expect(captured.props.ambientes.marker).toBe('ambientes');
        expect(captured.props.paletas.marker).toBe('paletas');
        expect(captured.props.assistant.marker).toBe('assistant');
        expect(captured.props.participants.marker).toBe('participants');
        expect(captured.props.browser.marker).toBe('browser');
        expect(captured.props.search.marker).toBe('search');
        expect(captured.props.contacts.marker).toBe('contacts');
        expect(captured.props.agenda.marker).toBe('agenda');
        expect(captured.props.shopping.marker).toBe('shopping');
        expect(captured.props.materiaGris.marker).toBe('materiaGris');
    });
});

describe('FluSettingsTabView - Bloque D: shell de la vista', () => {
    it('PanelFrame lleva titulo Configuracion y su toggle avisa onToggleExpand("settings")', () => {
        const onToggleExpand = vi.fn();
        const { container } = render(<FluSettingsTabView {...propsFor({ onToggleExpand })} />);
        const frame = container.querySelector('[data-frame-id="settings"]') as HTMLElement;
        expect(frame).toBeTruthy();
        expect(frame.querySelector('.panel-frame__title')?.textContent).toContain('Configuraci');
        fireEvent.click(frame.querySelector('.panel-frame__toggle') as HTMLButtonElement);
        expect(onToggleExpand).toHaveBeenCalledWith('settings');
    });

    it('expandedFrameId controla la clase expandida del frame', () => {
        const first = render(<FluSettingsTabView {...propsFor({ expandedFrameId: 'settings' })} />);
        expect(first.container.querySelector('.panel-frame--settings')?.className).toContain('panel-frame--expanded');
        first.unmount();

        const second = render(<FluSettingsTabView {...propsFor({ expandedFrameId: '' })} />);
        expect(second.container.querySelector('.panel-frame--settings')?.className).not.toContain('panel-frame--expanded');
    });

    it('FluTabPanel oculta la seccion cuando activeTab no es settings', () => {
        const active = render(<FluSettingsTabView {...propsFor({ activeTab: 'settings' })} />);
        expect(document.getElementById('flu-tabpanel-settings')?.hasAttribute('hidden')).toBe(false);
        active.unmount();

        render(<FluSettingsTabView {...propsFor({ activeTab: 'other' })} />);
        expect(document.getElementById('flu-tabpanel-settings')?.hasAttribute('hidden')).toBe(true);
    });

    it('SettingsSaveBar recibe el idioma del bundle flu', () => {
        const spanish = render(<FluSettingsTabView {...propsFor()} />);
        expect(screen.getByTestId('settings-save-all').textContent).toContain('Guardar');
        spanish.unmount();

        const fluent = propsFor({ flu: { marker: 'flu', language: 'en' } as unknown as FluSettingsPanelProps });
        render(<FluSettingsTabView {...fluent} />);
        expect(screen.getByTestId('settings-save-all').textContent).toContain('Save settings');
    });
});
