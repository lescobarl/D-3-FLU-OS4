// ============================================================
// Reminder Scheduler — Recordatorios (B3)
// ------------------------------------------------------------
// Lógica pura y determinista para detectar recordatorios vencidos.
// Regla #1: sin hardcode; el intervalo y la gracia viven en
// FLU_CONFIG.reminders (tickMs, graceMs).
// ============================================================

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

/**
 * Determina si un vencimiento ya ocurrió.
 * `graceMs` permite tolerar un pequeño desfase sin re-disparar.
 */
export function isDue(dueAt: number, now: number, graceMs = 0): boolean {
  return dueAt <= now + graceMs;
}

/**
 * Recoge los ítems vencidos entre los estados indicados.
 * Devuelve el arreglo de coincidencias (orden estable de entrada).
 */
export function collectDue<T extends DueCandidate>(
  items: readonly T[],
  now: number,
  statuses: readonly string[] = ['pending'],
  graceMs = 0,
): T[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const active = new Set(statuses);
  return items.filter((item) => active.has(item.status) && isDue(item.dueAt, now, graceMs));
}

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
export function collectDueOrdered<T extends DueCandidate>(
  items: readonly T[],
  now: number,
  statuses: readonly string[] = ['pending'],
  limit = 20,
  graceMs = 0,
): T[] {
  return collectDue(items, now, statuses, graceMs)
    .slice()
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, Math.max(0, limit));
}
