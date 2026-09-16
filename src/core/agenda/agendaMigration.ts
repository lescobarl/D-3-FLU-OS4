// ============================================================
// src/core/agenda/agendaMigration.ts
// Migración PURA (testeable) de las tablas viejas → `agenda`.
// ------------------------------------------------------------
// NO borra nada: copia a la tabla unificada. Los módulos viejos se congelan
// después (Fase B). Mapeo DOCUMENTADO (mejor esfuerzo, reversible):
//   - ReminderRecord  → kind 'cita' si `category === 'cita'`, si no 'recordatorio'.
//   - TemporalItemRecord → 'alarma' (timer se modela como alarma countdown).
// - status: done→done, dismissed/cancelled→deleted (borrado lógico).
// - Se conserva el id viejo (trazabilidad) y la tupla `sync`.
// ============================================================
import type { AgendaItem, AgendaTrigger } from './agendaModel';
import type { ReminderRecord } from '../db/fluDatabase';
import type { TemporalItemRecord } from '../temporal/temporalTypes';

function hhmm(at: number): string {
    const d = new Date(at);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function reminderToAgenda(r: ReminderRecord): AgendaItem {
    let trigger: AgendaTrigger;
    if (r.repeat?.kind === 'daily') {
        trigger = { type: 'daily', timeOfDay: hhmm(r.dueAt) };
    } else if (r.repeat?.kind === 'weekdays' && r.repeat.days?.length) {
        trigger = { type: 'weekly', daysOfWeek: r.repeat.days, timeOfDay: hhmm(r.dueAt) };
    } else {
        trigger = { type: 'absolute', at: r.dueAt };
    }
    return {
        id: r.id,
        kind: r.category === 'cita' ? 'cita' : 'recordatorio',
        label: r.text,
        personId: r.personId,
        trigger,
        status: r.status === 'done' ? 'done' : r.status === 'dismissed' ? 'deleted' : 'pending',
        sync: r.sync,
    };
}

function temporalToAgenda(t: TemporalItemRecord): AgendaItem {
    let trigger: AgendaTrigger;
    if (t.trigger.kind === 'daily') {
        trigger = { type: 'daily', timeOfDay: t.trigger.timeOfDay ?? hhmm(t.nextAt) };
    } else if (t.trigger.kind === 'countdown') {
        trigger = { type: 'countdown', durationMs: t.trigger.durationMs ?? 0 };
    } else {
        trigger = { type: 'absolute', at: t.nextAt };
    }
    return {
        id: t.id,
        kind: 'alarma',
        label: t.label,
        personId: t.personId,
        trigger,
        status: t.status === 'done' ? 'done' : t.status === 'cancelled' ? 'deleted' : 'pending',
        sync: t.sync,
    };
}

export interface LegacyRows {
    reminders?: ReminderRecord[];
    temporals?: TemporalItemRecord[];
}

/** Copia las fuentes viejas a items de agenda (sin dedup ni borrado). */
export function mapLegacyToAgenda(rows: LegacyRows): AgendaItem[] {
    const out: AgendaItem[] = [];
    for (const r of rows.reminders ?? []) out.push(reminderToAgenda(r));
    for (const t of rows.temporals ?? []) out.push(temporalToAgenda(t));
    return out;
}
