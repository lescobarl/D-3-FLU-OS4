// @vitest-environment jsdom
// ============================================================
// Prueba de escritorio de la UI única (AgendaPanel)
// ------------------------------------------------------------
// Cambio de vista, colores derivados y cancelar (borrado lógico).
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { AgendaPanel } from '../src/components/AgendaPanel';
import type { AgendaColorMap, AgendaItem } from '../src/core/agenda/agendaModel';

const COLORS: AgendaColorMap = {
    recordatorio: '#f59e0b', cita: '#3b82f6', junta: '#8b5cf6', clase: '#22c55e', alarma: '#ef4444',
};
const NOW = new Date(2026, 8, 15, 22, 0, 0, 0).getTime();

function item(id: string, trigger: AgendaItem['trigger']): AgendaItem {
    return { id, kind: 'alarma', label: id, trigger, status: 'pending', sync: { revision: 1, updated_at: '', deleted: false } };
}

describe('AgendaPanel — vista única', () => {
    it('muestra hoy por defecto y cambia de vista', () => {
        const hoy = item('a', { type: 'absolute', at: NOW + 1000 });
        render(<AgendaPanel items={[hoy]} colors={COLORS} now={NOW} />);
        expect(screen.getByTestId('agenda-item-a')).toBeTruthy();
        fireEvent.click(screen.getByTestId('agenda-view-week'));
        expect(screen.getByTestId('agenda-view-week').getAttribute('aria-selected')).toBe('true');
    });

    it('cancelar llama onCancel con el id (borrado lógico lo hace el servicio)', () => {
        const onCancel = vi.fn();
        const hoy = item('a', { type: 'absolute', at: NOW + 1000 });
        render(<AgendaPanel items={[hoy]} colors={COLORS} onCancel={onCancel} now={NOW} />);
        fireEvent.click(screen.getByTestId('agenda-cancel-a'));
        expect(onCancel).toHaveBeenCalledWith('a');
    });

    it('sin pendientes muestra el vacío', () => {
        render(<AgendaPanel items={[]} colors={COLORS} />);
        expect(screen.getByTestId('agenda-empty')).toBeTruthy();
    });
});
