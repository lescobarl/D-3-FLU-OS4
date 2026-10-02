// @vitest-environment jsdom
// ============================================================
// FluWorkspaceTabView - vista presentacional de la pestaña Pizarrón.
// ------------------------------------------------------------
// El módulo bajo prueba es un contenedor puro: envuelve el WorkspaceHub en
// su PanelFrame expandible dentro de FluTabPanel. Frontera sustituida: el
// WorkspaceHub real (colaborador pesado que por dentro habla con stores,
// hooks de búsqueda y subida de archivos) se reemplaza por un doble que
// captura las props. Los shells reales (FluTabPanel, PanelFrame) se
// conservan porque son la estructura que esta vista configura.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

const captured = vi.hoisted(() => ({ hub: null as Record<string, unknown> | null }));

vi.mock('../src/components/WorkspaceHub', () => ({
    WorkspaceHub: (props: Record<string, unknown>) => {
        captured.hub = props;
        return <div data-testid="workspace-hub-stub" />;
    },
}));

import { FluWorkspaceTabView } from '../src/components/FluWorkspaceTabView';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig';
import type { WorkspaceHubProps } from '../src/components/WorkspaceHub';

const FRAME = FLU_CONFIG.frames?.workspace || 'workspace';
const TITLE = FLU_CONFIG.ui?.workspace?.title || 'Pizarrón';
const HUB = { marker: 'hub' } as unknown as WorkspaceHubProps;

const mount = (
    over: Partial<{
        activeTab: string;
        expandedFrameId: string;
        onToggleExpand: (frameId: string) => void;
        hub: WorkspaceHubProps;
    }> = {},
) => {
    const onToggleExpand = vi.fn();
    const props = { activeTab: 'workspace', expandedFrameId: '', onToggleExpand, hub: HUB, ...over };
    const view = render(<FluWorkspaceTabView {...props} />);
    return { ...props, onToggleExpand, ...view };
};

const tabpanel = (container: HTMLElement) => container.querySelector('#flu-tabpanel-workspace') as HTMLElement;
const frame = (container: HTMLElement) => container.querySelector(`[data-frame-id="${FRAME}"]`) as HTMLElement;

beforeEach(() => {
    captured.hub = null;
});

describe('FluWorkspaceTabView - FluTabPanel', () => {
    it('usa el id de panel de la pestaña workspace', () => {
        const { container } = mount();

        expect(tabpanel(container).id).toBe('flu-tabpanel-workspace');
        expect(tabpanel(container).getAttribute('role')).toBe('tabpanel');
    });

    it('queda visible solo cuando workspace es la pestaña activa', () => {
        const activa = mount({ activeTab: 'workspace' });
        expect(tabpanel(activa.container).hidden).toBe(false);
        activa.unmount();

        const otra = mount({ activeTab: 'system' });
        expect(tabpanel(otra.container).hidden).toBe(true);
    });

    it('lleva la clase de panel de workspace', () => {
        const { container } = mount();

        expect(tabpanel(container).className).toContain('flu-tab-panel--workspace');
    });
});

describe('FluWorkspaceTabView - PanelFrame', () => {
    it('usa el id de frame de la config y su clase', () => {
        const { container } = mount();

        expect(frame(container)).toBeTruthy();
        expect(frame(container).className).toContain('panel-frame--workspace');
    });

    it('el título sale de la config del workspace', () => {
        const { container } = mount();

        expect(frame(container).querySelector('.panel-frame__title')?.textContent).toBe(TITLE);
    });

    it('el toggle avisa onToggleExpand con el id de frame', () => {
        const { container, onToggleExpand } = mount();

        fireEvent.click(frame(container).querySelector('.panel-frame__toggle') as HTMLElement);

        expect(onToggleExpand).toHaveBeenCalledTimes(1);
        expect(onToggleExpand).toHaveBeenCalledWith(FRAME);
    });

    it('expandedFrameId igual al frame lo marca como expandido', () => {
        const expandido = mount({ expandedFrameId: FRAME });
        expect(frame(expandido.container).className).toContain('panel-frame--expanded');
        expandido.unmount();

        const plegado = mount({ expandedFrameId: '' });
        expect(frame(plegado.container).className).not.toContain('panel-frame--expanded');
    });
});

describe('FluWorkspaceTabView - WorkspaceHub', () => {
    it('pasa las props del hub al WorkspaceHub', () => {
        mount();

        expect(captured.hub).toEqual(HUB);
    });

    it('monta el hub dentro del contenido del frame de workspace', () => {
        const { container } = mount();

        expect(
            container.querySelector('.frame-content--workspace [data-testid="workspace-hub-stub"]'),
        ).toBeTruthy();
    });
});
