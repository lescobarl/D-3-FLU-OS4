// ============================================================
// Prueba de escritorio de la migración (mapeo viejo → agenda)
// ------------------------------------------------------------
// Valida el mapeo documentado sin tocar Dexie real: reminder→recordatorio/cita,
// temporal→alarma, horario→clase weekly, y el borrado lógico de estados.
// ============================================================
import { describe, it, expect } from 'vitest';
import { mapLegacyToAgenda } from '../src/core/agenda/agendaMigration';
import type { ReminderRecord, HorarioRecord } from '../src/core/db/fluDatabase';
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

    it('horario → clase weekly (dia 1=Lunes → day 1; dia 7=Domingo → day 0)', () => {
        const lunes: HorarioRecord = {
            id: 'h1', materia: 'Matemáticas', dia: 1, inicio: '09:00', fin: '10:00',
            personId: 'p1', createdAt: NOW, updatedAt: NOW, sync: SYNC,
        };
        const domingo: HorarioRecord = {
            id: 'h2', materia: 'Taller', dia: 7, inicio: '10:00', fin: '11:00',
            personId: 'p1', createdAt: NOW, updatedAt: NOW, sync: SYNC,
        };
        const items = mapLegacyToAgenda({ horario: [lunes, domingo] });
        expect(items.find((i) => i.id === 'h1')?.kind).toBe('clase');
        expect(items.find((i) => i.id === 'h1')?.trigger).toEqual({ type: 'weekly', daysOfWeek: [1], timeOfDay: '09:00' });
        expect(items.find((i) => i.id === 'h2')?.trigger).toEqual({ type: 'weekly', daysOfWeek: [0], timeOfDay: '10:00' });
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
