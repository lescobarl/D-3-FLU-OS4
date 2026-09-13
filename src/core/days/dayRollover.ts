// ============================================================
// dayRollover — Detección de cambio de día para el cierre de sesión
// ------------------------------------------------------------
// Si quedó conversación de un día anterior y nunca se generó su minuta, al
// arrancar hay que cerrar ese día (generar minuta) y empezar limpio, sin
// mezclar días. Este módulo concentra el criterio (puro y testeable).
// ============================================================

/** Clave de día local `YYYY-MM-DD` para un timestamp. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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
