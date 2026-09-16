// ============================================================
// Prueba de escritorio del parser ÚNICO de agenda (create/list/cancel)
// ------------------------------------------------------------
// P4 de la spec: "ok flu crea una junta/clase/alarma/... para mañana a las 11"
// → aparece con su fecha correcta; "mañana" ≠ "hoy"; weekly para clases.
// ============================================================
import { describe, it, expect } from 'vitest';
import { parseAgendaCommand } from '../src/core/agenda/agendaCommandParser';
import { localDayDiff } from '../src/core/temporal/scheduleEngine';

const NOW = new Date(2026, 8, 15, 22, 0, 0, 0).getTime(); // martes 15-sep-2026

describe('agenda.intent — create', () => {
    it('"crea una alarma para mañana a las 11" → alarma absolute mañana 11', () => {
        const r = parseAgendaCommand('crea una alarma para mañana a las 11', { now: () => NOW });
        expect(r.handled).toBe(true);
        expect(r.action).toBe('agenda.create');
        expect(r.kind).toBe('alarma');
        expect(r.trigger?.type).toBe('absolute');
        const at = (r.trigger as { at: number }).at;
        expect(localDayDiff(NOW, at)).toBe(1); // mañana ≠ hoy
        expect(new Date(at).getHours()).toBe(11);
    });

    it('"ok flu crea una junta para mañana a las 11" → junta mañana 11', () => {
        const r = parseAgendaCommand('ok flu crea una junta para mañana a las 11', { now: () => NOW });
        expect(r.handled).toBe(true);
        expect(r.kind).toBe('junta');
        expect(r.trigger?.type).toBe('absolute');
    });

    it('"crea una clase los lunes a las 9" → weekly lunes 9', () => {
        const r = parseAgendaCommand('crea una clase los lunes a las 9', { now: () => NOW });
        expect(r.handled).toBe(true);
        expect(r.kind).toBe('clase');
        expect(r.trigger).toEqual({ type: 'weekly', daysOfWeek: [1], timeOfDay: '09:00' });
    });

    it('"pon una alarma en 5 minutos" → countdown 5 min', () => {
        const r = parseAgendaCommand('pon una alarma en 5 minutos', { now: () => NOW });
        expect(r.handled).toBe(true);
        expect(r.kind).toBe('alarma');
        expect(r.trigger).toEqual({ type: 'countdown', durationMs: 5 * 60_000 });
    });

    it('"recuérdame todos los días a las 8" → recordatorio daily', () => {
        const r = parseAgendaCommand('recuérdame todos los días a las 8', { now: () => NOW });
        expect(r.handled).toBe(true);
        expect(r.kind).toBe('recordatorio');
        expect(r.trigger).toEqual({ type: 'daily', timeOfDay: '08:00' });
    });
});

describe('agenda.intent — list/cancel', () => {
    it('"qué hay para hoy" → list', () => {
        expect(parseAgendaCommand('qué hay para hoy').action).toBe('agenda.list');
    });

    it('"qué hay mañana" → list when=mañana', () => {
        const r = parseAgendaCommand('qué hay mañana', { now: () => NOW });
        expect(r.action).toBe('agenda.list');
        expect(r.when).toBe('mañana');
    });

    it('"qué hay esta semana" → list when=semana', () => {
        expect(parseAgendaCommand('qué hay esta semana').when).toBe('semana');
    });

    it('"quita historia del viernes" → cancel clase (por materia+día)', () => {
        const r = parseAgendaCommand('quita historia del viernes', { now: () => NOW });
        expect(r.handled).toBe(true);
        expect(r.action).toBe('agenda.cancel');
        expect(r.kind).toBe('clase');
        expect(r.label).toContain('historia');
    });

    it('"cancela la alarma de las 7" → cancel alarma', () => {
        const r = parseAgendaCommand('cancela la alarma de las 7', { now: () => NOW });
        expect(r.handled).toBe(true);
        expect(r.action).toBe('agenda.cancel');
        expect(r.kind).toBe('alarma');
    });

    it('"agrega matemáticas el lunes a las 8" → clase (dictado escolar)', () => {
        const r = parseAgendaCommand('agrega matemáticas el lunes a las 8', { now: () => NOW });
        expect(r.handled).toBe(true);
        expect(r.action).toBe('agenda.create');
        expect(r.kind).toBe('clase');
        expect(r.trigger?.type).toBe('weekly');
    });

    it('frase sin intención no matchea', () => {
        expect(parseAgendaCommand('hola flu').handled).toBe(false);
    });
});
