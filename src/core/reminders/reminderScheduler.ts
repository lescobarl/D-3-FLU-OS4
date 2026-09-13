// ============================================================
// Reminder Scheduler — Recordatorios (B3)
// ------------------------------------------------------------
// ADAPTADOR del motor de vencimiento ÚNICO (scheduleEngine). No
// redefine `isDue` / `collectDue` / `collectDueOrdered`: re-exporta
// el primero y envuelve los otros dos mapeando el campo del dominio
// (`dueAt`) al genérico (`nextAt`). El algoritmo vive una sola vez
// en `src/core/temporal/scheduleEngine.ts`.
// Regla #1: sin hardcode; el intervalo y la gracia viven en
// FLU_CONFIG.reminders (tickMs, graceMs).
// ============================================================

import {
  collectDue as collectDueGeneric,
  collectDueOrdered as collectDueOrderedGeneric,
} from '../temporal/scheduleEngine';

/** Forma mínima que el scheduler necesita de un recordatorio. */
export interface DueCandidate {
  id: string;
  dueAt: number;
  status: string;
}

export interface ReminderSchedulerOptions {
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
}

/** Campo del dominio (`dueAt`) → campo genérico del motor (`nextAt`). */
function toTemporal<T extends DueCandidate>(item: T): T & { nextAt: number } {
  return { ...item, nextAt: item.dueAt };
}

/** Revierte el mapeo y devuelve la forma del dominio, sin el campo genérico. */
function fromTemporal<T extends DueCandidate>(item: T & { nextAt: number }): T {
  const rest = { ...item };
  delete (rest as { nextAt?: number }).nextAt;
  return rest;
}

/**
 * Determina si un vencimiento ya ocurrió.
 * `graceMs` permite tolerar un pequeño desfase sin re-disparar.
 * Semántica idéntica a la del motor genérico (delegada).
 */
export { isDue } from '../temporal/scheduleEngine';

/**
 * Recoge los ítems vencidos entre los estados indicados.
 * Devuelve el arreglo de coincidencias (orden estable de entrada).
 */
export const collectDue = <T extends DueCandidate>(
  items: readonly T[],
  now: number,
  statuses: readonly string[] = ['pending'],
  graceMs = 0,
): T[] =>
  collectDueGeneric(items.map(toTemporal), now, statuses, graceMs).map(fromTemporal);

/**
 * Milisegundos hasta el próximo vencimiento pendiente, o null si no hay.
 * Un valor <= 0 significa que ya está vencido.
 */
export function nextDueIn<T extends DueCandidate>(
  items: readonly T[],
  now: number,
  statuses: readonly string[] = ['pending'],
): number | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const active = new Set(statuses);
  let earliest: number | null = null;
  for (const item of items) {
    if (!active.has(item.status)) continue;
    if (earliest === null || item.dueAt < earliest) earliest = item.dueAt;
  }
  if (earliest === null) return null;
  return earliest - now;
}

/**
 * Los vencidos más antiguos primero, limitado a `limit`.
 * Útil para procesar lotes en cada tick sin saturar las notificaciones.
 */
export const collectDueOrdered = <T extends DueCandidate>(
  items: readonly T[],
  now: number,
  statuses: readonly string[] = ['pending'],
  limit = 20,
  graceMs = 0,
): T[] =>
  collectDueOrderedGeneric(items.map(toTemporal), now, statuses, limit, graceMs).map(fromTemporal);
