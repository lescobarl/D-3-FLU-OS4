// ============================================================
// Prueba de escritorio del motor ÚNICO de disparo (P7 de la spec)
// ------------------------------------------------------------
// Al vencerse: alarma=sonar, recordatorio=avisar, cita/junta/clase=marcar;
// recurrente re-tica, de una vez no; nextTick = siguiente vencimiento.
// ============================================================
import { describe, it, expect } from 'vitest';
import { runAgendaCycle, collectDueFires } from '../src/core/agenda/agendaMotor';
import { isRecurring } from '../src/core/agenda/agendaQuery';
import type { AgendaItem, AgendaKind } from '../src/core/agenda/agendaModel';

const NOW = new Date(2026, 8, 15, 22, 0, 0, 0).getTime();

function item(id: string, kind: AgendaKind, trigger: AgendaItem['trigger']): AgendaItem {
    return {
        id, kind, label: id, trigger, status: 'pending',
        sync: { revision: 1, updated_at: '', deleted: false },
    };
}

describe('agendaMotor — disparo único por kind', () => {
    it('a la hora, cada tipo hace lo suyo', () => {
        const alarma = item('a', 'alarma', { type: 'absolute', at: NOW - 1000 });
        const rec = item('r', 'recordatorio', { type: 'absolute', at: NOW - 1000 });
        const cita = item('c', 'cita', { type: 'absolute', at: NOW - 1000 });
        const fires = collectDueFires([alarma, rec, cita], NOW);
        expect(fires.find((f) => f.item.id === 'a')?.action).toBe('sonar');
        expect(fires.find((f) => f.item.id === 'r')?.action).toBe('avisar');
        expect(fires.find((f) => f.item.id === 'c')?.action).toBe('marcar');
    });

    it('solo dispara lo vencido; lo futuro queda para el próximo tick', () => {
        const vencido = item('v', 'alarma', { type: 'absolute', at: NOW - 1000 });
        const futuro = item('f', 'alarma', { type: 'absolute', at: NOW + 60 * 60 * 1000 });
        const cycle = runAgendaCycle([vencido, futuro], NOW);
        expect(cycle.fires.map((f) => f.item.id)).toEqual(['v']);
        expect(cycle.nextTick).toBe(NOW + 60 * 60 * 1000);
    });

    it('recurrente (daily) NO dispara en el ciclo: se agenda al próximo tick', () => {
        const daily = item('d', 'alarma', { type: 'daily', timeOfDay: '07:00' });
        const cycle = runAgendaCycle([daily], NOW);
        // A las 22:00 la alarma diaria de las 07:00 ya pasó: su próximo disparo
        // es MAÑANA 07:00; no está "vencida", está agendada.
        expect(cycle.fires).toEqual([]);
        const expected = new Date(2026, 8, 16, 7, 0, 0, 0).getTime();
        expect(cycle.nextTick).toBe(expected);
    });

    it('isRecurring distingue absolute de daily/weekly/countdown', () => {
        expect(isRecurring({ type: 'absolute', at: NOW })).toBe(false);
        expect(isRecurring({ type: 'daily', timeOfDay: '07:00' })).toBe(true);
        expect(isRecurring({ type: 'countdown', durationMs: 60000 })).toBe(true);
    });

    it('los borrados lógicos NUNCA disparan', () => {
        const borrado = item('b', 'alarma', { type: 'absolute', at: NOW - 1000 });
        borrado.status = 'deleted';
        borrado.sync.deleted = true;
        expect(collectDueFires([borrado], NOW)).toEqual([]);
    });

    it('sin pendientes, nextTick es null', () => {
        expect(runAgendaCycle([], NOW).nextTick).toBeNull();
    });
});
