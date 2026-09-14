// ============================================================
// temporalDedup — Deduplicación de alarmas/temporizadores
// ------------------------------------------------------------
// Fuente única del criterio de "ya existe". Compara el DATETIME
// completo del disparador + la recurrencia + la etiqueta, no sólo
// la hora, para que dos alarmas a la misma hora en días distintos
// sean ítems distintos.
// ============================================================

import type { TemporalItemRecord, TemporalRecurrence, TemporalTrigger } from './temporalTypes';

export interface WantedTemporalItem {
  trigger?: TemporalTrigger;
  recurrence?: TemporalRecurrence;
  label?: string;
}

/** Clave canónica del disparador: incluye fecha+hora, no sólo HH:MM. */
function triggerKey(trigger?: TemporalTrigger): string {
  if (!trigger) return '';
  switch (trigger.kind) {
    case 'absolute':
      return typeof trigger.at === 'number' && Number.isFinite(trigger.at)
        ? `absolute:${trigger.at}`
        : '';
    case 'daily':
      return typeof trigger.timeOfDay === 'string' ? `daily:${trigger.timeOfDay}` : '';
    case 'countdown':
      return typeof trigger.at === 'number' && typeof trigger.durationMs === 'number'
        ? `countdown:${trigger.at}:${trigger.durationMs}`
        : '';
    default:
      return '';
  }
}

/** Clave canónica de la recurrencia (tipo + días + intervalo). */
function recurrenceKey(recurrence?: TemporalRecurrence): string {
  const kind = String(recurrence?.kind || 'once');
  const days = Array.isArray(recurrence?.days)
    ? recurrence.days.slice().sort((a, b) => a - b).join(',')
    : '';
  const everyMs = typeof recurrence?.everyMs === 'number' ? recurrence.everyMs : '';
  return `${kind}|${days}|${everyMs}`;
}

/**
 * true si `wanted` ya existe en `existing` con el MISMO datetime,
 * recurrencia y etiqueta. Un trigger sin clave canónica no deduplica.
 */
export function isDuplicateTemporalItem(
  existing: Pick<TemporalItemRecord, 'trigger' | 'recurrence' | 'label'>,
  wanted: WantedTemporalItem,
): boolean {
  const wantedKey = triggerKey(wanted.trigger);
  if (!wantedKey) return false;
  return (
    triggerKey(existing.trigger) === wantedKey &&
    recurrenceKey(existing.recurrence) === recurrenceKey(wanted.recurrence) &&
    String(existing.label) === String(wanted.label ?? '')
  );
}
