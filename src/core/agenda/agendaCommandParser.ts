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
} from '../reminders/nlDateParser';
import { pickTimeOfDay, scanTimesOfDay, stripTimesOfDay } from '../temporal/timeOfDay';
import { parseTimeOfDayToMs, MS_DAY } from '../temporal/scheduleEngine';
import { WEEKDAYS_ES } from '../temporal/calendarNames';
import { normalizeSpokenCommand } from '../../voice/lib/audioMath';
import type { AgendaKind, AgendaTrigger } from './agendaModel';
import { normalizeForMatchExact } from '../../lib/textUtils';

// La normalizacion tiene dueno en src/lib/textUtils.ts: aqui se usa la variante que NO
// colapsa espacios internos (contrato exacto), que es el comportamiento que este parser
// tenia con su copia local.

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
    /**
     * Alcance por día de una CANCELACIÓN: el usuario nombró días concretos
     * ("borra la clase de historia del jueves") y solo esos deben caer, no la
     * serie entera. Sin esto el matcher solo ve kind+label, casa toda la serie
     * (martes y jueves) y borra más de lo pedido.
     */
    scopeDays?: number[];
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
    { kind: 'alarma', nouns: ['alarma', 'alarmas', 'despertador', 'despertadores', 'temporizador', 'temporizadores', 'timer', 'timers', 'despiertame', 'despertame'] },
    { kind: 'recordatorio', nouns: ['recordatorio', 'recordatorios', 'recuerdame', 'recordame', 'aviso', 'avisos'] },
    { kind: 'cita', nouns: ['cita', 'citas'] },
    { kind: 'junta', nouns: ['junta', 'reunion', 'reunión', 'meeting', 'juntas', 'reuniones', 'meetings'] },
    { kind: 'clase', nouns: ['clase', 'clases'] },
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

const WEEKDAY_NAMES = WEEKDAYS_ES;

const DAILY_RE = /\b(?:todos\s+los\s+d[ií]as|cada\s+d[ií]a|diario|diariamente)\b/i;
/** Recurrencia de CLASE "toda la semana / todos los días" = horario de 7 días. */
const CLASE_ALL_DAYS_RE = /\b(?:toda\s+la\s+semana|toda\s+semana|todos\s+los\s+d[ií]as|cada\s+d[ií]a|diario|diariamente)\b/i;
const COUNTDOWN_RE = /\b(?:en|de|in)\s+(\d+)\s+(segundos?|minutos?|horas?|seconds?|minutes?|hours?)\b/i;


/** Colapsa tartamudeo de cuantificador: "todo toda" → "toda", "todo todo" → "todo". */
function collapseQuantifierStutter(text: string): string {
    return String(text || '').replace(/\b(todo|toda|todos|todas)\s+(?=(todo|toda|todos|todas)\b)/gi, '');
}

/** Colapsa frase repetida inmediata: "6 de la 6 de la tarde" → "6 de la tarde". */
function collapseRepeatedPhrase(text: string): string {
    return String(text || '').replace(/\b((?:\d{1,2}\s+de\s+la\s+)|(?:\S+\s+\S+\s+\S+\s+))(?=\1)/gi, '');
}

function detectKind(text: string): AgendaKind | null {
    const t = normalizeForMatchExact(text);
    for (const entry of KIND_NOUNS) {
        if (entry.nouns.some((noun) => new RegExp(`\\b${noun}\\b`).test(t))) return entry.kind;
    }
    return null;
}

/** Día nombrado u "horario": acota la serie por día (cancelar/editar). */
function hasNamedDay(text: string): boolean {
    const t = normalizeForMatchExact(text);
    return /\bhorario\b/.test(t) || WEEKDAY_NAMES.some((w) => new RegExp(`\\b${w.name}\\b`).test(t));
}

/** Recurrencia explícita ("toda la semana", "todos los días"): también es CLASE. */
function hasExplicitRecurrence(text: string): boolean {
    return /(?:toda\s+la\s+semana|toda\s+semana|todos\s+los\s+d[ií]as|cada\s+d[ií]a|diario|diariamente)/i.test(
        normalizeForMatchExact(text),
    );
}

/**
 * Kind implícito cuando no hay sustantivo explícito: el dictado escolar
 * "agrega matemáticas el lunes a las 8" (materia + día + hora) es una CLASE.
 * También "quita matemáticas del viernes" (materia + día).
 */
function resolveImplicitKind(text: string, action: AgendaCommandAction | null): AgendaKind | null {
    if (!action) return null;
    // Cancelar/editar una clase: "quita X del viernes" (día) o "quita X del horario".
    if (action === 'agenda.cancel' || action === 'agenda.update') {
        return hasNamedDay(text) ? 'clase' : null;
    }
    // Crear una clase exige la HORA ("el lunes a las 8"); sin hora no hay
    // acción accionable (se pide aclaración, no se inventa una hora).
    if (action === 'agenda.create' && pickTimeOfDay(text).timeOfDay && (hasNamedDay(text) || hasExplicitRecurrence(text))) {
        return 'clase';
    }
    return null;
}

/** Vista de la consulta "qué hay/tengo <hoy|mañana|esta semana|este mes>". */
function detectQueryView(text: string): AgendaCommand['when'] {
    const t = normalizeForMatchExact(text); // sin acentos: "mañana" → "manana"
    if (/\bmanana\b/.test(t)) return 'mañana';
    if (/\b(?:esta\s+semana|semana)\b/.test(t)) return 'semana';
    if (/\b(?:este\s+mes|mes)\b/.test(t)) return 'mes';
    return 'hoy';
}

function detectAction(text: string): AgendaCommandAction | null {
    const t = normalizeForMatchExact(text);
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
    const t = normalizeForMatchExact(text);
    const named = WEEKDAY_NAMES.filter((w) => new RegExp(`\\b${w.name}\\b`).test(t)).map((w) => w.day);
    return withDayRange(t, named);
}

/**
 * Rango de días inclusivo ("de lunes a viernes", "desde el martes hasta el jueves").
 * Un rango NO es una lista de dos elementos: es la secuencia completa. Antes
 * "de lunes a viernes" daba [1, 5] (lunes y viernes) y guardaba un horario falso
 * sin avisar. La alternancia de días se deriva de WEEKDAY_NAMES (fuente única).
 */
const DAY_RANGE_RE = new RegExp(
    `\\b(?:de|desde|entre)\\s+(?:el\\s+)?(${WEEKDAY_NAMES.map((w) => w.name).join('|')})`
        + `\\s+(?:a|hasta|y)\\s+(?:el\\s+)?(${WEEKDAY_NAMES.map((w) => w.name).join('|')})\\b`,
    'i',
);

function expandDayRange(t: string): number[] {
    const match = DAY_RANGE_RE.exec(t);
    if (!match) return [];
    const from = WEEKDAY_NAMES.find((w) => w.name === match[1]);
    const to = WEEKDAY_NAMES.find((w) => w.name === match[2]);
    if (!from || !to) return [];
    const days: number[] = [];
    for (let day = from.day; days.length < 7; day = (day + 1) % 7) {
        days.push(day);
        if (day === to.day) break;
    }
    return days;
}

/** Días nombrados + rango inclusivo, sin duplicados y en orden ascendente. */
function withDayRange(t: string, named: number[]): number[] {
    return [...new Set([...named, ...expandDayRange(t)])].sort((a, b) => a - b);
}

/** Días de semana SOLO con recurrencia explícita ("los lunes"), no "el jueves". */
function detectWeekdays(text: string): number[] {
    const t = normalizeForMatchExact(text);
    const lead = WEEKLY_LEAD_RE.exec(t);
    // Un rango ("de lunes a viernes") ya es recurrencia explícita: no exige "los".
    const range = expandDayRange(t);
    if (!lead) return range;
    const after = t.slice(lead.index + lead[0].length);
    const named = WEEKDAY_NAMES.filter((w) => new RegExp(`\\b${w.name}\\b`).test(after)).map((w) => w.day);
    return withDayRange(t, named);
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
function resolveRecurrence(
    text: string,
    now: number,
    kind: AgendaKind,
    timeHint?: string | null,
): AgendaTrigger | null {
    const t = normalizeForMatchExact(text);

    const countdown = COUNTDOWN_RE.exec(t);
    if (countdown) {
        const amount = Number(countdown[1]);
        const unit = normalizeForMatchExact(countdown[2]);
        const ms =
            unit.startsWith('seg') || unit.startsWith('sec')
                ? 1000
                : unit.startsWith('min')
                  ? 60_000
                  : 3_600_000;
        return { type: 'countdown', durationMs: amount * ms };
    }

    // Hora ELEGIDA: el consumidor puede fijarla. Un cambio de hora ("de las siete
    // a las ocho") mueve al DESTINO; sin esto ganaría la hora más temprana del
    // texto (la de origen) y el cambio quedaría en nada.
    const chosen = timeHint ?? pickTimeOfDay(text).timeOfDay;

    // Sin hora EXPLÍCITA no se inventa ninguna: `null` ⇒ el alta pide la hora.
    // Invariante del módulo: "sin hora no hay acción accionable; se pide
    // aclaración". Rellenar aquí ("reunión los lunes" → 09:00, "… mañana" → 00:00)
    // fijaba una hora que nadie dijo.
    if (!chosen) return null;

    const days = kind === 'clase' ? detectAnyWeekdays(text) : detectWeekdays(text);
    if (days.length > 0) {
        return { type: 'weekly', daysOfWeek: days, timeOfDay: chosen };
    }

    const allDays = kind === 'clase' ? CLASE_ALL_DAYS_RE.test(t) : DAILY_RE.test(t);
    if (allDays) {
        return kind === 'clase'
            ? { type: 'weekly', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], timeOfDay: chosen }
            : { type: 'daily', timeOfDay: chosen };
    }

    // Fecha explícita ("hoy/mañana/jueves") + hora: se fija a esa hora.
    const nl = parseNlDateTime(stripTimesOfDay(text), { now: () => now });
    const explicitDay = Boolean(nl?.at);
    const baseAt = nl?.at ?? now;
    const day = new Date(baseAt);
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0).getTime()
        + (parseTimeOfDayToMs(chosen) ?? 0);
    // Solo la hora PELADA ("a las 7") cae a la próxima ocurrencia si ya pasó.
    // Con día explícito ("hoy", "mañana", "el jueves") NO se rueda: "hoy a las
    // 9" es hoy, no mañana.
    if (!explicitDay && at <= now) {
        return { type: 'absolute', at: at + MS_DAY };
    }
    return { type: 'absolute', at };
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
    // §9.2: el consumidor no re-normaliza; la frase llega canónica del motor.
    const base = text;
    // 2) Quitar TODAS las horas con el escáner único (stripTimesOfDay): maneja
    //    "a las 3 de la tarde", "a las 4 p.m.", "mañana a las 3" y, en un cambio
    //    de hora, también la segunda ("de las siete a las ocho") para que no
    //    quede pegada a la etiqueta.
    // 3) Quitar la cláusula del recordatorio ("que me recuerde", "recuérdame"…).
    let label = stripTimesOfDay(base) || base;
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
        .replace(wordRe('una|un|el|la|los|las|mi|para|de|al|del|a|con|es|son|sera|todo|toda|todos|todas|horario|será'), ' ')
        .replace(wordRe('manana|mañana|hoy|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|tarde|noche|madrugada'), ' ')
        .replace(wordRe('pr[oó]xim[ao]s?|siguiente|que\\s+viene|venider[ao]|entrante|d[ií]as?'), ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    // Conectores que quedan COLGANDO al quitar los días: "los miércoles y jueves"
    // → los días se van y sobrevive la "y", así que la clase se guardaba como
    // "matemáticas y". Solo se limpian en los EXTREMOS: un "y" interior puede ser
    // parte real de la etiqueta ("pan y leche").
    label = label
        .replace(/^(?:y|e|o|u|con|de)\s+/i, '')
        .replace(/\s+(?:y|e|o|u|con|de)$/i, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    if (label) return label;
    // Cuantificador universal ("todas las clases", "todo el horario"): el usuario
    // pide el CONJUNTO completo del tipo, no un item. Etiqueta vacia = sin
    // objetivo concreto: el servicio opera sobre la serie ENTERA del tipo
    // (findSeries: `!target`), acotada al usuario. Sin cuantificador se mantiene
    // el sustantivo canonico: "borra la clase" no arrastra todo por ambiguedad.
    if (/\b(?:todo|toda|todos|todas)\b/i.test(base)) return '';
    if (KIND_NOUNS.some((e) => e.nouns.some((n) => n.endsWith('s') && wordRe(n).test(base)))) return '';
    // Sin contenido: etiqueta = sustantivo CANÓNICO del tipo ("alarma",
    // "recordatorio", "cita"), no el verbo crudo. La detección se hace sobre el
    // texto normalizado para que el acento no impida encontrar el tipo.
    const baseNorm = normalizeForMatchExact(base);
    const kindEntry = KIND_NOUNS.find((entry) => entry.nouns.some((noun) => wordRe(noun).test(baseNorm)));
    return kindEntry ? kindEntry.nouns[0] : base;
}

export function parseAgendaCommand(
    input: string,
    options?: { now?: number | (() => number); kindHint?: AgendaKind },
): AgendaCommand {
    const rawNow = options?.now;
    const now = typeof rawNow === 'function' ? rawNow() : typeof rawNow === 'number' ? rawNow : Date.now();
    const text = normalizeSpokenCommand(input);
    const cleaned = collapseRepeatedPhrase(
        collapseQuantifierStutter(
            text.replace(/^[¿¡]+/, ''),
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

    // `kindHint`: tipo YA clasificado (p. ej. el dominio del LLM) para cuando el
    // texto no trae el sustantivo ni el verbo del tipo. No sustituye la
    // deteccion: solo cubre su ausencia, y NO exime del instante explicito.
    const kind = detectKind(cleaned) ?? resolveImplicitKind(cleaned, action) ?? options?.kindHint ?? null;
    if (!kind) {
        // Dictado escolar SIN hora ("agrega matemáticas el lunes"): el tipo es
        // CLASE, pero crear exige el instante y NO se inventa uno. No se descarta
        // en silencio: se devuelve la PISTA (kind+label) para que el carril de
        // dominio pida la hora, igual que cuando el tipo vino por sustantivo
        // explícito ("recuérdame …" → {kind:'recordatorio'}). `handled:false` ⇒
        // quien no mire `action` sigue sin crear nada.
        const claseSinHora = action === 'agenda.create' && (hasNamedDay(cleaned) || hasExplicitRecurrence(cleaned));
        return claseSinHora
            ? { handled: false, action: 'agenda.create', kind: 'clase', label: resolveLabel(cleaned), reply: '' }
            : { handled: false, action: null, reply: '' };
    }

    // Sin verbo explícito ("reunión del equipo mañana a las 12", "junta hoy"):
    // se interpreta como CREAR si trae cláusula de tiempo. Sin tiempo no hay
    // intención accionable.
    const resolvedAction = action ?? 'agenda.create';

    // El disparo es OBLIGATORIO solo para crear; cancelar/editar identifican
    // el item por kind+label (la fecha puede venir o no). Un ÚNICO resolutor de
    // recurrencia atiende clases y resto de kinds (sin dos gramáticas).
    // Hora como COMODÍN: cancelar y editar identifican el item por kind+label, así
    // que si el usuario NO dijo hora no se inventa una: `resolveRecurrence` pide
    // hora explícita y devuelve null sin ella (crear entonces pide la hora).
    // Cambio de HORA ("de las siete a las ocho"): la ÚLTIMA hora es el DESTINO y
    // la primera identifica el item. Con una sola hora, esa es la hora.
    const hours = scanTimesOfDay(cleaned);
    const target = hours.length > 1 ? hours[hours.length - 1] : undefined;
    const destination = resolvedAction === 'agenda.update' && target ? target.timeOfDay : null;
    const spokenTime = destination ?? pickTimeOfDay(cleaned).timeOfDay;
    const recurrence = resolveRecurrence(cleaned, now, kind, destination);
    const trigger = resolvedAction === 'agenda.create' || spokenTime ? recurrence : null;
    if (!trigger && resolvedAction === 'agenda.create') {
        // Sin instante NO se crea (el modelo exige `at`/recurrencia), pero el
        // descarte deja de ser ciego: se devuelve la pista (kind+label) para que
        // el carril de dominio pida la hora en vez de tirar el turno. Sigue
        // `handled:false`: quien no mire `action` no crea nada.
        return { handled: false, action: resolvedAction, kind, label: resolveLabel(cleaned), reply: '' };
    }

    const label = resolveLabel(cleaned);
    // Cancelar SÍ usa los días nombrados: "borra la clase de historia del jueves"
    // cae solo el jueves. Se leen de la recurrencia ya resuelta (misma fuente de
    // días que crear), pero NO se devuelven como `trigger`: ese hueco de hora
    // ('09:00' de relleno) es para crear, y usarlo aquí movería la hora.
    // El dia NOMBRADO acota la serie sea CUAL sea el kind. La recurrencia solo
    // trae dias para 'clase' (el resto exige recurrencia explicita: "los jueves"),
    // asi que en 'junta'/'cita'/... "del jueves" se perdia y el match caia a la
    // SERIE COMPLETA (borraba la semana). Fuente unica del dia nombrado:
    // detectAnyWeekdays, el mismo que usa 'clase' al crear.
    const namedDays =
        recurrence?.type === 'weekly' && recurrence.daysOfWeek?.length
            ? recurrence.daysOfWeek
            : detectAnyWeekdays(text);
    const scopeDays =
        resolvedAction === 'agenda.cancel' && namedDays.length > 0 ? namedDays : undefined;
    return {
        handled: true,
        action: resolvedAction,
        kind,
        label,
        trigger: trigger ?? undefined,
        scopeDays,
        reply: '',
    };
}
