// ============================================================
// src/core/agenda/agendaCommandParser.ts
// Parser ÚNICO de CREACIÓN/EDICIÓN/CANCELACIÓN del calendario unificado.
// ------------------------------------------------------------
// Parser ÚNICO del calendario: reconoce create/list/update/cancel para los 5
// kinds (la consulta del día incluida), resolviendo el DISPARO
// (absolute/daily/weekly/countdown) con los utils ya validados:
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
import { stripWakeWord, stripWakeWordAnywhere } from '../../voice/lib/wakeWord.js';
import type { AgendaKind, AgendaTrigger } from './agendaModel';

export type AgendaCommandAction =
    | 'agenda.create'
    | 'agenda.list'
    | 'agenda.update'
    | 'agenda.cancel'
    | 'agenda.clear';

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

// El ASR puede pegar el wake word en MEDIO del eco ("… recordatorio Okay flu crea …"):
// ese barrido lo resuelve `stripWakeWordAnywhere` (vocabulario de FLU_CONFIG), sin regex local.
// Cláusula del recordatorio que NO es contenido: "que me recuerde tomar X",
// "recuérdame X", "acordarme de X". Solo el contenido queda como etiqueta.
const REMINDER_CLAUSE =
    /\b(?:que\s+)?(?:me\s+)?(?:recu[eé]rd[ae]s?|acu[eé]rd[ae]s?|acu[eé]rdate|acu[eé]rdame|recu[eé]rdame|rec[oó]rdame|recordar|recordatorio|recordatorios|aviso)\b/gi;

const KIND_NOUNS: ReadonlyArray<{ kind: AgendaKind; nouns: readonly string[] }> = Object.freeze([
    { kind: 'alarma', nouns: ['alarma', 'despertador', 'temporizador', 'timer', 'despiertame', 'despertame'] },
    { kind: 'recordatorio', nouns: ['recordatorio', 'recuerdame', 'recordame', 'aviso'] },
    { kind: 'cita', nouns: ['cita'] },
    { kind: 'junta', nouns: ['junta', 'reunion', 'reunión', 'meeting'] },
    { kind: 'clase', nouns: ['clase'] },
]);

const CREATE_FRAMES: readonly string[] = Object.freeze([
    'crea', 'crear', 'pon', 'ponme', 'agenda', 'agendar', 'programa', 'programar',
    'genera', 'generar', 'recuerdame', 'recordame', 'despiertame', 'despertame',
    'agrega', 'agregar', 'añade', 'añadir', 'hazme', 'haz', 'arma', 'armar',
    'prepara', 'preparar', 'apunta',
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
/** Recurrencia de CLASE "toda la semana / todos los días" = horario de 7 días. */
const CLASE_ALL_DAYS_RE = /\b(?:toda\s+la\s+semana|toda\s+semana|todos\s+los\s+d[ií]as|cada\s+d[ií]a|diario|diariamente)\b/i;
const COUNTDOWN_RE = /\b(?:en|de)\s+(\d+)\s+(segundos?|minutos?|horas?)\b/i;

function normalize(text: string): string {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Colapsa tartamudeo de prefijo: "bor borra" → "borra". */
function collapseStutter(text: string): string {
    return String(text || '').replace(/\b(\S{1,3})\s+(?=\1\S+)/gi, '');
}

/** Colapsa tartamudeo de cuantificador: "todo toda" → "toda", "todo todo" → "todo". */
function collapseQuantifierStutter(text: string): string {
    return String(text || '').replace(/\b(todo|toda|todos|todas)\s+(?=(todo|toda|todos|todas)\b)/gi, '');
}

/** Colapsa frase repetida inmediata: "6 de la 6 de la tarde" → "6 de la tarde". */
function collapseRepeatedPhrase(text: string): string {
    return String(text || '').replace(/\b((?:\d{1,2}\s+de\s+la\s+)|(?:\S+\s+\S+\s+\S+\s+))(?=\1)/gi, '');
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
    // Recurrencia explícita ("toda la semana", "todos los días") también es clase.
    const isRecurring = /(?:toda\s+la\s+semana|toda\s+semana|todos\s+los\s+d[ií]as|cada\s+d[ií]a|diario|diariamente)/i.test(t);
    // Cancelar/editar una clase: "quita X del viernes" (día) o "quita X del horario".
    if (action === 'agenda.cancel' || action === 'agenda.update') {
        return hasWeekday || isHorario ? 'clase' : null;
    }
    // Crear una clase exige la HORA ("el lunes a las 8"); sin hora no hay
    // acción accionable (se pide aclaración, no se inventa una hora).
    if (action === 'agenda.create' && pickTimeOfDay(text).timeOfDay && (hasWeekday || isHorario || isRecurring)) {
        return 'clase';
    }
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
    // Consulta ANCLADA: exige un término de AGENDA o un marcador temporal; el
    // solo "qué … tienes/hay" NO alcanza (antes "qué otro juego tienes" devolvía
    // la agenda en vez de ir a la IA / al menú de juegos).
    if (
        t.startsWith('que ') &&
        /\b(?:hay|tengo|tienes|tiene)\b/.test(t) &&
        /\b(?:agenda|calendario|cita|citas|recordatorio|recordatorios|alarma|alarmas|clase|clases|junta|juntas|actividad|actividades|evento|eventos|pendiente|pendientes|horario)\b/.test(t)
    ) {
        return 'agenda.list';
    }
    if (
        t.startsWith('que ') &&
        /\b(?:hay|tengo|tienes|tiene)\b/.test(t) &&
        /\b(?:hoy|manana|semana|mes)\b/.test(t)
    ) {
        return 'agenda.list';
    }
    if (/\b(?:mi agenda|agenda de|agenda para)\b/.test(t)) return 'agenda.list';
    // Consulta del día con verbo de petición ("dime qué hay … hoy") y su forma
    // interrogativa en inglés. Antes vivía duplicada en `agendaIntentParser`;
    // ahora el reconocimiento es UNO (este parser) y el otro solo lo adapta.
    if (
        /^(?:dime|dame|cuentame|platicame|muestra|muestrame|ensename|ver)\b/.test(t) &&
        /\bque\s+(?:hay|tengo|tienes|tiene)\b/.test(t) &&
        /\b(?:hoy|manana|semana|mes|dia)\b/.test(t)
    ) {
        return 'agenda.list';
    }
    if (
        /^(?:agenda|plan|resumen|resumeme)\s*(?:de\s+|del\s+|para\s+(?:el\s+|la\s+)?)?(?:hoy|el\s+dia|mi\s+dia)\b/.test(t) ||
        /^(?:dime|muestra|muestrame|dame|ver|ensename)\s+(?:mi\s+|la\s+|el\s+)?(?:agenda|plan|resumen|dia)\b/.test(t) ||
        /^what(?:'s| is)?\s+(?:on|up|do\s+i\s+have)\s*(?:for\s+)?(?:today|my\s+day)\b/.test(t) ||
        /^(?:my|today'?s)\s+(?:agenda|schedule|plan)\b/.test(t) ||
        /^show\s+(?:me\s+)?(?:my\s+)?(?:agenda|day|plan)\b/.test(t)
    ) {
        return 'agenda.list';
    }
    // "borra/limpia TODO/TODA la agenda/el calendario" → vaciar todo.
    // Conectores flexibles: "todo lo de la agenda", "todo el contenido de la
    // agenda", "toda la agenda", "limpia el calendario".
    if (/(?:borra|borrar|limpia|limpiar|vacia|vaciar|elimina|eliminar|quita|quitar)\s+(?:todo|toda|todos|todas)?\s*(?:el|la|lo)?\s*(?:contenido\s+)?(?:de\s+la\s+|de\s+el\s+|del\s+|de\s+|en\s+el\s+|en\s+la\s+)?(?:agenda|calendario)\b/i.test(t)) return 'agenda.clear';
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

/** Días de semana SOLO con recurrencia explícita ("los lunes"), no "el jueves". */
function detectWeekdays(text: string): number[] {
    const t = normalize(text);
    const lead = WEEKLY_LEAD_RE.exec(t);
    if (!lead) return [];
    const after = t.slice(lead.index + lead[0].length);
    return WEEKDAY_NAMES.filter((w) => new RegExp(`\\b${w.name}\\b`).test(after)).map((w) => w.day);
}

/**
 * Resolutor ÚNICO de recurrencia (clase y resto de kinds).
 * Precedencia: countdown → días nombrados → diario → absoluto.
 * Los días nombrados GANAN sobre "todos los días" (no al revés): así
 * "todos los días los lunes" es semanal (lunes), no diario.
 *   - CLASES: aceptan cualquier día nombrado ("el lunes").
 *   - Resto: exigen recurrencia explícita ("los lunes"), no "el jueves".
 * "todos los días" en una clase = horario semanal de 7 días; en el resto, daily.
 */
function resolveRecurrence(text: string, now: number, kind: AgendaKind): AgendaTrigger | null {
    const t = normalize(text);

    const countdown = COUNTDOWN_RE.exec(t);
    if (countdown) {
        const amount = Number(countdown[1]);
        const unit = normalize(countdown[2]);
        const ms = unit.startsWith('seg') ? 1000 : unit.startsWith('min') ? 60_000 : 3_600_000;
        return { type: 'countdown', durationMs: amount * ms };
    }

    const days = kind === 'clase' ? detectAnyWeekdays(text) : detectWeekdays(text);
    if (days.length > 0) {
        const time = pickTimeOfDay(text).timeOfDay ?? '09:00';
        return { type: 'weekly', daysOfWeek: days, timeOfDay: time };
    }

    const allDays = kind === 'clase' ? CLASE_ALL_DAYS_RE.test(t) : DAILY_RE.test(t);
    if (allDays) {
        const timeOfDay = pickTimeOfDay(text).timeOfDay ?? '09:00';
        return kind === 'clase'
            ? { type: 'weekly', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], timeOfDay }
            : { type: 'daily', timeOfDay };
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

/**
 * Regex con fronteras de palabra Unicode: `\b` de JS trata las letras
 * acentuadas como NO-palabra, así que "miércoles" se partía con el filler
 * `mi` → "ércoles". Esto evita ese bug en toda la limpieza de etiqueta.
 */
function wordRe(alternation: string): RegExp {
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`, 'giu');
}

function resolveLabel(text: string): string {
    // 1) Wake word en CUALQUIER posición (el eco del ASR lo mete en medio).
    const base = stripWakeWordAnywhere(text);
    // 2) Quitar la HORA con el MISMO selector único (pickTimeOfDay): maneja
    //    "a las 3 de la tarde", "a las 4 p.m.", "mañana a las 3", etc.
    // 3) Quitar la cláusula del recordatorio ("que me recuerde", "recuérdame"…).
    let label = pickTimeOfDay(base).rest || base;
    label = label.replace(REMINDER_CLAUSE, ' ');
    for (const noun of KIND_NOUNS.flatMap((e) => e.nouns)) {
        label = label.replace(wordRe(noun), ' ');
    }
    for (const verb of [...CREATE_FRAMES, ...CANCEL_FRAMES, ...UPDATE_FRAMES]) {
        label = label.replace(wordRe(verb), ' ');
    }
    // Verbos de alarma con acento ("despiértame"): el verbo de la lista es
    // ASCII y no matchea con acento → se limpia aparte, tolerante a acentos.
    label = label.replace(wordRe('despi[eé]rt[aá]me|despert[aá]me|despi[eé]rta'), ' ');
    label = label
        // Frases de recurrencia COMPLETAS antes de los stopwords: si se quita
        // "los" primero, "todos los días" queda "todos días" y ya no casa.
        .replace(wordRe('toda\\s+la\\s+semana|toda\\s+semana|todos\\s+los\\s+d[ií]as|cada\\s+semana|cada\\s+d[ií]a|semanalmente|semanal|diario|diariamente|semana'), ' ')
        .replace(wordRe('una|un|el|la|los|las|mi|para|de|al|del|a|con|es|son|sera|será'), ' ')
        .replace(wordRe('manana|mañana|hoy|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|tarde|noche|madrugada'), ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    if (label) return label;
    // Sin contenido: etiqueta = sustantivo CANÓNICO del tipo ("alarma",
    // "recordatorio", "cita"), no el verbo crudo. La detección se hace sobre el
    // texto normalizado para que el acento no impida encontrar el tipo.
    const baseNorm = normalize(base);
    const kindEntry = KIND_NOUNS.find((entry) => entry.nouns.some((noun) => wordRe(noun).test(baseNorm)));
    return kindEntry ? kindEntry.nouns[0] : base;
}

export function parseAgendaCommand(input: string, options?: { now?: number | (() => number) }): AgendaCommand {
    const rawNow = options?.now;
    const now = typeof rawNow === 'function' ? rawNow() : typeof rawNow === 'number' ? rawNow : Date.now();
    const text = String(input || '').trim();
    const cleaned = collapseRepeatedPhrase(
        collapseQuantifierStutter(
            collapseStutter(stripWakeWord(text).replace(/^[¿¡]+/, '')),
        ),
    ).replace(/\s+/g, ' ').trim();
    if (!cleaned) return { handled: false, action: null, reply: '' };

    const action = detectAction(cleaned);
    if (action === 'agenda.list') {
        return { handled: true, action, when: detectQueryView(cleaned), reply: '' };
    }
    if (action === 'agenda.clear') {
        return { handled: true, action, reply: '' };
    }

    const kind = detectKind(cleaned) ?? resolveImplicitKind(cleaned, action);
    if (!kind) return { handled: false, action: null, reply: '' };

    // Sin verbo explícito ("reunión del equipo mañana a las 12", "junta hoy"):
    // se interpreta como CREAR si trae cláusula de tiempo. Sin tiempo no hay
    // intención accionable.
    const resolvedAction = action ?? 'agenda.create';

    // El disparo es OBLIGATORIO solo para crear; cancelar/editar identifican
    // el item por kind+label (la fecha puede venir o no). Un ÚNICO resolutor de
    // recurrencia atiende clases y resto de kinds (sin dos gramáticas).
    const trigger = resolveRecurrence(cleaned, now, kind);
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
