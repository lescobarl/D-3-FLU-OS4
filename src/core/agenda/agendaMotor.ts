// ============================================================
// src/core/agenda/agendaMotor.ts
// Motor ÚNICO de disparo del calendario unificado (lógica pura).
// ------------------------------------------------------------
// Decide QUÉ está vencido y QUÉ hace cada tipo, sin I/O. El runtime
// (setTimeout + audio/notificación + marcar done) es pegamento del hook.
// Una sola fuente: `nextAgendaDue` (modelo) + `isRecurring`/`nextAgendaTick`
// (consulta). Los schedulers viejos (reminderScheduler/audioAlert) deben
// consumir ESTO al migrar, no reimplementarlo.
// ============================================================
import { agendaTriggerAction, nextAgendaDue, type AgendaItem } from './agendaModel';
import { isRecurring, nextAgendaTick } from './agendaQuery';

export type AgendaFireAction = 'sonar' | 'avisar' | 'marcar';

export interface AgendaFire {
    item: AgendaItem;
    action: AgendaFireAction;
    /** true si el disparo es recurrente (daily/weekly/countdown) y re-tica. */
    recurring: boolean;
}

/** Items pendientes cuya próxima ocurrencia ya venció (disparar ahora). */
export function collectDueFires(items: readonly AgendaItem[], now: number): AgendaFire[] {
    return items
        .filter((item) => item.status === 'pending' && nextAgendaDue(item.trigger, now) <= now)
        .map((item) => ({
            item,
            action: agendaTriggerAction(item.kind),
            recurring: isRecurring(item.trigger),
        }));
}

export interface AgendaCycleResult {
    fires: AgendaFire[];
    /** Próximo vencimiento para el siguiente tick, o null si no queda nada. */
    nextTick: number | null;
}

/**
 * Ciclo del motor: dispara lo vencido y devuelve el próximo tick. El llamador
 * ejecuta `action` por cada fire y, para los NO recurrentes, marca el item
 * `done`; para los recurrentes re-agenda (su próxima ocurrencia ya es futura).
 */
export function runAgendaCycle(items: readonly AgendaItem[], now: number): AgendaCycleResult {
    const fires = collectDueFires(items, now);
    const remaining = items.filter((item) => !fires.some((f) => f.item.id === item.id));
    return { fires, nextTick: nextAgendaTick(remaining, now) };
}
