// ============================================================
// Natural Language Date Parser — Recordatorios (A7/A8)
// ------------------------------------------------------------
// Interpreta expresiones de tiempo en lenguaje natural (es/en):
//   hoy / mañana / pasado mañana / today / tomorrow / day after tomorrow
//   en N minutos/horas/días/semanas
//   el lunes / el próximo martes / next monday
//   el 25 de diciembre / december 25th
//   a las 3 de la tarde / a las 9 / 3pm / mediodía / medianoche
//   esta tarde / esta noche
// Determinista y puro: `now` es inyectable.
// ============================================================

import { pickTimeOfDay } from '../temporal/timeOfDay';

export interface NlDateTimeResult {
  /** Cómo se interpretó la expresión (para trazas/mensajes). */
  type:
    | 'today'
    | 'tomorrow'
    | 'day-after'
    | 'offset'
    | 'weekday'
    | 'absolute'
    | 'part-of-day';
  /** Timestamp en ms (epoch) resultante. */
  at: number;
  /** Texto que coincidió (normalizado). */
  matchedText: string;
  /** Etiqueta canónica legible (es) para la UI/mensajes. */
  label: string;
}

export interface NlDateParserOptions {
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
}

// ------------------------------------------------------------
// Constantes declarativas — Regla #1 (sin hardcode disperso)
// ------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS_ES: ReadonlyArray<{ name: string; number: number }> = Object.freeze([
  { name: 'enero', number: 1 },
  { name: 'febrero', number: 2 },
  { name: 'marzo', number: 3 },
  { name: 'abril', number: 4 },
  { name: 'mayo', number: 5 },
  { name: 'junio', number: 6 },
  { name: 'julio', number: 7 },
  { name: 'agosto', number: 8 },
  { name: 'septiembre', number: 9 },
  { name: 'octubre', number: 10 },
  { name: 'noviembre', number: 11 },
  { name: 'diciembre', number: 12 },
]);

const MONTHS_EN: ReadonlyArray<{ name: string; number: number }> = Object.freeze([
  { name: 'january', number: 1 },
  { name: 'february', number: 2 },
  { name: 'march', number: 3 },
  { name: 'april', number: 4 },
  { name: 'may', number: 5 },
  { name: 'june', number: 6 },
  { name: 'july', number: 7 },
  { name: 'august', number: 8 },
  { name: 'september', number: 9 },
  { name: 'october', number: 10 },
  { name: 'november', number: 11 },
  { name: 'december', number: 12 },
]);

/** Días de la semana: domingo=0 ... sábado=6 (getDay). */
const WEEKDAYS: ReadonlyArray<{ name: string; day: number }> = Object.freeze([
  { name: 'domingo', day: 0 },
  { name: 'lunes', day: 1 },
  { name: 'martes', day: 2 },
  { name: 'miercoles', day: 3 },
  { name: 'jueves', day: 4 },
  { name: 'viernes', day: 5 },
  { name: 'sabado', day: 6 },
]);

const WEEKDAYS_EN: ReadonlyArray<{ name: string; day: number }> = Object.freeze([
  { name: 'sunday', day: 0 },
  { name: 'monday', day: 1 },
  { name: 'tuesday', day: 2 },
  { name: 'wednesday', day: 3 },
  { name: 'thursday', day: 4 },
  { name: 'friday', day: 5 },
  { name: 'saturday', day: 6 },
]);

/** Nombre canónico en español para un día (getDay: 0=domingo). */
function spanishWeekdayName(day: number): string {
  return WEEKDAYS.find((w) => w.day === day)?.name ?? '';
}

/** Unidades de desplazamiento ('en N unidades'). */
const OFFSET_UNITS: ReadonlyArray<{ pattern: RegExp; ms: number; label: string }> =
  Object.freeze([
    // La alternancia en regex coincide por el orden de aparición (izquierda a
    // derecha), así que la forma plural debe ir primero para no recortar la 's'.
    { pattern: /(\d+)\s*(minutos|minuto|min)/i, ms: 60 * 1000, label: 'minuto' },
    { pattern: /(\d+)\s*(horas|hora|hrs?)/i, ms: 60 * 60 * 1000, label: 'hora' },
    { pattern: /(\d+)\s*(dias|dia)/i, ms: DAY_MS, label: 'día' },
    { pattern: /(\d+)\s*(semanas|semana)/i, ms: 7 * DAY_MS, label: 'semana' },
  ]);

/** Hora de día ('esta mañana/tarde/noche'). */
const PART_OF_DAY: ReadonlyArray<{ pattern: RegExp; hour: number; label: string }> =
  Object.freeze([
    { pattern: /esta\s+(manana|mañana)/i, hour: 9, label: 'esta mañana' },
    { pattern: /this\s+morning/i, hour: 9, label: 'esta mañana' },
    { pattern: /esta\s+tarde/i, hour: 18, label: 'esta tarde' },
    { pattern: /this\s+afternoon/i, hour: 18, label: 'esta tarde' },
    { pattern: /esta\s+noche/i, hour: 21, label: 'esta noche' },
    { pattern: /tonight/i, hour: 21, label: 'esta noche' },
  ]);

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/** Quita acentos y normaliza a minúsculas con espacios simples. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function applyHourMinute(base: Date, hour: number, minute: number): Date {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function formatLabelDate(at: number): string {
  const d = new Date(at);
  return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Siguiente ocurrencia de un día de la semana, estrictamente futura (+7 si hoy). */
function nextWeekday(now: Date, target: number, weeksAhead: number): Date {
  const diff = (target - now.getDay() + 7) % 7;
  const days = diff === 0 ? 7 : diff;
  const base = startOfDay(now);
  base.setDate(base.getDate() + days + weeksAhead * 7);
  return base;
}

interface ParsedTime {
  hour: number;
  minute: number;
}

/** Extrae una hora explícita del texto, o null. */
function extractTime(text: string): ParsedTime | null {
  // El ASR (Chrome) transcribe "2 con 13 minutos p.m" como conector verbal:
  // se normaliza a "2 :13 p.m" para que las ramas de reloj/meridiano apliquen.
  const src = text.replace(/\bcon\s+(\d{1,2})\s+minutos?\b/gi, ' :$1');

  // 1) Selector ÚNICO compartido (misma regla que temporal/horario): si hay
  //    varias horas gana la de meridiem explícito —incluida la corrección
  //    posterior—; cubre mediodía/medianoche, 'a las N', 'at N' y 'N am/pm'.
  const picked = pickTimeOfDay(src);
  if (picked.timeOfDay) {
    const [hour, minute] = picked.timeOfDay.split(':').map((n) => parseInt(n, 10));
    return { hour, minute };
  }

  // 2) Formas LITERALES que el selector no cubre: 'HH:mm' y 'HH mm' (ASR).
  const clock = /(?:a\s+las?\s+)?(\d{1,2})[.:](\d{2})\b|(?:a\s+las?\s+)?(\d{1,2})\s+(\d{2})\b/i.exec(src);
  if (clock) {
    const hour = parseInt(clock[1] || clock[3], 10);
    if (hour > 23) return null;
    const minRaw = clock[2] || clock[4];
    return { hour, minute: minRaw ? parseInt(minRaw, 10) : 0 };
  }

  return null;
}

// ------------------------------------------------------------
// Parser principal
// ------------------------------------------------------------

/**
 * Resuelve una expresión temporal en lenguaje natural a un timestamp.
 * Devuelve null si no reconoce ninguna expresión.
 */
export function parseNlDateTime(
  input: string,
  options: NlDateParserOptions = {},
): NlDateTimeResult | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  let text = normalize(raw);
  // El ASR (Chrome) transcribe "a las 2 con 13 minutos p.m" con conector
  // verbal; se normaliza ANTES de la rama OFFSET para que "13 minutos" no
  // se lea como desplazamiento relativo ("en 13 minutos").
  text = text.replace(/\bcon\s+(\d{1,2})\s+minutos?\b/g, ' :$1');

  const now = options.now ? options.now() : Date.now();
  const nowDate = new Date(now);

  // --- 1) Desplazamiento relativo 'en N unidades' -----------------
  for (const unit of OFFSET_UNITS) {
    const match = unit.pattern.exec(text);
    if (match) {
      const amount = parseInt(match[1], 10);
      const at = now + amount * unit.ms;
      return {
        type: 'offset',
        at,
        matchedText: match[0],
        label: `en ${amount} ${amount === 1 ? unit.label : unit.label + 's'}`,
      };
    }
  }

  // --- 2) Fecha absoluta 'el 25 de diciembre' / 'december 25th' ----
  const absolute = /(?:el\s+)?(\d{1,2})\s+(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)|(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?/i.exec(
    text,
  );
  if (absolute) {
    // Grupos de la expresión absoluta: 1=día(es), 2=mes(es), 3=mes(en), 4=día(en).
    const monthNameEs = absolute[2];
    const monthNameEn = absolute[3];
    const dayEs = absolute[1] ? parseInt(absolute[1], 10) : null;
    const dayEn = absolute[4] ? parseInt(absolute[4], 10) : null;
    const monthEntry =
      (monthNameEs && MONTHS_ES.find((m) => m.name === monthNameEs)) ||
      (monthNameEn && MONTHS_EN.find((m) => m.name === monthNameEn));
    const day = dayEs ?? dayEn;
    if (monthEntry && day !== null && day >= 1 && day <= 31) {
      let base = new Date(nowDate.getFullYear(), monthEntry.number - 1, day);
      if (base.getTime() <= now - (now % DAY_MS)) {
        base = new Date(nowDate.getFullYear() + 1, monthEntry.number - 1, day);
      }
      const time = extractTime(text);
      const at = time
        ? applyHourMinute(base, time.hour, time.minute).getTime()
        : base.getTime();
      if (at <= now) {
        // Fecha con hora ya pasada → pasa al año siguiente.
        const nextYear = new Date(nowDate.getFullYear() + 1, monthEntry.number - 1, day);
        return {
          type: 'absolute',
          at: time ? applyHourMinute(nextYear, time.hour, time.minute).getTime() : nextYear.getTime(),
          matchedText: absolute[0],
          label: `el ${day} de ${monthEntry.name}`,
        };
      }
      return {
        type: 'absolute',
        at,
        matchedText: absolute[0],
        label: `el ${day} de ${monthEntry.name}`,
      };
    }
  }

  // --- 3) Parte del día 'esta tarde/noche' ------------------------
  for (const part of PART_OF_DAY) {
    const match = part.pattern.exec(text);
    if (match) {
      const at = applyHourMinute(startOfDay(nowDate), part.hour, 0).getTime();
      return { type: 'part-of-day', at, matchedText: match[0], label: part.label };
    }
  }

  // --- 4) Día de la semana -----------------------------------------
  // 'el próximo lunes' / 'next monday' → +1 semana de margen.
  const weekdayNext = /(?:el\s+)?proximo\s+(domingo|lunes|martes|miercoles|jueves|viernes|sabado)|next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i.exec(
    text,
  );
  if (weekdayNext) {
    const nameEs = weekdayNext[1];
    const nameEn = weekdayNext[2];
    const entry =
      (nameEs && WEEKDAYS.find((w) => w.name === nameEs)) ||
      (nameEn && WEEKDAYS_EN.find((w) => w.name === nameEn));
    if (entry) {
      const base = nextWeekday(nowDate, entry.day, 1);
      const time = extractTime(text);
      const at = time ? applyHourMinute(base, time.hour, time.minute).getTime() : base.getTime();
      return {
        type: 'weekday',
        at,
        matchedText: weekdayNext[0],
        label: `el próximo ${spanishWeekdayName(entry.day)}`,
      };
    }
  }

  const weekdayPlain = /(?:el\s+)?(domingo|lunes|martes|miercoles|jueves|viernes|sabado)|(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i.exec(
    text,
  );
  if (weekdayPlain) {
    const nameEs = weekdayPlain[1];
    const nameEn = weekdayPlain[2];
    const entry =
      (nameEs && WEEKDAYS.find((w) => w.name === nameEs)) ||
      (nameEn && WEEKDAYS_EN.find((w) => w.name === nameEn));
    if (entry) {
      const base = nextWeekday(nowDate, entry.day, 0);
      const time = extractTime(text);
      const at = time ? applyHourMinute(base, time.hour, time.minute).getTime() : base.getTime();
      return {
        type: 'weekday',
        at,
        matchedText: weekdayPlain[0],
        label: `el ${spanishWeekdayName(entry.day)}`,
      };
    }
  }

  // --- 5) Relativos: hoy / mañana / pasado mañana ------------------
  const dayAfter = /pasado\s+manana|day\s+after\s+tomorrow|overmorrow/i.exec(text);
  if (dayAfter) {
    const base = startOfDay(nowDate);
    base.setDate(base.getDate() + 2);
    const time = extractTime(text);
    const at = time ? applyHourMinute(base, time.hour, time.minute).getTime() : base.getTime();
    return { type: 'day-after', at, matchedText: dayAfter[0], label: 'pasado mañana' };
  }

  const tomorrow = /\b(manana|tomorrow)\b/i.exec(text);
  if (tomorrow) {
    const base = startOfDay(nowDate);
    base.setDate(base.getDate() + 1);
    const time = extractTime(text);
    const at = time ? applyHourMinute(base, time.hour, time.minute).getTime() : base.getTime();
    return { type: 'tomorrow', at, matchedText: tomorrow[0], label: 'mañana' };
  }

  const today = /\b(hoy|today)\b/i.exec(text);
  if (today) {
    // "hoy" es explícito: SIEMPRE es hoy. No se rueda a mañana aunque la hora
    // ya haya pasado — rodarla aquí era el bug de "hoy" agendado como mañana.
    const base = startOfDay(nowDate);
    const time = extractTime(text);
    const at = time ? applyHourMinute(base, time.hour, time.minute).getTime() : base.getTime();
    return { type: 'today', at, matchedText: today[0], label: 'hoy' };
  }

  // --- 6) Hora simple 'a las 9' / 'at 3' / '14:30' -----------------
  // Sin día explícito: hoy a esa hora (o mañana si ya pasó).
  const timeOnly = extractTime(text);
  if (timeOnly) {
    let at = applyHourMinute(startOfDay(nowDate), timeOnly.hour, timeOnly.minute).getTime();
    if (at <= now) at += DAY_MS;
    const hh = String(timeOnly.hour).padStart(2, '0');
    const mm = String(timeOnly.minute).padStart(2, '0');
    return { type: 'today', at, matchedText: text, label: `a las ${hh}:${mm}` };
  }

  return null;
}

/**
 * Formatea un timestamp para mensajes de confirmación (es).
 */
export function describeNlDateTime(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const startToday = startOfDay(now).getTime();
  const startTomorrow = startToday + DAY_MS;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (at >= startToday && at < startTomorrow) return `hoy a las ${time}`;
  if (at >= startTomorrow && at < startTomorrow + DAY_MS) return `mañana a las ${time}`;
  return `${formatLabelDate(at)} a las ${time}`;
}
