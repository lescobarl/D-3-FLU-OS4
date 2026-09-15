// ============================================================
// src/core/agenda/agendaCommandParser.ts
// Parser ÚNICO de CREACIÓN/EDICIÓN/CANCELACIÓN del calendario unificado.
// ------------------------------------------------------------
// Complementa a `agendaIntentParser.ts` (la consulta "qué hay para hoy"):
// este reconoce create/list/update/cancel para los 5 kinds, resolviendo el
// DISPARO (absolute/daily/weekly/countdown) con los utils ya validados:
//   - `parseNlDateTime`  → fechas relativas/absolutas (mañana, jueves, 17 de…).
//   - `pickTimeOfDay`    → hora "HH:MM" y resto sin hora.
//   - `parseTimeOfDayToMs` → "HH:MM" → ms desde medianoche.
// Una sola gramática: los 3 parsers viejos deben migrar AQUÍ y luego borrarse.
// ============================================================
import {
    parseNlDateTime,
    describeNlDateTime,
} from '../reminders/nlDateParser';
import { pickTimeOfDay } from '../temporal/timeOfDay';
import { parseTimeOfDayToMs } from '../temporal/scheduleEngine';
import type { AgendaKind, AgendaTrigger } from './agendaModel';

export type AgendaCommandAction =
    | 'agenda.create'
    | 'agenda.list'
    | 'agenda.update'
    | 'agenda.cancel';

export interface AgendaCommand {
    handled: boolean;
    action: AgendaCommandAction | null;
    kind?: AgendaKind;
    label?: string;
    trigger?: AgendaTrigger;
    reply: string;
}

const WAKE_LEAD = /^(?:ok\s*flu|okay\s*flow|hey\s*flu|flu|ok\s*flow)[,.\s]*/i;

const KIND_NOUNS: ReadonlyArray<{ kind: AgendaKind; nouns: readonly string[] }> = Object.freeze([
    { kind: 'alarma', nouns: ['alarma', 'despertador'] },
    { kind: 'recordatorio', nouns: ['recordatorio', 'recuerdame', 'recordame', 'aviso'] },
    { kind: 'cita', nouns: ['cita'] },
    { kind: 'junta', nouns: ['junta', 'reunion', 'reunión', 'meeting'] },
    { kind: 'clase', nouns: ['clase'] },
]);

const CREATE_FRAMES: readonly string[] = Object.freeze([
    'crea', 'crear', 'pon', 'ponme', 'agenda', 'agendar', 'programa', 'programar',
    'genera', 'generar', 'recuerdame', 'recordame', 'despiertame', 'despertame',
]);

const LIST_FRAMES: readonly string[] = Object.freeze([
    'que hay', 'que tengo', 'que tienes', 'agenda de', 'agenda para', 'mi agenda',
]);

const CANCEL_FRAMES: readonly string[] = Object.freeze([
    'cancela', 'cancelar', 'borra', 'borrar', 'quita', 'quitar', 'elimina', 'eliminar',
]);

const UPDATE_FRAMES: readonly string[] = Object.freeze([
    'cambia', 'cambiar', 'mueve', 'mover', 'edita', 'editar', 'pospon', 'posponer',
]);

const WEEKDAY_NAMES: ReadonlyArray<{ name: string; day: number }> = Object.freeze([
    { name: 'domingo', day: 0 },
    { name: 'lunes', day: 1 },
    { name: 'martes', day: 2 },
    { name: 'miercoles', day: 3 },
    { name: 'jueves', day: 4 },
    { name: 'viernes', day: 5 },
    { name: 'sabado', day: 6 },
]);

const DAILY_RE = /\b(?:todos\s+los\s+d[ií]as|cada\s+d[ií]a|diario|diariamente)\b/i;
const COUNTDOWN_RE = /\ben\s+(\d+)\s+(segundos?|minutos?|horas?)\b/i;

function normalize(text: string): string {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function detectKind(text: string): AgendaKind | null {
    const t = normalize(text);
    for (const entry of KIND_NOUNS) {
        if (entry.nouns.some((noun) => new RegExp(`\\b${noun}\\b`).test(t))) return entry.kind;
    }
    return null;
}

function detectAction(text: string): AgendaCommandAction | null {
    const t = normalize(text);
    if (LIST_FRAMES.some((f) => t.includes(f))) return 'agenda.list';
    if (CANCEL_FRAMES.some((f) => t.includes(f))) return 'agenda.cancel';
    if (UPDATE_FRAMES.some((f) => t.includes(f))) return 'agenda.update';
    if (CREATE_FRAMES.some((f) => t.includes(f))) return 'agenda.create';
    return null;
}

function detectWeekdays(text: string): number[] {
    const t = normalize(text);
    return WEEKDAY_NAMES.filter((w) => new RegExp(`\\b${w.name}\\b`).test(t)).map((w) => w.day);
}

function resolveTrigger(text: string, now: number): AgendaTrigger | null {
    const countdown = COUNTDOWN_RE.exec(normalize(text));
    if (countdown) {
        const amount = Number(countdown[1]);
        const unit = normalize(countdown[2]);
        const ms = unit.startsWith('seg') ? 1000 : unit.startsWith('min') ? 60_000 : 3_600_000;
        return { type: 'countdown', durationMs: amount * ms };
    }

    if (DAILY_RE.test(normalize(text))) {
        const time = pickTimeOfDay(text).timeOfDay ?? '09:00';
        return { type: 'daily', timeOfDay: time };
    }

    const weekdays = detectWeekdays(text);
    if (weekdays.length > 0) {
        const time = pickTimeOfDay(text).timeOfDay ?? '09:00';
        return { type: 'weekly', daysOfWeek: weekdays, timeOfDay: time };
    }

    const picked = pickTimeOfDay(text);
    const dateText = picked.rest || text;
    const nl = parseNlDateTime(dateText, { now: () => now });
    if (!nl || !nl.at) return null;
    if (picked.timeOfDay) {
        const day = new Date(nl.at);
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0).getTime()
            + (parseTimeOfDayToMs(picked.timeOfDay) ?? 0);
        return { type: 'absolute', at };
    }
    return { type: 'absolute', at: nl.at };
}

function resolveLabel(text: string): string {
    const withoutWake = text.replace(WAKE_LEAD, '').trim();
    let label = withoutWake;
    for (const noun of KIND_NOUNS.flatMap((e) => e.nouns)) {
        label = label.replace(new RegExp(`\\b${noun}\\b`, 'i'), '');
    }
    for (const verb of [...CREATE_FRAMES, ...CANCEL_FRAMES, ...UPDATE_FRAMES]) {
        label = label.replace(new RegExp(`\\b${verb}\\b`, 'i'), '');
    }
    label = label
        .replace(/\b(?:una|un|el|la|los|las|mi|para|de)\b/gi, ' ')
        .replace(/\b(?:manana|hoy|lunes|martes|miercoles|jueves|viernes|sabado|domingo|a\s+las\s+\d{1,2}(?::\d{2})?(?:\s*(?:a\.?\s*m\.?|p\.?\s*m\.?))?|en\s+\d+\s+(?:segundos?|minutos?|horas?))\b/gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    return label || withoutWake;
}

export function parseAgendaCommand(input: string, options?: { now?: () => number }): AgendaCommand {
    const now = options?.now?.() ?? Date.now();
    const text = String(input || '').trim();
    const cleaned = text.replace(WAKE_LEAD, ' ').replace(/^[¿¡]+/, '').trim();
    if (!cleaned) return { handled: false, action: null, reply: '' };

    const action = detectAction(cleaned);
    if (!action) return { handled: false, action: null, reply: '' };

    if (action === 'agenda.list') {
        return { handled: true, action, reply: '' };
    }

    const kind = detectKind(cleaned);
    if (!kind) return { handled: false, action: null, reply: '' };

    // El disparo es OBLIGATORIO solo para crear; cancelar/editar identifican
    // el item por kind+label (la fecha puede venir o no).
    const trigger = resolveTrigger(cleaned, now);
    if (!trigger && action === 'agenda.create') {
        return { handled: false, action: null, reply: '' };
    }

    const label = resolveLabel(cleaned);
    return {
        handled: true,
        action,
        kind,
        label,
        trigger: trigger ?? undefined,
        reply: '',
    };
}

export function describeAgendaTrigger(trigger: AgendaTrigger, now: number): string {
    switch (trigger.type) {
        case 'countdown':
            return `${Math.round(trigger.durationMs / 60000)} min`;
        case 'daily':
            return `todos los días a las ${trigger.timeOfDay}`;
        case 'weekly': {
            const names = trigger.daysOfWeek
                .map((d) => WEEKDAY_NAMES.find((w) => w.day === d)?.name ?? '')
                .filter(Boolean)
                .join(' y ');
            return `los ${names} a las ${trigger.timeOfDay}`;
        }
        case 'absolute':
            return describeNlDateTime(trigger.at);
    }
}
