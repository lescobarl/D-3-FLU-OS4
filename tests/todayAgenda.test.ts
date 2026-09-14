// ============================================================
// todayAgenda.test.ts — Guard de COMPORTAMIENTO (caso 1)
// ------------------------------------------------------------
// "¿qué hay para hoy?" debe listar citas/juntas (horario de hoy),
// recordatorios, alarmas y notas pendientes de forma DETERMINISTA
// (sin depender del LLM). Nace ROJO mientras la agenda solo junte
// minutas + recordatorios y no exista la acción agenda.today.
// ============================================================
import { describe, expect, it } from 'vitest';
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter';
import { parseAgendaIntent } from '../src/core/agenda/agendaIntentParser';
import { buildTodayAgenda } from '../src/core/agenda/todayAgenda';
import type { HorarioRecord, ReminderRecord } from '../src/core/db/fluDatabase';
import type { TemporalItemRecord } from '../src/core/temporal/temporalTypes';

// Miércoles 14/01/2026 10:00 local (ISO día 3 = miércoles).
const NOW = new Date(2026, 0, 14, 10, 0, 0, 0).getTime();

const SYNC = { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false };

function makeHorario(overrides: Partial<HorarioRecord>): HorarioRecord {
  return {
    id: 'h1',
    materia: 'matemáticas',
    dia: 3,
    inicio: '08:00',
    fin: '09:00',
    createdAt: NOW,
    updatedAt: NOW,
    sync: { ...SYNC },
    ...overrides,
  };
}

function makeReminder(overrides: Partial<ReminderRecord>): ReminderRecord {
  return {
    id: 'r1',
    text: 'cita con el doctor',
    dueAt: new Date(2026, 0, 14, 12, 30, 0, 0).getTime(),
    category: 'cita',
    status: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
    sync: { ...SYNC },
    ...overrides,
  };
}

function makeAlarm(overrides: Partial<TemporalItemRecord>): TemporalItemRecord {
  return {
    id: 'a1',
    kind: 'alarm',
    label: 'despertador',
    trigger: { kind: 'absolute', at: new Date(2026, 0, 14, 7, 0, 0, 0).getTime() },
    recurrence: { kind: 'once' },
    nextAt: new Date(2026, 0, 14, 7, 0, 0, 0).getTime(),
    status: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
    sync: { ...SYNC },
    ...overrides,
  };
}

describe('caso 1 — reconocimiento determinista de "¿qué hay para hoy?"', () => {
  it('parseAgendaIntent reconoce "¿qué hay para hoy?" como agenda.today', () => {
    expect(parseAgendaIntent('¿qué hay para hoy?')).toEqual({
      handled: true,
      action: 'agenda.today',
      data: { when: 'hoy' },
      reply: '',
    });
    expect(parseAgendaIntent('ok flu agenda de hoy').action).toBe('agenda.today');
  });

  it('el árbitro enruta "qué hay para hoy" a agenda (0 IA)', () => {
    const result = resolveDeterministicCommand('qué hay para hoy', { language: 'es' });
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('agenda');
    expect(result.channel).toBe('flu');
    const action = result.action as { handled?: boolean; action?: string };
    expect(action.handled).toBe(true);
    expect(action.action).toBe('agenda.today');
  });

  it('"qué clases tengo hoy" sigue siendo horario.query (no agenda)', () => {
    const result = resolveDeterministicCommand('qué clases tengo hoy', { language: 'es' });
    expect(result.domain).toBe('horario');
  });
});

describe('caso 1 — compilador determinista de la agenda del día', () => {
  it('lista horario + recordatorios/citas + alarmas + notas pendientes', () => {
    const text = buildTodayAgenda({
      horario: [
        makeHorario({ id: 'h1', materia: 'matemáticas', dia: 3, inicio: '08:00', fin: '09:00' }),
        makeHorario({ id: 'h2', materia: 'junta de equipo', dia: 3, inicio: '11:00', fin: '12:00' }),
        makeHorario({ id: 'h3', materia: 'natación', dia: 5, inicio: '10:00', fin: '11:00' }), // viernes: NO hoy
      ],
      reminders: [
        makeReminder({ id: 'r1', text: 'cita con el doctor', dueAt: new Date(2026, 0, 14, 12, 30, 0, 0).getTime() }),
        makeReminder({ id: 'r2', text: 'otro día', dueAt: new Date(2026, 0, 15, 9, 0, 0, 0).getTime() }), // mañana
      ],
      alarms: [
        makeAlarm({ id: 'a1', label: 'despertador', nextAt: new Date(2026, 0, 14, 7, 0, 0, 0).getTime() }),
      ],
      notes: [
        { label: 'Super: cloro', done: false },
        { label: 'ya hecha', done: true },
      ],
      now: NOW,
      language: 'es',
    });

    expect(text).toContain('matemáticas');
    expect(text).toContain('junta de equipo');
    expect(text).toContain('cita con el doctor');
    expect(text).toContain('despertador');
    expect(text).toContain('Super: cloro');
    // Excluye lo que NO es de hoy o ya está hecho.
    expect(text).not.toContain('natación');
    expect(text).not.toContain('otro día');
    expect(text).not.toContain('ya hecha');
  });

  it('devuelve el mensaje de vacío cuando no hay nada para hoy', () => {
    const text = buildTodayAgenda({
      horario: [],
      reminders: [],
      alarms: [],
      notes: [],
      now: NOW,
      language: 'es',
    });
    expect(text).toBe('No tienes nada programado para hoy.');
  });

  it('incluye alarmas diarias (recurrentes) aunque su nextAt no sea hoy', () => {
    const text = buildTodayAgenda({
      horario: [],
      reminders: [],
      alarms: [
        makeAlarm({
          id: 'a1',
          label: 'medicamento',
          trigger: { kind: 'daily', timeOfDay: '07:30' },
          recurrence: { kind: 'daily' },
          nextAt: new Date(2026, 0, 15, 7, 30, 0, 0).getTime(),
        }),
      ],
      notes: [],
      now: NOW,
      language: 'es',
    });
    expect(text).toContain('medicamento');
    expect(text).toContain('07:30');
  });
});
