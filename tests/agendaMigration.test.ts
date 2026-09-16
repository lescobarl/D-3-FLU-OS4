// ============================================================
// Prueba de escritorio de la migración (mapeo viejo → agenda)
// ------------------------------------------------------------
// Valida el mapeo documentado sin tocar Dexie real: reminder→recordatorio/cita,
// temporal→alarma, y el borrado lógico de estados.
// ============================================================
import { describe, it, expect } from 'vitest';
import { mapLegacyToAgenda } from '../src/core/agenda/agendaMigration';
import type { ReminderRecord } from '../src/core/db/fluDatabase';
import type { TemporalItemRecord } from '../src/core/temporal/temporalTypes';

const SYNC = { revision: 1, updated_at: '2026-09-15T00:00:00.000Z', deleted: false };
const NOW = new Date(2026, 8, 16, 11, 0, 0, 0).getTime();

describe('migración → agenda unificada', () => {
    it('recordatorio con categoría cita → cita; sin categoría → recordatorio', () => {
        const cita: ReminderRecord = {
            id: 'r1', text: 'Doctor', dueAt: NOW, personId: 'p1', category: 'cita',
            status: 'pending', createdAt: NOW, updatedAt: NOW, sync: SYNC,
        };
        const rec: ReminderRecord = {
            id: 'r2', text: 'Comprar pan', dueAt: NOW, personId: 'p1', category: 'reminder',
            status: 'pending', createdAt: NOW, updatedAt: NOW, sync: SYNC,
        };
        const items = mapLegacyToAgenda({ reminders: [cita, rec] });
        expect(items.find((i) => i.id === 'r1')?.kind).toBe('cita');
        expect(items.find((i) => i.id === 'r2')?.kind).toBe('recordatorio');
    });

    it('temporal alarm → alarma con absolute en nextAt', () => {
        const alarm: TemporalItemRecord = {
            id: 'a1', kind: 'alarm', label: 'Despertador',
            trigger: { kind: 'absolute', at: NOW }, recurrence: { kind: 'once' },
            nextAt: NOW, status: 'pending', personId: 'p1',
            createdAt: NOW, updatedAt: NOW, sync: SYNC,
        };
        const items = mapLegacyToAgenda({ temporals: [alarm] });
        expect(items[0].kind).toBe('alarma');
        expect(items[0].trigger).toEqual({ type: 'absolute', at: NOW });
    });

    it('temporal timer → alarma countdown', () => {
        const timer: TemporalItemRecord = {
            id: 't1', kind: 'timer', label: 'Té',
            trigger: { kind: 'countdown', durationMs: 300_000 }, recurrence: { kind: 'once' },
            nextAt: NOW + 300_000, status: 'pending',
            createdAt: NOW, updatedAt: NOW, sync: SYNC,
        };
        const items = mapLegacyToAgenda({ temporals: [timer] });
        expect(items[0].kind).toBe('alarma');
        expect(items[0].trigger).toEqual({ type: 'countdown', durationMs: 300_000 });
    });

    it('estados done/dismissed/cancelled se traducen a done/deleted (lógico)', () => {
        const done: ReminderRecord = {
            id: 'r3', text: 'Ya hecho', dueAt: NOW, category: 'reminder',
            status: 'done', createdAt: NOW, updatedAt: NOW, sync: SYNC,
        };
        const dismissed: ReminderRecord = {
            id: 'r4', text: 'Descartado', dueAt: NOW, category: 'reminder',
            status: 'dismissed', createdAt: NOW, updatedAt: NOW, sync: SYNC,
        };
        const items = mapLegacyToAgenda({ reminders: [done, dismissed] });
        expect(items.find((i) => i.id === 'r3')?.status).toBe('done');
        expect(items.find((i) => i.id === 'r4')?.status).toBe('deleted');
    });
});
