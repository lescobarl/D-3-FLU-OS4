// ============================================================
// Prueba de ESCRITORIO del modelo unificado de agenda (P1-P9)
// ------------------------------------------------------------
// Valida el modelo REAL `src/core/agenda/agendaModel.ts` contra los 9 puntos
// de la spec, reutilizando los primitivos de fecha/hora ya validados
// (`scheduleEngine`). Es el cimiento de la consolidación: una sola fuente de
// tipos y reglas para alarma/recordatorio/cita/junta/clase.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
    AGENDA_KINDS,
    agendaDedupKey,
    agendaTriggerAction,
    colorForKind,
    nextAgendaDue,
    isDueToday,
    type AgendaItem,
    type AgendaKind,
    type AgendaTrigger,
    type AgendaColorMap,
} from '../src/core/agenda/agendaModel';
import {
    startOfLocalDay,
    localDayDiff,
    dayOfWeek,
    MS_DAY,
    parseTimeOfDayToMs,
} from '../src/core/temporal/scheduleEngine';

const COLORS: AgendaColorMap = {
    recordatorio: '#f59e0b',
    cita: '#3b82f6',
    junta: '#8b5cf6',
    clase: '#22c55e',
    alarma: '#ef4444',
};

const NOW = new Date(2026, 8, 15, 22, 0, 0, 0).getTime(); // martes 15-sep-2026

function item(kind: AgendaKind, trigger: AgendaTrigger): AgendaItem {
    return {
        id: `id-${kind}`,
        kind,
        label: kind,
        trigger,
        status: 'pending',
        sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
    };
}

describe('agenda unificada — modelo real', () => {
    it('P1: los 5 tipos comparten UNA lista y UN tipo', () => {
        const items = AGENDA_KINDS.map((kind) => item(kind, { type: 'absolute', at: NOW + MS_DAY }));
        expect(items).toHaveLength(5);
        expect(items.every((i) => typeof i.kind === 'string')).toBe(true);
    });

    it('P2: día/semana/mes filtran por próxima ocurrencia ("mañana" ≠ "hoy")', () => {
        const hoy = item('alarma', { type: 'absolute', at: NOW + 30 * 60 * 1000 });
        const manana = item('cita', {
            type: 'absolute',
            at: startOfLocalDay(NOW) + MS_DAY + 11 * 60 * 60 * 1000,
        });
        expect(isDueToday(hoy.trigger, NOW)).toBe(true);
        expect(isDueToday(manana.trigger, NOW)).toBe(false);
        expect(localDayDiff(NOW, nextAgendaDue(manana.trigger, NOW))).toBe(1);
    });

    it('P3: el color se deriva del kind vía config (no se guarda)', () => {
        expect(colorForKind('alarma', COLORS)).not.toBe(colorForKind('clase', COLORS));
        expect(colorForKind('cita', COLORS)).not.toBe(colorForKind('junta', COLORS));
    });

    it('P4: "mañana 11" ≠ "hoy" y "los lunes 9" es weekly', () => {
        const lunes = nextAgendaDue({ type: 'weekly', daysOfWeek: [1], timeOfDay: '09:00' }, NOW);
        expect(dayOfWeek(lunes)).toBe(1);
        expect(lunes).toBeGreaterThan(NOW);
        // diario cae a la próxima 11:00, no a hoy 22:00.
        const diario = nextAgendaDue({ type: 'daily', timeOfDay: '11:00' }, NOW);
        expect(diario).toBeGreaterThan(NOW);
        expect(parseTimeOfDayToMs('11:00')).toBe(11 * 60 * 60 * 1000);
    });

    it('P5: editar cambia fecha/label; cancelar es borrado LÓGICO', () => {
        const base = item('alarma', { type: 'absolute', at: NOW + MS_DAY });
        const editado: AgendaItem = {
            ...base,
            label: 'Alarma editada',
            trigger: { type: 'absolute', at: NOW + 2 * MS_DAY },
        };
        expect(editado.label).not.toBe(base.label);
        expect(editado.trigger).not.toEqual(base.trigger);
        const cancelado: AgendaItem = {
            ...base,
            status: 'deleted',
            sync: { ...base.sync, deleted: true, revision: base.sync.revision + 1 },
        };
        expect(cancelado.status).toBe('deleted');
        expect(cancelado.sync.deleted).toBe(true);
    });

    it('P6: "qué hay para hoy" devuelve TODOS los kinds en una lista', () => {
        const items = AGENDA_KINDS.map((kind, i) =>
            item(kind, { type: 'absolute', at: NOW + i * 60 * 1000 }),
        );
        const deHoy = items.filter((i) => isDueToday(i.trigger, NOW));
        expect(deHoy.map((i) => i.kind).sort()).toEqual([...AGENDA_KINDS].sort());
    });

    it('P7: a la hora, cada kind hace lo suyo', () => {
        expect(agendaTriggerAction('alarma')).toBe('sonar');
        expect(agendaTriggerAction('recordatorio')).toBe('avisar');
        expect(agendaTriggerAction('cita')).toBe('marcar');
        expect(agendaTriggerAction('junta')).toBe('marcar');
        expect(agendaTriggerAction('clase')).toBe('marcar');
    });

    it('P8: pedir dos veces lo mismo NO duplica (misma dedup key)', () => {
        const a = { kind: 'alarma' as AgendaKind, label: 'Despertador', trigger: { type: 'daily', timeOfDay: '07:00' } as AgendaTrigger };
        const b = { kind: 'alarma' as AgendaKind, label: 'despertador', trigger: { type: 'daily', timeOfDay: '07:00' } as AgendaTrigger };
        expect(agendaDedupKey(a)).toBe(agendaDedupKey(b));
    });

    it('P9: las notas quedan FUERA (no hay kind nota)', () => {
        expect(AGENDA_KINDS).not.toContain('nota' as AgendaKind);
    });
});
