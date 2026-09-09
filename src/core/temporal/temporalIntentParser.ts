// ============================================================
// Temporal Intent Parser — Alarmas, despertador y temporizador
// ------------------------------------------------------------
// Parser determinista de intenciones es/en sobre el motor
// temporal genérico (Fase 1D). Un solo motor (trigger +
// recurrencia) para alarmas, despertador y temporizadores.
//   - 'pon una alarma a las 7 de la mañana'            → alarm.add
//   - 'set an alarm for 7 am on Monday'                → alarm.add
//   - 'qué alarmas tengo' / 'show my alarms'           → alarm.list
//   - 'cancela todas las alarmas' / 'cancel all alarms' → alarm.cancel
//   - 'pon un temporizador de 5 minutos'               → timer.start
//   - 'cancela el temporizador' / 'cancel the timer'   → timer.cancel
// Mismo patrón probado que reminderIntentParser:
//   - `handled:false` si no reconoce ninguna intención.
//   - `handled:true, action:null` si hace falta aclaración.
// Regla #1: sin hardcode — `now`, `defaultAlarmTimeOfDay` y
// `defaultTimerMinutes` inyectables; textos deterministas.
// Regla de oro: motor puro (sin DOM, sin Dexie, sin Gemini).
// ============================================================

import {
  MS_DAY,
  MS_HOUR,
  MS_MINUTE,
  MS_SECOND,
  dayOfWeek,
  parseTimeOfDayToMs,
  startOfLocalDay,
} from './scheduleEngine';
import {
  dailyRecurrence,
  onceRecurrence,
  weekdaysRecurrence,
} from './temporalTypes';
import type {
  TemporalItemKind,
  TemporalRecurrence,
  TemporalTrigger,
} from './temporalTypes';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export type TemporalIntentAction =
  | 'alarm.add'
  | 'alarm.list'
  | 'alarm.cancel'
  | 'timer.start'
  | 'timer.list'
  | 'timer.cancel';

export interface TemporalIntentData {
  /** alarm o timer. */
  kind?: TemporalItemKind;
  /** Nombre descriptivo (por defecto 'Alarma a las HH:MM' / 'Temporizador'). */
  label?: string;
  /** Disparador resuelto (alarm.add / timer.start). */
  trigger?: TemporalTrigger;
  /** Recurrencia resuelta (alarm.add / timer.start). */
  recurrence?: TemporalRecurrence;
  /** true cuando se cancelan todos (alarm.cancel / timer.cancel). */
  all?: boolean;
  /** Referencia de la cancelación (hora de la alarma o duración del temporizador). */
  cancelTarget?: string;
}

export interface TemporalIntent {
  /** true si el input fue reconocido como comando temporal. */
  handled: boolean;
  /** Acción a ejecutar; null cuando hace falta aclaración. */
  action: TemporalIntentAction | null;
  /** Mensaje determinista para confirmar o pedir aclaración. */
  reply: string;
  data?: TemporalIntentData;
}

export interface TemporalIntentParserOptions {
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: number;
  /** Si la alarma no indica hora, usa esta hora del día ('HH:MM'). */
  defaultAlarmTimeOfDay?: string;
  /** Si el temporizador no indica duración, usa estos minutos. */
  defaultTimerMinutes?: number;
}

// ------------------------------------------------------------
// Constantes declarativas — Regla #1 (sin hardcode disperso)
// ------------------------------------------------------------

const ALARM_ADD_ES =
  /^(?:pon(?:me)?|configura|crea|activa|establece|enciende)\s+(?:una\s+|la\s+|el\s+)?(?:alarma|despertador)|^(?:despi[eé]rtame|despiertame|alarma|despertador)\b/i;
const ALARM_ADD_EN =
  /^(?:set|create|make|turn\s+on|put)\s+(?:an?\s+|the\s+)?alarm\b|^(?:alarm|wake\s+me\s+up)\b/i;

const ALARM_LIST_ES =
  /^(?:qu[eé]\s+alarmas\s+tengo|mu[eé]strame\s+(?:mis\s+)?alarmas|muestra\s+(?:mis\s+)?alarmas|lista\s+de\s+alarmas|ver\s+(?:mis\s+)?alarmas|dime\s+(?:mis\s+)?alarmas)\b/i;
const ALARM_LIST_EN =
  /^(?:what\s+alarms|show\s+(?:me\s+)?(?:my\s+)?alarms|list\s+alarms|alarm\s+list)\b/i;

const ALARM_CANCEL_ES =
  /^(?:cancela|cancelar|quita|quitar|borra|borrar|elimina|apaga|apagar|desactiva)\s+(?:todas\s+las\s+|la\s+|el\s+|las\s+|los\s+|una\s+)?(?:alarmas?|despertador)\b/i;
const ALARM_CANCEL_EN =
  /^(?:cancel|stop|turn\s+off|delete|remove|clear)\s+(?:all\s+the\s+|all\s+|the\s+|an?\s+)?alarms?\b/i;

const TIMER_START_ES =
  /^(?:pon|ponme|configura|crea|activa|inicia|arranca)\s+(?:un\s+|el\s+|una\s+)?(?:temporizador|cron[oó]metro|cronometro|cuenta\s+regresiva|cuenta\s+atr[aá]s)|^(?:temporizador|cron[oó]metro|cronometro|cuenta\s+regresiva)\b/i;
const TIMER_START_EN =
  /^(?:set|start|create|put|launch)\s+(?:a\s+|the\s+)?(?:timer|countdown)\b|^(?:timer|countdown)\b/i;

const TIMER_LIST_ES =
  /^(?:qu[eé]\s+temporizadores\s+tengo|mu[eé]strame\s+(?:mis\s+)?temporizadores|muestra\s+(?:mis\s+)?temporizadores|lista\s+de\s+temporizadores|ver\s+(?:mis\s+)?temporizadores)\b/i;
const TIMER_LIST_EN =
  /^(?:what\s+timers|show\s+(?:me\s+)?(?:my\s+)?timers|list\s+timers|timer\s+list)\b/i;

const TIMER_CANCEL_ES =
  /^(?:cancela|cancelar|quita|quitar|borra|borrar|elimina|det[eé]n|detener|detiene|apaga|apagar)\s+(?:todos\s+los\s+|el\s+|los\s+|un\s+)?(?:temporizador(?:es)?|cron[oó]metros?|cronometros?|cuentas?\s+regresivas?)\b/i;
const TIMER_CANCEL_EN =
  /^(?:cancel|stop|delete|remove|clear)\s+(?:all\s+the\s+|all\s+|the\s+|a\s+)?timers?\b/i;

// --- Días de la semana (0=Domingo ... 6=Sábado) --------------
const ES_DAY_INDEX: Record<string, number> = {
  domingo: 0,
  domingos: 0,
  lunes: 1,
  martes: 2,
  miércoles: 3,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sábado: 6,
  sabado: 6,
  sábados: 6,
  sabados: 6,
};
const EN_DAY_INDEX: Record<string, number> = {
  sunday: 0,
  sundays: 0,
  monday: 1,
  mondays: 1,
  tuesday: 2,
  tuesdays: 2,
  wednesday: 3,
  wednesdays: 3,
  thursday: 4,
  thursdays: 4,
  friday: 5,
  fridays: 5,
  saturday: 6,
  saturdays: 6,
};
const ES_DAY_NAMES = [
  'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado',
];
const EN_DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

// --- Horas del día --------------------------------------------
// El ASR (Chrome) suele transcribir "12:13 p.m" como "12 13 p m"
// (dos puntos y punto del meridiano → espacios). El patrón acepta:
//   "a las 12", "a las 12:13", "a las 12 13", "12 13 p m", "5 pm", "5 00 p m".
// El meridiano admite puntos y espacios: p.m., p m, a.m., a m.
const ES_TIME =
  /\b(?:a|para|hacia|de)\s+las?\s+(\d{1,2})(?:(?:\s*[:.]\s*(\d{2}))|(?:\s+(\d{2}))|(?:\s+con\s+(\d{1,2})\s+minutos?))?\s*(?:de\s+la\s+(mañana|manana|tarde|noche|madrugada))?\s*(p\.?\s*m\.?|a\.?\s*m\.?)?/i;
const EN_TIME =
  /\b(?:at|for)\s+(\d{1,2})(?::(\d{2})|\s+(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i;
const NOON_ES = /\b(?:al\s+|a\s+|el\s+)?(?:mediod[ií]a|medio\s+d[ií]a)\b/i;
const NOON_EN = /\b(?:at\s+)?noon\b/i;
const MIDNIGHT_ES = /\b(?:a\s+la\s+|la\s+)?(?:medianoche|media\s+noche)\b/i;
const MIDNIGHT_EN = /\b(?:at\s+)?midnight\b/i;

// --- Recurrencia ----------------------------------------------
interface RecurrenceRule {
  pattern: RegExp;
  build: (m: RegExpExecArray) => TemporalRecurrence;
}

const RECURRENCE_RULES: ReadonlyArray<RecurrenceRule> = Object.freeze([
  {
    pattern:
      /\btodos\s+los\s+d[ií]as\b|\bcada\s+d[ií]a\b|\bdiario\b|\btodas\s+las\s+mañanas\b|\btodas\s+las\s+mananas\b/i,
    build: () => dailyRecurrence(),
  },
  {
    pattern: /\bevery\s+day\b|\beach\s+day\b|\bdaily\b|\bevery\s+morning\b/i,
    build: () => dailyRecurrence(),
  },
  {
    pattern:
      /\bentre\s+semana\b|\bde\s+lunes\s+a\s+viernes\b|\blunes\s+a\s+viernes\b|\bd[ií]as\s+de\s+semana\b/i,
    build: () => weekdaysRecurrence([1, 2, 3, 4, 5]),
  },
  {
    pattern: /\bde\s+lunes\s+a\s+s[aá]bado\b/i,
    build: () => weekdaysRecurrence([1, 2, 3, 4, 5, 6]),
  },
  {
    pattern: /\bweekdays\b|\bmonday\s+to\s+friday\b|\bmon\s+to\s+fri\b/i,
    build: () => weekdaysRecurrence([1, 2, 3, 4, 5]),
  },
  {
    pattern:
      /(?:\blos\s+|\blas\s+|\bcada\s+|\btodos\s+los\s+|\bsolo\s+los\s+|\bsólo\s+los\s+)(domingos?|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?)\b/i,
    build: (m: RegExpExecArray) => weekdaysRecurrence([ES_DAY_INDEX[m[1].toLowerCase()]]),
  },
  {
    pattern:
      /(?:\bon\s+|\bevery\s+)(sundays?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?)\b/i,
    build: (m: RegExpExecArray) => weekdaysRecurrence([EN_DAY_INDEX[m[1].toLowerCase()]]),
  },
]);

// --- Días absolutos (desfase en días respecto a `now`) ---------
interface DayOffsetRule {
  pattern: RegExp;
  offset: (m: RegExpExecArray, now: number) => number;
}

const DAY_OFFSET_RULES: ReadonlyArray<DayOffsetRule> = Object.freeze([
  {
    pattern: /\bpasado\s+mañana\b|\bpasado\s+manana\b|\bday\s+after\s+tomorrow\b/i,
    offset: () => 2,
  },
  {
    pattern: /\bmañana\b|\bmanana\b|\btomorrow\b/i,
    offset: () => 1,
  },
  {
    pattern: /\bhoy\b|\btoday\b/i,
    offset: () => 0,
  },
  {
    pattern:
      /\b(?:el\s+|this\s+|next\s+|on\s+)?(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\b/i,
    offset: (m: RegExpExecArray, now: number) => {
      const target = ES_DAY_INDEX[m[1].toLowerCase()];
      const diff = (target - dayOfWeek(now) + 7) % 7;
      return diff === 0 ? 7 : diff;
    },
  },
  {
    pattern:
      /\b(?:next\s+|on\s+|this\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
    offset: (m: RegExpExecArray, now: number) => {
      const target = EN_DAY_INDEX[m[1].toLowerCase()];
      const diff = (target - dayOfWeek(now) + 7) % 7;
      return diff === 0 ? 7 : diff;
    },
  },
]);

// --- Palabras que sobran en una etiqueta -----------------------
const LABEL_STRIP =
  /\b(?:de|del|para|a|al|por|el|la|los|las|en|con|the|at|for|to|of|on)\b/gi;

// ------------------------------------------------------------
// Helpers de texto
// ------------------------------------------------------------

function removeRange(text: string, start: number, end: number): string {
  return `${text.slice(0, start)} ${text.slice(end)}`.replace(/\s{2,}/g, ' ').trim();
}

function removeRanges(text: string, ranges: Array<{ start: number; end: number }>): string {
  const sorted = ranges.slice().sort((a, b) => b.start - a.start);
  let result = text;
  for (const range of sorted) {
    result = `${result.slice(0, range.start)} ${result.slice(range.end)}`;
  }
  return result.replace(/\s{2,}/g, ' ').trim();
}

function cleanLabel(text: string): string {
  return text.replace(LABEL_STRIP, ' ').replace(/\s{2,}/g, ' ').trim();
}

/** Busca la frase de recurrencia más temprana y la quita del texto. */
function extractRecurrence(text: string): { recurrence: TemporalRecurrence | null; rest: string } {
  let best: { start: number; end: number; recurrence: TemporalRecurrence } | null = null;
  for (const rule of RECURRENCE_RULES) {
    const m = rule.pattern.exec(text);
    if (m && (!best || m.index < best.start)) {
      best = { start: m.index, end: m.index + m[0].length, recurrence: rule.build(m) };
    }
  }
  if (!best) return { recurrence: null, rest: text };
  return { recurrence: best.recurrence, rest: removeRange(text, best.start, best.end) };
}

function resolveEsTime(m: RegExpExecArray): string {
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : m[3] ? Number(m[3]) : m[4] ? Number(m[4]) : 0;
  const part = m[5] ? m[5].toLowerCase() : null;
  // Meridiano explícito (p.m./a.m./p m) tiene prioridad sobre 'de la tarde/noche'.
  const meridiem = m[6] ? m[6].toLowerCase().replace(/\./g, '').replace(/\s+/g, '') : null;
  if (meridiem === 'pm') {
    if (h < 12) h += 12;
  } else if (meridiem === 'am') {
    if (h === 12) h = 0;
  } else if (part === 'tarde') {
    if (h < 12) h += 12;
  } else if (part === 'noche') {
    if (h === 12) h = 0;
    else if (h < 12) h += 12;
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function resolveEnTime(m: RegExpExecArray): string {
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : m[3] ? Number(m[3]) : 0;
  const meridiem = m[4] ? m[4].toLowerCase().replace(/\./g, '').replace(/\s+/g, '') : null;
  if (meridiem === 'pm') {
    if (h < 12) h += 12;
  } else if (meridiem === 'am') {
    if (h === 12) h = 0;
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * Extrae la hora del día más temprana ('HH:MM') y la quita.
 * Se llama ANTES de extraer el día para que 'de la mañana' no se
 * interprete como 'mañana = tomorrow'.
 */
function extractTimeOfDay(text: string): { timeOfDay: string | null; rest: string } {
  const candidates: Array<{ start: number; end: number; timeOfDay: string }> = [];

  const es = ES_TIME.exec(text);
  if (es) candidates.push({ start: es.index, end: es.index + es[0].length, timeOfDay: resolveEsTime(es) });
  const en = EN_TIME.exec(text);
  if (en) candidates.push({ start: en.index, end: en.index + en[0].length, timeOfDay: resolveEnTime(en) });
  const noonEs = NOON_ES.exec(text);
  if (noonEs) candidates.push({ start: noonEs.index, end: noonEs.index + noonEs[0].length, timeOfDay: '12:00' });
  const noonEn = NOON_EN.exec(text);
  if (noonEn) candidates.push({ start: noonEn.index, end: noonEn.index + noonEn[0].length, timeOfDay: '12:00' });
  const midEs = MIDNIGHT_ES.exec(text);
  if (midEs) candidates.push({ start: midEs.index, end: midEs.index + midEs[0].length, timeOfDay: '00:00' });
  const midEn = MIDNIGHT_EN.exec(text);
  if (midEn) candidates.push({ start: midEn.index, end: midEn.index + midEn[0].length, timeOfDay: '00:00' });

  if (candidates.length === 0) return { timeOfDay: null, rest: text };
  candidates.sort((a, b) => a.start - b.start);
  const best = candidates[0];
  return { timeOfDay: best.timeOfDay, rest: removeRange(text, best.start, best.end) };
}

/** Desfase en días (hoy=0, mañana=1, día de la semana) y texto restante. */
function extractDayOffset(text: string, now: number): { dayOffset: number | null; rest: string } {
  let best: { start: number; end: number; dayOffset: number } | null = null;
  for (const rule of DAY_OFFSET_RULES) {
    const m = rule.pattern.exec(text);
    if (m && (!best || m.index < best.start)) {
      best = { start: m.index, end: m.index + m[0].length, dayOffset: rule.offset(m, now) };
    }
  }
  if (!best) return { dayOffset: null, rest: text };
  return { dayOffset: best.dayOffset, rest: removeRange(text, best.start, best.end) };
}

function parseDurationValue(raw: string): number {
  const lower = raw.trim().toLowerCase();
  if (lower === 'una' || lower === 'un' || lower === 'a' || lower === 'an' || lower === 'one') return 1;
  if (lower === 'media' || lower === 'half') return 0.5;
  const num = Number(lower.replace(',', '.'));
  return Number.isFinite(num) ? num : 0;
}

/**
 * Extrae la duración total (ms) de un texto y lo limpia.
 * La regex se crea fresca en cada llamada: evita el arrastre de
 * lastIndex propio del modificador /g.
 */
function extractDurationMs(text: string): { durationMs: number; rest: string } {
  const token =
    /\b(\d+(?:[.,]\d+)?|una|un|media|a|an|half|one)\s*(horas?|hour|hours|hrs?|minutos?|min|mins?|minute|minutes|segundos?|seg|secs?|second|seconds)\b/gi;
  token.lastIndex = 0;
  let total = 0;
  const ranges: Array<{ start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = token.exec(text)) !== null) {
    const value = parseDurationValue(m[1]);
    const unit = m[2].toLowerCase();
    const factor = unit.startsWith('h') ? MS_HOUR : unit.startsWith('m') ? MS_MINUTE : MS_SECOND;
    total += value * factor;
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  return { durationMs: total, rest: removeRanges(text, ranges) };
}

function absoluteAt(now: number, dayOffset: number, timeOfDay: string): number {
  const msOfDay = parseTimeOfDayToMs(timeOfDay) ?? 0;
  return startOfLocalDay(now) + dayOffset * MS_DAY + msOfDay;
}

/** 'todos los días' / 'entre semana' / 'los lunes' según la recurrencia. */
function recurrencePhrase(recurrence: TemporalRecurrence, lang: 'es' | 'en'): string {
  switch (recurrence.kind) {
    case 'daily':
      return lang === 'es' ? ' todos los días' : ' every day';
    case 'weekdays': {
      const phrase = daysPhrase(recurrence.days, lang);
      return phrase ? ` ${phrase}` : lang === 'es' ? ' entre semana' : ' on weekdays';
    }
    default:
      return '';
  }
}

function daysPhrase(days: number[] | undefined, lang: 'es' | 'en'): string {
  if (!days || days.length === 0) return '';
  const sorted = days.slice().sort((a, b) => a - b);
  const weekdays = [1, 2, 3, 4, 5];
  const all = [0, 1, 2, 3, 4, 5, 6];
  const isWeekdays = weekdays.length === sorted.length && weekdays.every((d, i) => d === sorted[i]);
  const isAll = all.length === sorted.length && all.every((d, i) => d === sorted[i]);
  if (isAll) return lang === 'es' ? 'todos los días' : 'every day';
  if (isWeekdays) return lang === 'es' ? 'entre semana' : 'on weekdays';
  const names = sorted.map((d) => (lang === 'es' ? ES_DAY_NAMES[d] : EN_DAY_NAMES[d]));
  return lang === 'es' ? `los ${names.join(' y ')}` : `on ${names.join(' and ')}`;
}

/** Duración legible: '1 hora y 30 minutos' / '5 minutes'. */
export function formatDurationMs(ms: number, lang: 'es' | 'en' = 'es'): string {
  const totalSeconds = Math.round(ms / MS_SECOND);
  if (totalSeconds <= 0) return lang === 'es' ? '0 segundos' : '0 seconds';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(
      lang === 'es'
        ? hours === 1 ? '1 hora' : `${hours} horas`
        : hours === 1 ? '1 hour' : `${hours} hours`,
    );
  }
  if (minutes > 0) {
    parts.push(
      lang === 'es'
        ? minutes === 1 ? '1 minuto' : `${minutes} minutos`
        : minutes === 1 ? '1 minute' : `${minutes} minutes`,
    );
  }
  if (seconds > 0) {
    parts.push(
      lang === 'es'
        ? seconds === 1 ? '1 segundo' : `${seconds} segundos`
        : seconds === 1 ? '1 second' : `${seconds} seconds`,
    );
  }
  if (parts.length === 0) return lang === 'es' ? '0 segundos' : '0 seconds';
  return parts.join(lang === 'es' ? ' y ' : ' and ');
}

// ------------------------------------------------------------
// Respuestas deterministas (es/en)
// ------------------------------------------------------------

function alarmAddedReply(timeOfDay: string, recurrence: TemporalRecurrence, label: string, lang: 'es' | 'en'): string {
  const labelPhrase = label ? ` "${label}"` : '';
  const recPhrase = recurrencePhrase(recurrence, lang);
  return lang === 'es'
    ? `Listo, puse la alarma${labelPhrase} a las ${timeOfDay}${recPhrase}.`
    : `Done, I set the alarm${labelPhrase} for ${timeOfDay}${recPhrase}.`;
}

function timerStartedReply(durationLabel: string, label: string, lang: 'es' | 'en'): string {
  const labelPhrase = label ? ` "${label}"` : '';
  return lang === 'es'
    ? `Listo, puse el temporizador${labelPhrase} de ${durationLabel}.`
    : `Done, I set a timer${labelPhrase} for ${durationLabel}.`;
}

function alarmListReply(lang: 'es' | 'en'): string {
  return lang === 'es' ? 'Aquí tienes tus alarmas.' : 'Here are your alarms.';
}

function timerListReply(lang: 'es' | 'en'): string {
  return lang === 'es' ? 'Aquí tienes tus temporizadores.' : 'Here are your timers.';
}

function alarmCancelReply(cancelTarget: string | undefined, all: boolean, lang: 'es' | 'en'): string {
  if (all) return lang === 'es' ? 'Cancelé todas las alarmas.' : 'I cancelled all alarms.';
  return lang === 'es'
    ? cancelTarget ? `Alarma cancelada (${cancelTarget}).` : 'Alarma cancelada.'
    : cancelTarget ? `Alarm cancelled (${cancelTarget}).` : 'Alarm cancelled.';
}

function timerCancelReply(cancelTarget: string | undefined, all: boolean, lang: 'es' | 'en'): string {
  if (all) return lang === 'es' ? 'Cancelé todos los temporizadores.' : 'I cancelled all timers.';
  return lang === 'es'
    ? cancelTarget ? `Temporizador cancelado (${cancelTarget}).` : 'Temporizador cancelado.'
    : cancelTarget ? `Timer cancelled (${cancelTarget}).` : 'Timer cancelled.';
}

function askAlarmTimeReply(lang: 'es' | 'en'): string {
  return lang === 'es' ? '¿A qué hora quieres la alarma?' : 'What time would you like the alarm?';
}

function askTimerDurationReply(lang: 'es' | 'en'): string {
  return lang === 'es'
    ? '¿De cuánto tiempo quieres el temporizador?'
    : 'How long would you like the timer?';
}

// ------------------------------------------------------------
// Parser principal
// ------------------------------------------------------------

/**
 * Interpreta un texto de voz/texto como comando de alarmas,
 * despertador o temporizadores.
 * Devuelve `handled: false` si no reconoce ninguna intención.
 */
export function parseTemporalIntent(
  input: string,
  options: TemporalIntentParserOptions = {},
): TemporalIntent {
  if (typeof input !== 'string') return { handled: false, action: null, reply: '' };
  const text = input.trim();
  if (!text) return { handled: false, action: null, reply: '' };

  const now = options.now !== undefined ? options.now : Date.now();

  // --- Temporizadores: listar ----------------------------------
  const timerList = TIMER_LIST_ES.test(text) || TIMER_LIST_EN.test(text);
  if (timerList) {
    const lang = TIMER_LIST_ES.test(text) ? 'es' : 'en';
    return { handled: true, action: 'timer.list', reply: timerListReply(lang) };
  }

  // --- Alarmas: listar -----------------------------------------
  const alarmList = ALARM_LIST_ES.test(text) || ALARM_LIST_EN.test(text);
  if (alarmList) {
    const lang = ALARM_LIST_ES.test(text) ? 'es' : 'en';
    return { handled: true, action: 'alarm.list', reply: alarmListReply(lang) };
  }

  // --- Temporizadores: cancelar --------------------------------
  const timerCancel = TIMER_CANCEL_ES.exec(text) || TIMER_CANCEL_EN.exec(text);
  if (timerCancel) {
    const lang = TIMER_CANCEL_ES.test(text) ? 'es' : 'en';
    const rest = text.slice(timerCancel[0].length).trim();
    const { durationMs } = extractDurationMs(rest);
    const all = /\b(todas|todos|all)\b/i.test(text);
    const cancelTarget = durationMs > 0 ? formatDurationMs(durationMs, lang) : undefined;
    const data: TemporalIntentData = { kind: 'timer', all };
    if (cancelTarget) data.cancelTarget = cancelTarget;
    return {
      handled: true,
      action: 'timer.cancel',
      reply: timerCancelReply(cancelTarget, all, lang),
      data,
    };
  }

  // --- Alarmas: cancelar ---------------------------------------
  const alarmCancel = ALARM_CANCEL_ES.exec(text) || ALARM_CANCEL_EN.exec(text);
  if (alarmCancel) {
    const lang = ALARM_CANCEL_ES.test(text) ? 'es' : 'en';
    const rest = text.slice(alarmCancel[0].length).trim();
    const { timeOfDay } = extractTimeOfDay(rest);
    const all = /\b(todas|todos|all)\b/i.test(text);
    const cancelTarget = timeOfDay ?? undefined;
    const data: TemporalIntentData = { kind: 'alarm', all };
    if (cancelTarget) data.cancelTarget = cancelTarget;
    return {
      handled: true,
      action: 'alarm.cancel',
      reply: alarmCancelReply(cancelTarget, all, lang),
      data,
    };
  }

  // --- Temporizadores: iniciar ---------------------------------
  const timerStart = TIMER_START_ES.exec(text) || TIMER_START_EN.exec(text);
  if (timerStart) {
    const lang = TIMER_START_ES.test(text) ? 'es' : 'en';
    const rest = text.slice(timerStart[0].length).trim();
    const { durationMs, rest: restAfterDuration } = extractDurationMs(rest);

    let resolvedMs = durationMs;
    if (resolvedMs <= 0 && options.defaultTimerMinutes !== undefined) {
      resolvedMs = options.defaultTimerMinutes * MS_MINUTE;
    }
    if (resolvedMs <= 0) {
      return { handled: true, action: null, reply: askTimerDurationReply(lang) };
    }

    const userLabel = cleanLabel(restAfterDuration);
    const label = userLabel || (lang === 'es' ? 'Temporizador' : 'Timer');
    const data: TemporalIntentData = {
      kind: 'timer',
      label,
      trigger: { kind: 'countdown', at: now, durationMs: resolvedMs },
      recurrence: onceRecurrence(),
    };
    const durationLabel = formatDurationMs(resolvedMs, lang);
    return {
      handled: true,
      action: 'timer.start',
      reply: timerStartedReply(durationLabel, userLabel, lang),
      data,
    };
  }

  // --- Alarmas: agregar ----------------------------------------
  const alarmAdd = ALARM_ADD_ES.exec(text) || ALARM_ADD_EN.exec(text);
  if (alarmAdd) {
    const lang = ALARM_ADD_ES.test(text) ? 'es' : 'en';
    let rest = text.slice(alarmAdd[0].length).trim();

    // Orden crítico: recurrencia → hora → día, para que
    // 'de la mañana' no se lea como 'mañana = tomorrow' y
    // 'los lunes' (recurrencia) no se confunda con 'el lunes'.
    const rec = extractRecurrence(rest);
    rest = rec.rest;
    const time = extractTimeOfDay(rest);
    rest = time.rest;
    const day = extractDayOffset(rest, now);
    rest = day.rest;

    let timeOfDay = time.timeOfDay;
    if (!timeOfDay && options.defaultAlarmTimeOfDay !== undefined) {
      timeOfDay = options.defaultAlarmTimeOfDay;
    }
    if (!timeOfDay) {
      return { handled: true, action: null, reply: askAlarmTimeReply(lang) };
    }

    const userLabel = cleanLabel(rest);
    const explicitRecurrence = rec.recurrence !== null;

    let trigger: TemporalTrigger;
    let recurrence: TemporalRecurrence;
    if (explicitRecurrence) {
      // Recurrencia explícita: disparador diario a la hora indicada.
      trigger = { kind: 'daily', timeOfDay };
      recurrence = rec.recurrence as TemporalRecurrence;
    } else if (day.dayOffset !== null) {
      // Día concreto (hoy, mañana o un día de la semana): una sola vez.
      // 'hoy' con hora ya pasada → mañana a esa hora (mismo criterio que
      // nlDateParser en recordatorios): evita rechazar el alta en silencio.
      let at = absoluteAt(now, day.dayOffset, timeOfDay);
      if (day.dayOffset === 0 && at <= now) at += MS_DAY;
      trigger = { kind: 'absolute', at };
      recurrence = onceRecurrence();
    } else {
      // Solo hora → despertador diario.
      trigger = { kind: 'daily', timeOfDay };
      recurrence = dailyRecurrence();
    }

    const label = userLabel || (lang === 'es' ? `Alarma a las ${timeOfDay}` : `Alarm at ${timeOfDay}`);
    const data: TemporalIntentData = { kind: 'alarm', label, trigger, recurrence };
    return {
      handled: true,
      action: 'alarm.add',
      reply: alarmAddedReply(timeOfDay, recurrence, userLabel, lang),
      data,
    };
  }

  return { handled: false, action: null, reply: '' };
}
