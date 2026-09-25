// ============================================================
// src/core/agenda/agendaQuery.ts
// Consulta y motor de disparo del calendario unificado (puro, sin I/O).
// ------------------------------------------------------------
// Complementa a `agendaModel.ts` (tipos y reglas) con:
//   - ventanas día/semana/mes (vista unificada);
//   - filtro de items por vista;
//   - próxima ocurrencia vencible (tick) para el MOTOR ÚNICO de disparo.
// Una sola fuente: los módulos viejos (reminderScheduler/audioAlert/etc.)
// deberán consumir ESTO al migrar, no reimplementarlo.
// ============================================================
import {
    startOfLocalDay,
    dayOfWeek,
    MS_DAY,
} from '../temporal/scheduleEngine';
import {
    nextAgendaDue,
    type AgendaItem,
    type AgendaTrigger,
} from './agendaModel';

export type AgendaView = 'day' | 'week' | 'month';

export interface AgendaWindow {
    start: number;
    end: number;
}

/** Ventana [start, end) de la vista, alineada al día local. */
export function agendaWindow(view: AgendaView, now: number): AgendaWindow {
    const start = startOfLocalDay(now);
    if (view === 'day') return { start, end: start + MS_DAY };
    if (view === 'week') {
        // Semana local: de hoy al final del domingo de esta semana.
        const daysUntilSunday = 6 - dayOfWeek(now);
        return { start, end: start + (daysUntilSunday + 1) * MS_DAY };
    }
    // Mes: del 1 de este mes al 1 del siguiente (aproximación por días).
    const date = new Date(now);
    const firstOfMonth = startOfLocalDay(new Date(date.getFullYear(), date.getMonth(), 1).getTime());
    const firstOfNext = startOfLocalDay(new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime());
    return { start: firstOfMonth, end: firstOfNext };
}

/** Items vigentes (no borrados) cuya próxima ocurrencia cae en la vista. */
export function itemsInView(items: readonly AgendaItem[], view: AgendaView, now: number): AgendaItem[] {
    const window = agendaWindow(view, now);
    return items.filter((item) => {
        if (item.status === 'deleted') return false;
        const due = nextAgendaDue(item.trigger, now);
        return due >= window.start && due < window.end;
    });
}

/** ¿El disparo es recurrente (daily/weekly/countdown) o de una vez? */
export function isRecurring(trigger: AgendaTrigger): boolean {
    return trigger.type !== 'absolute';
}

/**
 * Próximo instante (ms) en que vence algo pendiente, o `null` si no hay.
 * El MOTOR ÚNICO hace un solo `setTimeout` a este valor y reevalúa.
 */
export function nextAgendaTick(items: readonly AgendaItem[], now: number): number | null {
    let next: number | null = null;
    for (const item of items) {
        if (item.status !== 'pending') continue;
        const due = nextAgendaDue(item.trigger, now);
        if (due <= now) return due; // algo ya venció: disparar ya
        if (next === null || due < next) next = due;
    }
    return next;
}
