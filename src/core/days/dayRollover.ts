// ============================================================
// dayRollover — Detección de cambio de día para el cierre de sesión
// ------------------------------------------------------------
// Si quedó conversación de un día anterior y nunca se generó su minuta, al
// arrancar hay que cerrar ese día (generar minuta) y empezar limpio, sin
// mezclar días. Este módulo concentra el criterio (puro y testeable).
// ============================================================

import { dayKey } from '../../lib/dateKey'

/**
 * true si hay que cerrar el día anterior:
 *  - existe conversación (`lastEntryAt`),
 *  - su día es anterior a HOY,
 *  - y aún no se cerró HOY (`lastSessionDay !== hoy`).
 */
export function shouldRolloverDay(
  lastEntryAt: number | null | undefined,
  now: number,
  lastSessionDay: string,
): boolean {
  if (!lastEntryAt || !Number.isFinite(lastEntryAt)) return false;
  const today = dayKey(now);
  const entryDay = dayKey(lastEntryAt);
  return entryDay !== today && lastSessionDay !== today;
}
