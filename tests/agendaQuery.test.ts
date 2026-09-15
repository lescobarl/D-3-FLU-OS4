// ============================================================
// Prueba de escritorio de la consulta y el motor de disparo
// ------------------------------------------------------------
// P2/P6/P7 de la spec: vista día/semana/mes y el tick del motor ÚNICO.
// ============================================================
import { describe, it, expect } from 'vitest';
import { agendaWindow, itemsInView, nextAgendaTick, isRecurring } from '../src/core/agenda/agendaQuery';
import { nextAgendaDue } from '../src/core/agenda/agendaModel';
import type { AgendaItem } from '../src/core/agenda/agendaModel';
import { startOfLocalDay, dayOfWeek, MS_DAY } from '../src/core/temporal/scheduleEngine';

const NOW = new Date(2026, 8, 15, 22, 0, 0, 0).getTime(); // martes 15-sep-2026

function item(id: string, trigger: AgendaItem['trigger']): AgendaItem {
    return {
        id,
        kind: 'alarma',
        label: id,
        trigger,
        status: 'pending',
        sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
    };
}

describe('agendaQuery — vista día/semana/mes', () => {
    it('la ventana del día está alineada al día local', () => {
        const w = agendaWindow('day', NOW);
        expect(w.start).toBe(startOfLocalDay(NOW));
        expect(w.end - w.start).toBe(MS_DAY);
    });

    it('la vista "day" solo incluye lo que vence HOY', () => {
        const hoy = item('hoy', { type: 'absolute', at: NOW + 30 * 60 * 1000 });
        const manana = item('manana', { type: 'absolute', at: startOfLocalDay(NOW) + MS_DAY + 9 * 60 * 60 * 1000 });
        const hoyItems = itemsInView([hoy, manana], 'day', NOW);
        expect(hoyItems.map((i) => i.id)).toEqual(['hoy']);
    });

    it('la vista "week" incluye días posteriores de esta semana', () => {
        // miércoles (día 16) a las 9
        const miercoles = item('miercoles', {
            type: 'absolute',
            at: startOfLocalDay(NOW) + MS_DAY + 9 * 60 * 60 * 1000,
        });
        expect(itemsInView([miercoles], 'week', NOW)).toHaveLength(1);
    });

    it('los items borrados lógicos NO aparecen en ninguna vista', () => {
        const borrado = item('borrado', { type: 'absolute', at: NOW + MS_DAY });
        borrado.status = 'deleted';
        borrado.sync.deleted = true;
        expect(itemsInView([borrado], 'week', NOW)).toEqual([]);
    });
});

describe('agendaQuery — motor de disparo único', () => {
    it('nextAgendaTick devuelve el vencimiento más próximo', () => {
        const lejano = item('lejano', { type: 'absolute', at: NOW + 2 * 60 * 60 * 1000 });
        const cercano = item('cercano', { type: 'absolute', at: NOW + 10 * 60 * 1000 });
        expect(nextAgendaTick([lejano, cercano], NOW)).toBe(NOW + 10 * 60 * 1000);
    });

    it('si algo ya venció, el tick es ese instante (disparar ya)', () => {
        const vencido = item('vencido', { type: 'absolute', at: NOW - 1000 });
        const future = item('futuro', { type: 'absolute', at: NOW + 60 * 60 * 1000 });
        expect(nextAgendaTick([vencido, future], NOW)).toBe(NOW - 1000);
    });

    it('isRecurring distingue absolute de daily/weekly/countdown', () => {
        expect(isRecurring({ type: 'absolute', at: NOW })).toBe(false);
        expect(isRecurring({ type: 'daily', timeOfDay: '09:00' })).toBe(true);
        expect(isRecurring({ type: 'weekly', daysOfWeek: [dayOfWeek(NOW)], timeOfDay: '09:00' })).toBe(true);
        expect(isRecurring({ type: 'countdown', durationMs: 60000 })).toBe(true);
    });
});
