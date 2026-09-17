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
import { parseTimeOfDayToMs, MS_DAY } from '../temporal/scheduleEngine';
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
    /** Vista de la consulta (agenda.list): hoy/mañana/semana/mes. */
    when?: 'hoy' | 'mañana' | 'semana' | 'mes';
    reply: string;
}

const WAKE_LEAD = /^(?:ok\s*flu|okay\s*flow|hey\s*flu|flu|ok\s*flow)[,.\s]*/i;

const KIND_NOUNS: ReadonlyArray<{ kind: AgendaKind; nouns: readonly string[] }> = Object.freeze([
    { kind: 'alarma', nouns: ['alarma', 'despertador', 'temporizador', 'timer'] },
    { kind: 'recordatorio', nouns: ['recordatorio', 'recuerdame', 'recordame', 'aviso'] },
    { kind: 'cita', nouns: ['cita'] },
    { kind: 'junta', nouns: ['junta', 'reunion', 'reunión', 'meeting'] },
    { kind: 'clase', nouns: ['clase'] },
]);

const CREATE_FRAMES: readonly string[] = Object.freeze([
    'crea', 'crear', 'pon', 'ponme', 'agenda', 'agendar', 'programa', 'programar',
    'genera', 'generar', 'recuerdame', 'recordame', 'despiertame', 'despertame',
    'agrega', 'agregar', 'añade', 'añadir',
]);

const CANCEL_FRAMES: readonly string[] = Object.freeze([
    'cancela', 'cancelar', 'borra', 'borrar', 'quita', 'quitar', 'elimina', 'eliminar',
    'ya no quiero', 'no quiero',
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
const COUNTDOWN_RE = /\b(?:en|de)\s+(\d+)\s+(segundos?|minutos?|horas?)\b/i;

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

/**
 * Kind implícito cuando no hay sustantivo explícito: el dictado escolar
 * "agrega matemáticas el lunes a las 8" (materia + día + hora) es una CLASE.
 * También "quita matemáticas del viernes" (materia + día).
 */
function resolveImplicitKind(text: string, action: AgendaCommandAction | null): AgendaKind | null {
    if (!action) return null;
    const t = normalize(text);
    const isHorario = /\bhorario\b/.test(t);
    const hasWeekday = WEEKDAY_NAMES.some((w) => new RegExp(`\\b${w.name}\\b`).test(t));
    // Cancelar/editar una clase: "quita X del viernes" (día) o "quita X del horario".
    if (action === 'agenda.cancel' || action === 'agenda.update') {
        return hasWeekday || isHorario ? 'clase' : null;
    }
    // Crear una clase exige la HORA ("el lunes a las 8"); sin hora no hay
    // acción accionable (se pide aclaración, no se inventa una hora).
    if (action === 'agenda.create' && pickTimeOfDay(text).timeOfDay && (hasWeekday || isHorario)) return 'clase';
    return null;
}

/** Vista de la consulta "qué hay/tengo <hoy|mañana|esta semana|este mes>". */
function detectQueryView(text: string): AgendaCommand['when'] {
    const t = normalize(text); // sin acentos: "mañana" → "manana"
    if (/\bmanana\b/.test(t)) return 'mañana';
    if (/\b(?:esta\s+semana|semana)\b/.test(t)) return 'semana';
    if (/\b(?:este\s+mes|mes)\b/.test(t)) return 'mes';
    return 'hoy';
}

function detectAction(text: string): AgendaCommandAction | null {
    const t = normalize(text);
    // Consulta ANCLADA: "qué <hay|tengo|...>" al inicio, o "mi agenda/agenda de".
    if (t.startsWith('que ') && /\b(?:hay|tengo|tienes|tiene)\b/.test(t)) return 'agenda.list';
    if (/\b(?:mi agenda|agenda de|agenda para)\b/.test(t)) return 'agenda.list';
    if (CANCEL_FRAMES.some((f) => t.includes(f))) return 'agenda.cancel';
    if (UPDATE_FRAMES.some((f) => t.includes(f))) return 'agenda.update';
    if (CREATE_FRAMES.some((f) => t.includes(f))) return 'agenda.create';
    return null;
}

const WEEKLY_LEAD_RE = /\b(?:los|cada|todos\s+los|todas\s+las)\s+/i;

/** Cualquier día de semana mencionado (con o sin "los"), para CLASES. */
function detectAnyWeekdays(text: string): number[] {
    const t = normalize(text);
    return WEEKDAY_NAMES.filter((w) => new RegExp(`\\b${w.name}\\b`).test(t)).map((w) => w.day);
}

/** Clase = horario semanal: día(s) + hora (el/los/lunes…). */
function resolveClaseTrigger(text: string, now: number): AgendaTrigger | null {
    const days = detectAnyWeekdays(text);
    if (days.length > 0) {
        const time = pickTimeOfDay(text).timeOfDay ?? '09:00';
        return { type: 'weekly', daysOfWeek: days, timeOfDay: time };
    }
    return resolveTrigger(text, now);
}

/** Días de semana SOLO con recurrencia explícita ("los lunes"), no "el jueves". */
function detectWeekdays(text: string): number[] {
    const t = normalize(text);
    const lead = WEEKLY_LEAD_RE.exec(t);
    if (!lead) return [];
    const after = t.slice(lead.index + lead[0].length);
    return WEEKDAY_NAMES.filter((w) => new RegExp(`\\b${w.name}\\b`).test(after)).map((w) => w.day);
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
    if (picked.timeOfDay) {
        // Base: fecha explícita ("hoy/mañana/jueves") o HOY si no la hay ("a las 7").
        const explicitDay = Boolean(nl?.at);
        const baseAt = nl?.at ?? now;
        const day = new Date(baseAt);
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0).getTime()
            + (parseTimeOfDayToMs(picked.timeOfDay) ?? 0);
        // Solo la hora PELADA ("a las 7") cae a la próxima ocurrencia si ya
        // pasó. Con día explícito ("hoy", "mañana", "el jueves") NO se rueda:
        // "hoy a las 9" es hoy, no mañana.
        if (!explicitDay && at <= now) {
            return { type: 'absolute', at: at + MS_DAY };
        }
        return { type: 'absolute', at };
    }
    if (!nl || !nl.at) return null;
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

export function parseAgendaCommand(input: string, options?: { now?: number | (() => number) }): AgendaCommand {
    const rawNow = options?.now;
    const now = typeof rawNow === 'function' ? rawNow() : typeof rawNow === 'number' ? rawNow : Date.now();
    const text = String(input || '').trim();
    const cleaned = text.replace(WAKE_LEAD, ' ').replace(/^[¿¡]+/, '').trim();
    if (!cleaned) return { handled: false, action: null, reply: '' };

    const action = detectAction(cleaned);
    if (action === 'agenda.list') {
        return { handled: true, action, when: detectQueryView(cleaned), reply: '' };
    }

    const kind = detectKind(cleaned) ?? resolveImplicitKind(cleaned, action);
    if (!kind) return { handled: false, action: null, reply: '' };

    // Sin verbo explícito ("reunión del equipo mañana a las 12", "junta hoy"):
    // se interpreta como CREAR si trae cláusula de tiempo. Sin tiempo no hay
    // intención accionable.
    const resolvedAction = action ?? 'agenda.create';

    // El disparo es OBLIGATORIO solo para crear; cancelar/editar identifican
    // el item por kind+label (la fecha puede venir o no). Las CLASES con día
    // de semana son SIEMPRE semanales (es su horario, no una cita puntual).
    const trigger = kind === 'clase'
        ? resolveClaseTrigger(cleaned, now)
        : resolveTrigger(cleaned, now);
    if (!trigger && resolvedAction === 'agenda.create') {
        return { handled: false, action: null, reply: '' };
    }

    const label = resolveLabel(cleaned);
    return {
        handled: true,
        action: resolvedAction,
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
