// ============================================================
// Motor Temporal Genérico — Tipos compartidos
// ------------------------------------------------------------
// Un recordatorio, una alarma y un temporizador son el mismo
// concepto: DISPARADOR (cuándo) + RECURRENCIA (cómo se repite)
// + ENTREGA (cómo avisa). Este archivo es la fuente única de
// verdad de esos tipos (Regla de oro).
// Regla #1: sin hardcode — los límites y textos viven en
// FLU_CONFIG.temporal; aquí solo viven los contratos de datos.
// ============================================================

import type { SyncTuple } from '../db/fluDatabase';

// ------------------------------------------------------------
// Disparador: de dónde sale el "cuándo"
// ------------------------------------------------------------
export type TemporalTriggerKind = 'absolute' | 'daily' | 'countdown';

export interface TemporalTrigger {
  kind: TemporalTriggerKind;
  /** absolute / countdown: referencia temporal en ms epoch. */
  at?: number;
  /** countdown: duración en ms. */
  durationMs?: number;
  /** daily: hora local 'HH:MM' (formato 24 h). */
  timeOfDay?: string;
}

// ------------------------------------------------------------
// Recurrencia: cómo se repite tras disparar
// ------------------------------------------------------------
export type TemporalRecurrenceKind = 'once' | 'daily' | 'weekdays' | 'interval';

export interface TemporalRecurrence {
  kind: TemporalRecurrenceKind;
  /** weekdays: 0=Domingo ... 6=Sábado. */
  days?: number[];
  /** interval: cada N ms. */
  everyMs?: number;
}

// ------------------------------------------------------------
// Ítems temporales persistentes (alarmas y temporizadores)
// ------------------------------------------------------------
export type TemporalItemKind = 'alarm' | 'timer';
export type TemporalItemStatus = 'pending' | 'done' | 'cancelled';

/**
 * Registro persistente de una alarma o un temporizador.
 * `nextAt` es el próximo disparo derivado de `trigger`+`recurrence`
 * (lo calcula scheduleEngine en el servicio y lo re-arranca el hook).
 */
export interface TemporalItemRecord {
  id: string; // UUIDv4 (Obligación #6)
  kind: TemporalItemKind;
  label: string;
  trigger: TemporalTrigger;
  recurrence: TemporalRecurrence;
  /** Próximo disparo en ms epoch (determinista para el scheduler). */
  nextAt: number;
  status: TemporalItemStatus;
  message?: string;
  createdAt: number;
  updatedAt: number;
  sync: SyncTuple; // Obligación #7
}

// ------------------------------------------------------------
// Recurrencia de recordatorios (extensión de ReminderRecord.repeat)
// ------------------------------------------------------------
export type ReminderRepeat = TemporalRecurrence;

// ------------------------------------------------------------
// Constructores declarativos (evitan objetos sueltos y hardcode)
// ------------------------------------------------------------
export function onceRecurrence(): TemporalRecurrence {
  return { kind: 'once' };
}

export function dailyRecurrence(): TemporalRecurrence {
  return { kind: 'daily' };
}

export function weekdaysRecurrence(days: number[]): TemporalRecurrence {
  return { kind: 'weekdays', days: days.slice() };
}

export function intervalRecurrence(everyMs: number): TemporalRecurrence {
  return { kind: 'interval', everyMs };
}
