// @vitest-environment jsdom
// ============================================================
// agendaPanelsEdit.test.tsx — Guard de edición en la pestaña Agenda
// ------------------------------------------------------------
// Invariante: recordatorios y alarmas de los paneles de Agenda tienen ✎ y
// editan en línea (Enter/blur guarda) llamando a onEdit — igual que Notas.
// ============================================================
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { RemindersPanel } from '../src/components/RemindersPanel';
import { TemporalItemsPanel } from '../src/components/TemporalItemsPanel';

const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const sync = { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false };

describe('Agenda — edición en línea (✎) como Notas', () => {
    it('RemindersPanel: ✎ edita el texto con onEdit', () => {
        const onEdit = vi.fn(async () => null);
        const reminder = {
            id: 'r1',
            text: 'Cita con Ana',
            dueAt: NOW + 3600000,
            status: 'pending',
            createdAt: NOW,
            updatedAt: NOW,
            sync,
        } as any;

        const { container } = render(
            <RemindersPanel
                items={[reminder]}
                loading={false}
                pendingCount={1}
                onAdd={async () => {}}
                onComplete={async () => {}}
                onDismiss={async () => {}}
                onRemove={async () => {}}
                onEdit={onEdit}
                now={() => NOW}
            />,
        );

        const editBtn = container.querySelector('[data-testid="reminders-edit-r1"]');
        expect(editBtn).not.toBeNull();
        fireEvent.click(editBtn!);
        const input = container.querySelector('[data-testid="reminders-edit-input-r1"]') as HTMLInputElement;
        expect(input).not.toBeNull();
        fireEvent.change(input, { target: { value: 'Cita con Ana y Luis' } });
        fireEvent.blur(input);
        expect(onEdit).toHaveBeenCalledWith('r1', 'Cita con Ana y Luis');
    });

    it('TemporalItemsPanel: ✎ edita la etiqueta con onEdit', () => {
        const onEdit = vi.fn(async () => null);
        const alarm = {
            id: 'a1',
            kind: 'alarm',
            label: 'Despertar',
            trigger: { kind: 'daily', timeOfDay: '07:00' },
            recurrence: { kind: 'daily' },
            nextAt: NOW + 3600000,
            status: 'pending',
            createdAt: NOW,
            updatedAt: NOW,
            sync,
        } as any;

        const { container } = render(
            <TemporalItemsPanel
                alarms={[alarm]}
                timers={[]}
                loading={false}
                onAdd={async () => {}}
                onCancel={async () => {}}
                onRemove={async () => {}}
                onEdit={onEdit}
                now={() => NOW}
            />,
        );

        const editBtn = container.querySelector('[data-testid="temporal-edit-a1"]');
        expect(editBtn).not.toBeNull();
        fireEvent.click(editBtn!);
        const input = container.querySelector('[data-testid="temporal-edit-input-a1"]') as HTMLInputElement;
        expect(input).not.toBeNull();
        fireEvent.change(input, { target: { value: 'Despertar 6am' } });
        fireEvent.blur(input);
        expect(onEdit).toHaveBeenCalledWith('a1', { label: 'Despertar 6am', timeOfDay: '07:00' });
    });
});
