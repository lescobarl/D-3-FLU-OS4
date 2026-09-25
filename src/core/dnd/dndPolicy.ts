// ============================================================
// DND Policy — No molestar (Fase 1, D2)
// ------------------------------------------------------------
// Lógica pura y determinista para el horario "no molestar".
// Regla #1: sin hardcode; la configuración vive en FLU_CONFIG.dnd
// y los overrides del usuario en STORAGE_KEYS.DND_*.
// ============================================================

export interface DndSchedule {
  /** Hora de inicio en formato 24h 'HH:mm'. */
  start: string;
  /** Hora de fin en formato 24h 'HH:mm'. */
  end: string;
}

export interface DndConfig {
  enabled: boolean;
  schedule: DndSchedule;
  /** true = las notificaciones urgentes siguen pasando durante el DND. */
  allowUrgent: boolean;
  /** Intervalo de re-evaluación del hook (ms). */
  tickMs?: number;
}

const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * Convierte 'HH:mm' (24h) a minutos desde medianoche.
 * Devuelve null si el formato no es válido.
 */
export function parseTimeToMinutes(value: string): number | null {
  if (typeof value !== 'string') return null;
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

/**
 * Determina si el DND está activo en el instante `now`.
 * - Rango normal (start < end): activo cuando start <= now < end.
 * - Rango nocturno (start > end, cruza medianoche): activo cuando
 *   now >= start o now < end.
 * - start === end: rango vacío, nunca activo.
 */
export function isDoNotDisturbActive(
  now: Date,
  config: Pick<DndConfig, 'enabled' | 'schedule'>,
): boolean {
  if (!config.enabled) return false;
  const start = parseTimeToMinutes(config.schedule.start);
  const end = parseTimeToMinutes(config.schedule.end);
  if (start === null || end === null || start === end) return false;

  const current = now.getHours() * 60 + now.getMinutes();
  if (start > end) {
    return current >= start || current < end;
  }
  return current >= start && current < end;
}

/** Representación legible del horario ('HH:mm – HH:mm') o '—' si es inválido. */
export function describeDndSchedule(config: Pick<DndConfig, 'schedule'>): string {
  const { start, end } = config.schedule;
  if (parseTimeToMinutes(start) === null || parseTimeToMinutes(end) === null) return '—';
  return `${start} – ${end}`;
}
