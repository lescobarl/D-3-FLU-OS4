// @vitest-environment jsdom
/**
 * FluMinutesTabView - vista presentacional de la pestana Minutas (0%).
 *
 * POR QUE ESTE TEST: orquesta los dos frames (minuta e historial), el boton de
 * generar (con su estado de soporte/resumen) y el guardado via ref imperativa
 * del borrador. Se prueba la conducta real: visibilidad de la tab, titulos de
 * config, el boton que delega en onGenerateSummary y en la ref del panel, el
 * borrador que se formatea/parsea a traves del panel real, el historial con
 * seleccion y el plegado de cada frame.
 *
 * Presentacional puro: todos los handlers y la ref son props; los subcomponentes
 * de shell/panel se renderizan de verdad (no son frontera de store/red).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FluMinutesTabView } from '../src/components/FluMinutesTabView.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';
import {
    createMinuteDraftFromSummary,
    formatMinuteDraftText,
} from '../src/lib/minuteKnowledgeHelpers.js';
import {
    formatMinuteHistoryLabel,
    parseMinuteDraftText,
} from '../src/voice/lib/minuteKnowledge.js';
import type { MinuteUIEntry } from '../src/hooks/useMinuteKnowledge.js';
import type { MinuteDraft } from '../src/hooks/useMinuteHandlers.js';

const WS = FLU_CONFIG.ui?.workspace || {};
const SUMMARY_TITLE = WS.visibleLabels?.summary || 'Minuta';
const HISTORY_TITLE = WS.visibleLabels?.history || 'Historial de minutas';
const DRAFT_EMPTY = WS.minuteDraftEmpty || 'Sin borrador de minuta';
const HISTORY_EMPTY = WS.minuteHistoryEmpty || 'Sin minutas guardadas';
const GEN_LABEL = FLU_CONFIG.ui?.buttons?.generateMinute || 'Generar Minuta';
const SAVE_LABEL = FLU_CONFIG.ui?.buttons?.saveMinute || 'Guardar Minuta';
const FRAME_MINUTE = FLU_CONFIG.frames?.minute || 'minute';
const FRAME_HISTORY = FLU_CONFIG.frames?.history || 'history';

const DRAFT: MinuteDraft = createMinuteDraftFromSummary(
    {
        titulo: 'Junta Semanal',
        participantes: ['Ana', 'Luis'],
        resumen: 'Se reviso el avance',
        acuerdos: ['Cerrar sprint'],
        pendientes: ['Enviar informe'],
        siguientes_pasos: ['Reunion viernes'],
    },
    'Junta',
    'm1',
);

const ENTRY_A = {
    id: 'a',
    historyCode: '2026-01-01-1',
    description: 'Primera minuta',
    summarySnapshot: { titulo: 'Primera minuta' },
} as unknown as MinuteUIEntry;
const ENTRY_B = {
    id: 'b',
    historyCode: '2026-01-02-2',
    description: 'Segunda minuta',
    summarySnapshot: { titulo: 'Segunda minuta' },
} as unknown as MinuteUIEntry;

const montar = (over: Record<string, unknown> = {}) => {
    const minutePanelRef = { current: null } as { current: { save: () => void } | null };
    const props = {
        activeTab: 'minutes',
        expandedFrameId: '',
        onToggleExpand: vi.fn(),
        isSupported: true,
        isSummarizing: false,
        onGenerateSummary: vi.fn(async () => true),
        draft: null as MinuteDraft | null,
        onDraftChange: vi.fn(),
        onSaveMinute: vi.fn(async () => {}),
        minutePanelRef,
        history: [] as readonly MinuteUIEntry[],
        selectedId: null as string | null,
        onSelect: vi.fn(),
        ...over,
    };
    const Comp = FluMinutesTabView as unknown as (p: Record<string, unknown>) => React.ReactElement;
    const view = render(<Comp {...props} />);
    return { ...props, minutePanelRef, ...view };
};

describe('FluMinutesTabView - frames y visibilidad', () => {
    it('la tab panel queda visible solo cuando minutes es la activa', () => {
        const a = montar({ activeTab: 'minutes' });
        expect((a.container.querySelector('#flu-tabpanel-minutes') as HTMLElement).hidden).toBe(false);
        a.unmount();

        const b = montar({ activeTab: 'workspace' });
        expect((b.container.querySelector('#flu-tabpanel-minutes') as HTMLElement).hidden).toBe(true);
    });

    it('los titulos de los frames salen de la config del workspace', () => {
        montar();

        expect(screen.getByText(SUMMARY_TITLE)).toBeTruthy();
        expect(screen.getByText(HISTORY_TITLE)).toBeTruthy();
    });

    it('plegar cada frame avisa al padre con el id de frame canonico', () => {
        const { onToggleExpand, container } = montar();

        fireEvent.click(container.querySelector('.panel-frame--minute .panel-frame__toggle') as HTMLElement);
        expect(onToggleExpand).toHaveBeenCalledWith(FRAME_MINUTE);

        fireEvent.click(container.querySelector('.panel-frame--history .panel-frame__toggle') as HTMLElement);
        expect(onToggleExpand).toHaveBeenCalledWith(FRAME_HISTORY);
    });
});

describe('FluMinutesTabView - boton generar', () => {
    it('usa la etiqueta de la config y le anade puntos suspensivos al resumir', () => {
        const a = montar();
        expect(screen.getByRole('button', { name: GEN_LABEL })).toBeTruthy();
        a.unmount();

        montar({ isSummarizing: true });
        expect(screen.getByRole('button', { name: `${GEN_LABEL}...` })).toBeTruthy();
    });

    it('se deshabilita sin soporte de voz o mientras resume, y se habilita si todo va bien', () => {
        const a = montar({ isSupported: false });
        expect((screen.getByRole('button', { name: GEN_LABEL }) as HTMLButtonElement).disabled).toBe(true);
        a.unmount();

        const b = montar({ isSummarizing: true });
        expect((screen.getByRole('button', { name: `${GEN_LABEL}...` }) as HTMLButtonElement).disabled).toBe(true);
        b.unmount();

        montar();
        expect((screen.getByRole('button', { name: GEN_LABEL }) as HTMLButtonElement).disabled).toBe(false);
    });

    it('al pulsar generar pide el resumen anunciado por voz', () => {
        const { onGenerateSummary } = montar();

        fireEvent.click(screen.getByRole('button', { name: GEN_LABEL }));

        expect(onGenerateSummary).toHaveBeenCalledTimes(1);
        expect(onGenerateSummary).toHaveBeenCalledWith({ announce: true });
    });
});

describe('FluMinutesTabView - borrador', () => {
    it('sin borrador muestra el aviso vacio del workspace', () => {
        montar({ draft: null });

        expect(screen.getByText(DRAFT_EMPTY)).toBeTruthy();
    });

    it('con borrador formatea el texto y no aparece el aviso vacio', () => {
        montar({ draft: DRAFT });

        const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
        expect(textarea.value).toBe(formatMinuteDraftText(DRAFT));
        expect(screen.queryByText(DRAFT_EMPTY)).toBeNull();
    });

    it('el boton guardar delega en la ref imperativa del panel de borrador', () => {
        const { minutePanelRef } = montar({ draft: DRAFT });
        const save = vi.fn();
        minutePanelRef.current = { save };

        fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }));

        expect(save).toHaveBeenCalledTimes(1);
    });

    it('editar y guardar propaga el draft parseado a onDraftChange y onSaveMinute', () => {
        const { onDraftChange, onSaveMinute } = montar({ draft: DRAFT });
        const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
        const nuevoTexto = formatMinuteDraftText(
            createMinuteDraftFromSummary({ titulo: 'Otra minuta', resumen: 'nuevo' }, 'Junta', 'm1'),
        );

        fireEvent.change(textarea, { target: { value: nuevoTexto } });
        fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }));

        const esperado = parseMinuteDraftText(nuevoTexto, DRAFT);
        expect(esperado.titulo).toBe('Otra minuta');
        expect(onDraftChange).toHaveBeenCalledTimes(1);
        expect(onDraftChange).toHaveBeenCalledWith(esperado);
        expect(onSaveMinute).toHaveBeenCalledTimes(1);
        expect(onSaveMinute).toHaveBeenCalledWith(esperado);
    });
});

describe('FluMinutesTabView - historial', () => {
    it('sin historial muestra el aviso vacio del workspace', () => {
        montar({ history: [] });

        expect(screen.getByText(HISTORY_EMPTY)).toBeTruthy();
    });

    it('lista cada minuta con su etiqueta, marca la seleccionada y avisa al seleccionar', () => {
        const { onSelect } = montar({ history: [ENTRY_A, ENTRY_B], selectedId: ENTRY_B.id });

        const items = screen.getAllByRole('listitem');
        expect(items).toHaveLength(2);
        expect(items[0].textContent).toBe(formatMinuteHistoryLabel(ENTRY_A));
        expect(items[1].textContent).toBe(formatMinuteHistoryLabel(ENTRY_B));
        expect(items[1].className).toContain('minute-history__row--selected');
        expect(items[0].className).not.toContain('minute-history__row--selected');

        fireEvent.click(items[0]);
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith(ENTRY_A);
    });
});
