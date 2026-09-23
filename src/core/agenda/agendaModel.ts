// ============================================================
// src/core/agenda/agendaModel.ts
// Modelo ÚNICO del calendario unificado (plan de consolidación de agenda).
// ------------------------------------------------------------
// Una sola fuente de tipos y reglas para alarmas, recordatorios, citas,
// juntas y clases. Los módulos viejos (reminder/temporal/horario) deben
// migrar AQUÍ y luego borrarse (sin doble ruta).
//
// Decisiones de diseño (declaradas, no supuestas):
//   - `trigger` es UN SOLO campo (type + parámetros); NO hay `recurrence`.
//   - `personId` es parte de la fila (multiusuario).
//   - `color` se DERIVA de FLU_CONFIG.agenda.colors[kind] en LECTURA (no se guarda).
//   - Las notas NO son agenda (texto, sin fecha) → no existe kind 'nota'.
//   - dedup key = kind + label normalizado + trigger serializado.
// ============================================================
import {
    startOfLocalDay,
    localDayDiff,
    dayOfWeek,
    MS_DAY,
    parseTimeOfDayToMs,
} from '../temporal/scheduleEngine';
import type { SyncTuple } from '../db/fluDatabase';
import { stripDiacriticsLower } from '../../lib/textUtils';

export type AgendaKind = 'recordatorio' | 'cita' | 'junta' | 'clase' | 'alarma';

export type AgendaTrigger =
    | { type: 'absolute'; at: number }
    | { type: 'daily'; timeOfDay: string }
    | { type: 'weekly'; daysOfWeek: number[]; timeOfDay: string }
    | { type: 'countdown'; durationMs: number };

export type AgendaStatus = 'pending' | 'done' | 'deleted';

export interface AgendaItem {
    id: string;
    kind: AgendaKind;
    label: string;
    personId?: string;
    trigger: AgendaTrigger;
    status: AgendaStatus;
    /** Tupla de sincronización (§3.7) vía `buildSyncTuple`. */
    sync: SyncTuple;
    /** Hora de fin 'HH:MM' (solo `clase` con trigger weekly). */
    fin?: string;
    /** Lugar opcional (aula, consultorio, oficina…). */
    aula?: string;
}

export const AGENDA_KINDS: readonly AgendaKind[] = Object.freeze([
    'recordatorio',
    'cita',
    'junta',
    'clase',
    'alarma',
]);

/** Mapa de color por tipo (la config es la fuente de los valores). */
export type AgendaColorMap = Record<AgendaKind, string>;

export function colorForKind(kind: AgendaKind, colors: AgendaColorMap): string {
    return colors[kind];
}

/** Acción que ejecuta el motor de disparo cuando vence (P7 de la spec). */
export function agendaTriggerAction(kind: AgendaKind): 'sonar' | 'avisar' | 'marcar' {
    if (kind === 'alarma') return 'sonar';
    if (kind === 'recordatorio') return 'avisar';
    return 'marcar'; // cita / junta / clase
}

/** Normaliza una etiqueta para el dedup (sin acentos, minúsculas, recortada). */
export function normalizeAgendaLabel(label: string): string {
    return stripDiacriticsLower(label || '').trim();
}

/** Clave de dedup: mismo tipo + misma etiqueta + mismo disparo ⇒ no duplica. */
export function agendaDedupKey(
    item: Pick<AgendaItem, 'kind' | 'label' | 'trigger'>,
): string {
    return `${item.kind}|${normalizeAgendaLabel(item.label)}|${JSON.stringify(item.trigger)}`;
}

/** "HH:MM" → ms desde la medianoche (0 si no parseable). */
function timeOfDayMs(timeOfDay: string): number {
    return parseTimeOfDayToMs(timeOfDay) ?? 0;
}

/** Próxima ocurrencia de un disparo a partir de `now`. */
export function nextAgendaDue(trigger: AgendaTrigger, now: number): number {
    switch (trigger.type) {
        case 'absolute':
            return trigger.at;
        case 'countdown':
            return now + trigger.durationMs;
        case 'daily': {
            const start = startOfLocalDay(now);
            let at = start + timeOfDayMs(trigger.timeOfDay);
            if (at <= now) at += MS_DAY;
            return at;
        }
        case 'weekly': {
            const start = startOfLocalDay(now);
            const todayDow = dayOfWeek(now);
            const days = [...trigger.daysOfWeek].sort((a, b) => a - b);
            const target = days.find((d) => d > todayDow) ?? days[0];
            let delta = target - todayDow;
            if (delta <= 0) delta += 7;
            return start + delta * MS_DAY + timeOfDayMs(trigger.timeOfDay);
        }
    }
}

/** ¿El item vence HOY? (vista "hoy"). */
export function isDueToday(trigger: AgendaTrigger, now: number): boolean {
    return localDayDiff(now, nextAgendaDue(trigger, now)) === 0;
}
