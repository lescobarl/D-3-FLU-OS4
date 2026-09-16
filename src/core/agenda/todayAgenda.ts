// ============================================================
// todayAgenda — Compilador DETERMINISTA de la agenda del día
// ------------------------------------------------------------
// "¿qué hay para hoy?" se responde SIN depender del LLM: esta
// función pura junta, desde las fuentes reales (Dexie vía hooks),
// las citas/juntas (horario de hoy), recordatorios, alarmas y
// notas pendientes del día en una sola lista hablable.
//
// Cumple:
//   - Rule #1: NO HARDCODE — etiquetas de sección inyectadas
//     (labels), con defaults es/en.
//   - Pure functions — sin React ni DOM (testeable con vitest).
// ============================================================

import { diaDeFecha, toMin } from '../agenda/agendaShared';
import type { HorarioRecord, ReminderRecord } from '../db/fluDatabase';
import type { TemporalItemRecord } from '../temporal/temporalTypes';

// -----------------------------------------------------------
// Tipos
// -----------------------------------------------------------

/** Forma mínima de una nota pendiente (label + done). */
export interface TodayAgendaNote {
  label: string;
  done: boolean;
}

export interface TodayAgendaInput {
  /** Entradas de horario (clases, juntas, consultas…). */
  horario: readonly HorarioRecord[];
  /** Recordatorios y citas. */
  reminders: readonly ReminderRecord[];
  /** Alarmas (se excluyen los temporizadores). */
  alarms: readonly TemporalItemRecord[];
  /** Notas pendientes. */
  notes: readonly TodayAgendaNote[];
  /** Reloj de referencia (por defecto: Date.now()). */
  now?: number;
  /** Idioma ('es' | 'en'). */
  language?: 'es' | 'en';
  /** Etiquetas de sección inyectadas (opcional; usa defaults). */
  labels?: Partial<TodayAgendaLabels>;
}

export interface TodayAgendaLabels {
  horario: { es: string; en: string };
  reminders: { es: string; en: string };
  alarms: { es: string; en: string };
  notes: { es: string; en: string };
  empty: { es: string; en: string };
}

export const DEFAULT_TODAY_AGENDA_LABELS: TodayAgendaLabels = {
  horario: { es: 'Agenda de hoy', en: "Today's agenda" },
  reminders: { es: 'Recordatorios y citas', en: 'Reminders and appointments' },
  alarms: { es: 'Alarmas', en: 'Alarms' },
  notes: { es: 'Notas pendientes', en: 'Pending notes' },
  empty: { es: 'No tienes nada programado para hoy.', en: "You have nothing scheduled for today." },
};

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

/** ¿Dos timestamps caen en el MISMO día local? */
function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** Hora local 'HH:MM' de un timestamp. */
function localHHMM(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Texto de una sección según idioma. */
function pickLabel(
  labels: TodayAgendaLabels,
  key: keyof Omit<TodayAgendaLabels, 'empty'>,
  language: 'es' | 'en',
): string {
  const section = labels[key];
  return language === 'en' ? section.en : section.es;
}

// -----------------------------------------------------------
// Compilador
// -----------------------------------------------------------

/**
 * Compila la agenda del DÍA de hoy de forma determinista.
 * Secciones (en orden): horario de hoy → recordatorios y citas →
 * alarmas → notas pendientes. Devuelve '' si no hay nada.
 *
 * @param input Datos reales (horario/reminders/alarms/notes) + reloj + idioma.
 * @returns Texto hablable con la agenda del día, o '' si está vacía.
 */
export function buildTodayAgenda(input: TodayAgendaInput): string {
  const now = typeof input.now === 'number' ? input.now : Date.now();
  const language: 'es' | 'en' = input.language === 'en' ? 'en' : 'es';
  const labels: TodayAgendaLabels = { ...DEFAULT_TODAY_AGENDA_LABELS, ...(input.labels || {}) };

  const todayIso = diaDeFecha(now);

  // 1) Horario de hoy (clases/juntas/consultas) ordenado por hora de inicio.
  const horarioLines = (input.horario || [])
    .filter((r) => r && r.dia === todayIso)
    .slice()
    .sort((a, b) => toMin(a.inicio) - toMin(b.inicio))
    .map((r) => {
      const time = r.fin ? `${r.inicio} a ${r.fin}` : r.inicio;
      return `${time} ${r.materia}`;
    });

  // 2) Recordatorios y citas pendientes del día, por vencimiento.
  const reminderLines = (input.reminders || [])
    .filter((r) => r && r.status === 'pending' && isSameLocalDay(r.dueAt, now))
    .slice()
    .sort((a, b) => a.dueAt - b.dueAt)
    .map((r) => {
      const text = String(r.text || '').trim();
      return text ? `${localHHMM(r.dueAt)} ${text}` : localHHMM(r.dueAt);
    });

  // 3) Alarmas pendientes del día (diarias o con próximo disparo hoy).
  const alarmLines = (input.alarms || [])
    .filter(
      (a) =>
        a &&
        a.kind === 'alarm' &&
        a.status === 'pending' &&
        (a.trigger?.kind === 'daily' || isSameLocalDay(a.nextAt, now)),
    )
    .slice()
    .sort((a, b) => {
      const ta = a.trigger?.kind === 'daily' ? toMin(a.trigger.timeOfDay || '') : localHHMM(a.nextAt);
      const tb = b.trigger?.kind === 'daily' ? toMin(b.trigger.timeOfDay || '') : localHHMM(b.nextAt);
      return String(ta).localeCompare(String(tb));
    })
    .map((a) => {
      const time =
        a.trigger?.kind === 'daily' ? (a.trigger.timeOfDay || '') : localHHMM(a.nextAt);
      const label = String(a.label || '').trim();
      return label ? `${time} ${label}` : time;
    });

  // 4) Notas pendientes.
  const noteLines = (input.notes || [])
    .filter((n) => n && !n.done)
    .map((n) => String(n.label || '').trim())
    .filter(Boolean);

  const sections: string[] = [];
  if (horarioLines.length > 0) {
    sections.push(`${pickLabel(labels, 'horario', language)}: ${horarioLines.join(', ')}`);
  }
  if (reminderLines.length > 0) {
    sections.push(`${pickLabel(labels, 'reminders', language)}: ${reminderLines.join(', ')}`);
  }
  if (alarmLines.length > 0) {
    sections.push(`${pickLabel(labels, 'alarms', language)}: ${alarmLines.join(', ')}`);
  }
  if (noteLines.length > 0) {
    sections.push(`${pickLabel(labels, 'notes', language)}: ${noteLines.join(', ')}`);
  }

  if (sections.length === 0) {
    return language === 'en' ? labels.empty.en : labels.empty.es;
  }
  return sections.join('. ');
}
