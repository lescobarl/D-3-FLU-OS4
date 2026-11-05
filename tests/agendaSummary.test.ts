// ============================================================
// Prueba de escritorio de la consulta ÚNICA (P2/P6 de la spec)
// ------------------------------------------------------------
// Una sola lista para hoy/semana/mes, con hora y color por tipo; excluye
// borrados lógicos; "mañana" no aparece en "hoy".
// ============================================================
import { describe, it, expect } from 'vitest';
import { summarizeAgenda, agendaSummaryText } from '../src/core/agenda/agendaSummary';
import type { AgendaColorMap, AgendaItem, AgendaKind } from '../src/core/agenda/agendaModel';
import { startOfLocalDay, MS_DAY } from '../src/core/temporal/scheduleEngine';

const NOW = new Date(2026, 8, 15, 22, 0, 0, 0).getTime(); // martes 15-sep

const COLORS: AgendaColorMap = {
    recordatorio: '#f59e0b', cita: '#3b82f6', junta: '#8b5cf6', clase: '#22c55e', alarma: '#ef4444',
};

function item(id: string, kind: AgendaKind, trigger: AgendaItem['trigger']): AgendaItem {
    return { id, kind, label: id, trigger, status: 'pending', sync: { revision: 1, updated_at: '', deleted: false } };
}

describe('agendaSummary — una sola consulta', () => {
    it('hoy: solo lo de HOY, con hora y color por tipo', () => {
        const hoy = item('a', 'alarma', { type: 'absolute', at: NOW + 30 * 60 * 1000 });
        const manana = item('c', 'cita', { type: 'absolute', at: startOfLocalDay(NOW) + MS_DAY + 11 * 60 * 60 * 1000 });
        const r = summarizeAgenda([hoy, manana], 'day', NOW, COLORS);
        expect(r.lines.map((l) => l.id)).toEqual(['a']);
        expect(r.lines[0].time).toBe('22:30');
        expect(r.lines[0].color).toBe('#ef4444');
    });

    it('semana: incluye días posteriores y ordena por día/hora', () => {
        const hoyTarde = item('h', 'alarma', { type: 'absolute', at: NOW + 30 * 60 * 1000 });
        const miercoles = item('m', 'clase', { type: 'absolute', at: startOfLocalDay(NOW) + MS_DAY + 9 * 60 * 60 * 1000 });
        const r = summarizeAgenda([miercoles, hoyTarde], 'week', NOW, COLORS);
        expect(r.lines.map((l) => l.id)).toEqual(['h', 'm']);
    });

    it('los borrados lógicos NO aparecen', () => {
        const borrado = item('b', 'alarma', { type: 'absolute', at: NOW + 1000 });
        borrado.status = 'deleted';
        borrado.sync.deleted = true;
        expect(summarizeAgenda([borrado], 'day', NOW, COLORS).empty).toBe(true);
    });

    it('texto hablable agrupa hora + label', () => {
        const a = item('a', 'alarma', { type: 'absolute', at: NOW + 1000 });
        a.label = 'Despertador';
        const r = summarizeAgenda([a], 'day', NOW, COLORS);
        expect(agendaSummaryText(r, 'es')).toBe('22:00 Despertador');
    });

    it('vacío devuelve el texto por idioma', () => {
        const r = summarizeAgenda([], 'day', NOW, COLORS);
        expect(agendaSummaryText(r, 'es')).toBe('No tienes nada programado.');
        expect(agendaSummaryText(r, 'en')).toBe('Nothing scheduled.');
    });
});
