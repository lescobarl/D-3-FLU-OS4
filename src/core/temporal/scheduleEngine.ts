// ============================================================
// Motor Temporal Genérico — Lógica pura y determinista
// ------------------------------------------------------------
// Este módulo UNIFICA recordatorios, alarmas y temporizadores
// bajo una sola abstracción: trigger + recurrencia.
//   - nextOccurrence: próximo disparo estrictamente después de `after`.
//   - firstDueAt: primer disparo al crear un ítem.
//   - timerRemainingMs / formatCountdown: matemática de cuenta regresiva.
//   - collectDueOrdered: vencidos (mismo patrón probado que reminderScheduler).
// Regla #1: sin hardcode; sin DOM, sin Dexie, sin Gemini — 100% puro.
// ============================================================

import type { TemporalRecurrence, TemporalTrigger } from './temporalTypes';

// ------------------------------------------------------------
// Constantes de tiempo
// ------------------------------------------------------------
export const MS_SECOND = 1000;
export const MS_MINUTE = 60 * MS_SECOND;
export const MS_HOUR = 60 * MS_MINUTE;
export const MS_DAY = 24 * MS_HOUR;

// ------------------------------------------------------------
// Helpers de tiempo local
// ------------------------------------------------------------

export function startOfLocalDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Día de la semana local: 0=Domingo ... 6=Sábado (coincide con Date.getDay). */
export function dayOfWeek(at: number): number {
  return new Date(at).getDay();
}

/** 'HH:MM' local → ms desde medianoche; null si el formato es inválido. */
export function parseTimeOfDayToMs(timeOfDay: string | undefined): number | null {
  if (!timeOfDay) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(timeOfDay.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * MS_HOUR + min * MS_MINUTE;
}

/** 'HH:MM' local a partir de un timestamp. */
export function formatTimeOfDay(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Hora en reloj de 12 horas CON meridiano a partir de un timestamp.
 * Ej (es): "5:13 p.m." · (en): "5:13 PM". Mantiene 24h solo si el
 * reloj del sistema lo está (hour12=false → HH:MM).
 */
export function formatTimeOfDayMeridiem(at: number, lang: string): string {
  const d = new Date(at);
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const isPm = h24 >= 12;
  const meridiem = isPm ? 'p.m.' : 'a.m.';
  const meridiemEn = isPm ? 'PM' : 'AM';
  return `${h12}:${mm} ${lang === 'en' ? meridiemEn : meridiem}`;
}

// ------------------------------------------------------------
// Núcleo: próximo disparo estrictamente después de `after`
// ------------------------------------------------------------

/**
 * Siguiente momento en que cae `msOfDay` (hora del día) tras `after`,
 * respetando la recurrencia (daily: todos los días; weekdays: días dados).
 */
function nextAtTimeOfDay(
  msOfDay: number,
  after: number,
  recurrence: { kind: string; days?: number[] },
): number {
  const daySet =
    recurrence.kind === 'weekdays' && recurrence.days && recurrence.days.length > 0
      ? new Set(recurrence.days)
      : null;
  let day = startOfLocalDay(after);
  // Escaneo de 8 días: cubre siempre los 7 de la semana.
  for (let i = 0; i < 8; i += 1) {
    const candidate = day + msOfDay;
    if (candidate > after && (!daySet || daySet.has(dayOfWeek(candidate)))) {
      return candidate;
    }
    day += MS_DAY;
  }
  return day + msOfDay; // garantía: cae dentro de la próxima semana
}

/**
 * Próximo disparo estrictamente posterior a `after`.
 * Devuelve null cuando no habrá más disparos (recurrencia `once` agotada).
 */
export function nextOccurrence(
  trigger: TemporalTrigger | undefined | null,
  recurrence: TemporalRecurrence | undefined | null,
  after: number,
): number | null {
  if (!trigger) return null;
  const rc: TemporalRecurrence = recurrence || { kind: 'once' };

  // Intervalo: el disparo se repite cada `everyMs` desde `after`.
  if (rc.kind === 'interval') {
    if (rc.everyMs && rc.everyMs > 0) return after + rc.everyMs;
  }

  switch (trigger.kind) {
    case 'absolute': {
      // Un solo disparo absoluto.
      if (rc.kind === 'once') {
        return trigger.at !== undefined && trigger.at > after ? trigger.at : null;
      }
      // Recurrencia por hora del día derivada del timestamp original.
      if (rc.kind === 'daily' || rc.kind === 'weekdays') {
        if (trigger.at === undefined) return null;
        const msOfDay = trigger.at - startOfLocalDay(trigger.at);
        return nextAtTimeOfDay(msOfDay, after, rc);
      }
      return null;
    }
    case 'daily': {
      const msOfDay = parseTimeOfDayToMs(trigger.timeOfDay);
      if (msOfDay === null) return null;
      return nextAtTimeOfDay(msOfDay, after, rc);
    }
    case 'countdown': {
      // La cuenta regresiva es de un solo disparo: nextAt = at + durationMs
      // (se calcula en firstDueAt). Tras disparar no hay siguiente.
      return null;
    }
    default:
      return null;
  }
}

/** Primer disparo al crear un ítem temporal. */
export function firstDueAt(
  trigger: TemporalTrigger | undefined | null,
  recurrence: TemporalRecurrence | undefined | null,
  now: number,
): number | null {
  if (!trigger) return null;
  if (trigger.kind === 'countdown') {
    if (trigger.at === undefined || trigger.durationMs === undefined || trigger.durationMs < 0) {
      return null;
    }
    return trigger.at + trigger.durationMs;
  }
  return nextOccurrence(trigger, recurrence, now - 1);
}

// ------------------------------------------------------------
// Temporizadores: cuenta regresiva
// ------------------------------------------------------------

export function timerEndsAt(trigger: TemporalTrigger | undefined | null): number | null {
  if (!trigger || trigger.kind !== 'countdown') return null;
  if (trigger.at === undefined || trigger.durationMs === undefined) return null;
  return trigger.at + trigger.durationMs;
}

export function timerRemainingMs(
  trigger: TemporalTrigger | undefined | null,
  now: number,
): number | null {
  const endsAt = timerEndsAt(trigger);
  if (endsAt === null) return null;
  return Math.max(0, endsAt - now);
}

/** Cuenta regresiva legible 'MM:SS' o 'H:MM:SS' (pura, sin locales). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / MS_SECOND));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ------------------------------------------------------------
// Vencidos — candidato mínimo (id + nextAt + status)
// ------------------------------------------------------------

export interface TemporalCandidate {
  id: string;
  nextAt: number;
  status: string;
}

export function isDue(nextAt: number, now: number, graceMs = 0): boolean {
  return nextAt <= now + graceMs;
}

export function collectDue<T extends TemporalCandidate>(
  items: readonly T[],
  now: number,
  statuses: readonly string[] = ['pending'],
  graceMs = 0,
): T[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const active = new Set(statuses);
  return items.filter((item) => active.has(item.status) && isDue(item.nextAt, now, graceMs));
}

/** Vencidos ordenados del más antiguo al más reciente, limitado a `limit`. */
export function collectDueOrdered<T extends TemporalCandidate>(
  items: readonly T[],
  now: number,
  statuses: readonly string[] = ['pending'],
  limit = 20,
  graceMs = 0,
): T[] {
  return collectDue(items, now, statuses, graceMs)
    .slice()
    .sort((a, b) => a.nextAt - b.nextAt)
    .slice(0, Math.max(0, limit));
}
