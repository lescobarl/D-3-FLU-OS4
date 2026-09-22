// ============================================================
// scheduleEngine.test.ts — Motor Temporal Genérico (lógica pura)
// ============================================================
import { describe, expect, it } from 'vitest';
import {
  MS_HOUR,
  MS_MINUTE,
  collectDueOrdered,
  dayOfWeek,
  firstDueAt,
  formatCountdown,
  formatTimeOfDay,
  isDue,
  nextOccurrence,
  parseTimeOfDayToMs,
  timerRemainingMs,
} from '../src/core/temporal/scheduleEngine';
import {
  dailyRecurrence,
  intervalRecurrence,
  onceRecurrence,
  weekdaysRecurrence,
} from '../src/core/temporal/temporalTypes';

const at = (y: number, mo: number, d: number, h = 0, mi = 0): number =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

describe('scheduleEngine — helpers de tiempo', () => {
  it('parseTimeOfDayToMs convierte HH:MM local a ms desde medianoche', () => {
    expect(parseTimeOfDayToMs('07:00')).toBe(7 * MS_HOUR);
    expect(parseTimeOfDayToMs('23:59')).toBe(23 * MS_HOUR + 59 * MS_MINUTE);
    expect(parseTimeOfDayToMs('00:00')).toBe(0);
  });

  it('parseTimeOfDayToMs rechaza formatos inválidos y horas fuera de rango', () => {
    expect(parseTimeOfDayToMs(undefined)).toBeNull();
    expect(parseTimeOfDayToMs('25:00')).toBeNull();
    expect(parseTimeOfDayToMs('12:60')).toBeNull();
    expect(parseTimeOfDayToMs('7am')).toBeNull();
  });

  it('formatTimeOfDay produce HH:MM local con ceros', () => {
    expect(formatTimeOfDay(at(2026, 8, 29, 7, 5))).toBe('07:05');
    expect(formatTimeOfDay(at(2026, 8, 29, 23, 59))).toBe('23:59');
  });

  it('dayOfWeek usa convención 0=Domingo...6=Sábado', () => {
    // 2026-08-29 es sábado (getDay() === 6).
    expect(dayOfWeek(at(2026, 8, 29))).toBe(6);
    // 2026-08-31 es lunes.
    expect(dayOfWeek(at(2026, 8, 31))).toBe(1);
  });
});

describe('scheduleEngine — nextOccurrence (absolute)', () => {
  it('once devuelve el disparo si está en el futuro y null si ya pasó', () => {
    const due = at(2026, 8, 29, 9, 0);
    expect(nextOccurrence({ kind: 'absolute', at: due }, onceRecurrence(), at(2026, 8, 29, 8, 0))).toBe(due);
    expect(nextOccurrence({ kind: 'absolute', at: due }, onceRecurrence(), at(2026, 8, 29, 9, 0))).toBeNull();
  });

  it('daily con trigger absolute deriva la hora del timestamp original', () => {
    const due = at(2026, 8, 29, 7, 30);
    const after = at(2026, 8, 29, 12, 0);
    const next = nextOccurrence({ kind: 'absolute', at: due }, dailyRecurrence(), after);
    expect(next).toBe(at(2026, 8, 30, 7, 30)); // mañana a la misma hora
  });

  it('weekdays con trigger absolute respeta el conjunto de días', () => {
    // due en lunes 07:00; after el sábado 08:00 → próximo lunes 07:00.
    const due = at(2026, 8, 31, 7, 0); // lunes
    const after = at(2026, 8, 29, 8, 0); // sábado
    const next = nextOccurrence(
      { kind: 'absolute', at: due },
      weekdaysRecurrence([1, 2, 3, 4, 5]),
      after,
    );
    expect(next).toBe(at(2026, 8, 31, 7, 0));
  });

  it('interval con trigger absolute se repite cada N ms desde after', () => {
    const after = at(2026, 8, 29, 10, 0);
    expect(nextOccurrence({ kind: 'absolute', at: after }, intervalRecurrence(30 * MS_MINUTE), after)).toBe(
      after + 30 * MS_MINUTE,
    );
  });
});

describe('scheduleEngine — nextOccurrence (daily)', () => {
  it('once devuelve hoy si la hora aún no pasó y mañana si ya pasó', () => {
    const today = at(2026, 8, 29, 7, 0);
    expect(nextOccurrence({ kind: 'daily', timeOfDay: '07:00' }, onceRecurrence(), at(2026, 8, 29, 6, 0))).toBe(today);
    expect(nextOccurrence({ kind: 'daily', timeOfDay: '07:00' }, onceRecurrence(), at(2026, 8, 29, 8, 0))).toBe(
      at(2026, 8, 30, 7, 0),
    );
  });

  it('daily salta al día siguiente (no repite el mismo día ya pasado)', () => {
    const after = at(2026, 8, 29, 12, 0);
    const next = nextOccurrence({ kind: 'daily', timeOfDay: '07:00' }, dailyRecurrence(), after);
    expect(next).toBe(at(2026, 8, 30, 7, 0));
  });

  it('weekdays omite el fin de semana', () => {
    // after = sábado 08:00 → próximo lunes 07:00.
    const after = at(2026, 8, 29, 8, 0);
    const next = nextOccurrence(
      { kind: 'daily', timeOfDay: '07:00' },
      weekdaysRecurrence([1, 2, 3, 4, 5]),
      after,
    );
    expect(next).toBe(at(2026, 8, 31, 7, 0));
  });

  it('weekdays con días vacíos se comporta como daily', () => {
    const after = at(2026, 8, 29, 12, 0);
    const next = nextOccurrence({ kind: 'daily', timeOfDay: '07:00' }, weekdaysRecurrence([]), after);
    expect(next).toBe(at(2026, 8, 30, 7, 0));
  });
});

describe('scheduleEngine — countdown y firstDueAt', () => {
  it('firstDueAt de un countdown es at + durationMs', () => {
    const now = at(2026, 8, 29, 10, 0);
    const trigger = { kind: 'countdown' as const, at: now, durationMs: 5 * MS_MINUTE };
    expect(firstDueAt(trigger, onceRecurrence(), now)).toBe(now + 5 * MS_MINUTE);
  });

  it('firstDueAt de un absolute es el timestamp indicado', () => {
    const now = at(2026, 8, 29, 10, 0);
    const due = at(2026, 8, 29, 11, 0);
    expect(firstDueAt({ kind: 'absolute', at: due }, onceRecurrence(), now)).toBe(due);
  });

  it('firstDueAt de daily devuelve la próxima hora del día', () => {
    const now = at(2026, 8, 29, 12, 0);
    expect(firstDueAt({ kind: 'daily', timeOfDay: '07:00' }, dailyRecurrence(), now)).toBe(at(2026, 8, 30, 7, 0));
  });

  it('timerRemainingMs calcula el tiempo restante y se satura en 0', () => {
    const now = at(2026, 8, 29, 10, 0);
    const trigger = { kind: 'countdown' as const, at: now, durationMs: 5 * MS_MINUTE };
    expect(timerRemainingMs(trigger, now + 2 * MS_MINUTE)).toBe(3 * MS_MINUTE);
    expect(timerRemainingMs(trigger, now + 10 * MS_MINUTE)).toBe(0);
    expect(timerRemainingMs({ kind: 'daily', timeOfDay: '07:00' }, now)).toBeNull();
  });
});

describe('scheduleEngine — formatCountdown', () => {
  it('formatea minutos y segundos', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(5 * MS_MINUTE + 30 * 1000)).toBe('05:30');
    expect(formatCountdown(MS_HOUR + MS_MINUTE + 5 * 1000)).toBe('1:01:05');
  });
});

describe('scheduleEngine — vencidos (collectDueOrdered)', () => {
  const items = [
    { id: 'a', nextAt: at(2026, 8, 29, 9, 0), status: 'pending' },
    { id: 'b', nextAt: at(2026, 8, 29, 8, 0), status: 'pending' },
    { id: 'c', nextAt: at(2026, 8, 29, 7, 0), status: 'done' },
    { id: 'd', nextAt: at(2026, 8, 29, 6, 0), status: 'pending' },
  ];
  const now = at(2026, 8, 29, 9, 0);

  it('isDue respeta el margen de gracia', () => {
    expect(isDue(at(2026, 8, 29, 8, 0), now)).toBe(true);
    expect(isDue(at(2026, 8, 29, 9, 0), now)).toBe(true);
    expect(isDue(at(2026, 8, 29, 9, 0), now, -1000)).toBe(false);
  });

  it('recoge solo pendientes vencidos, ordenados por nextAt y limitados', () => {
    const due = collectDueOrdered(items, now, ['pending'], 2);
    expect(due.map((d) => d.id)).toEqual(['d', 'b']);
  });

  it('respeta el límite y excluye estados no activos', () => {
    const due = collectDueOrdered(items, now, ['pending'], 10);
    expect(due.map((d) => d.id)).toEqual(['d', 'b', 'a']);
    const withGrace = collectDueOrdered(items, now - 30 * 60 * 1000, ['pending'], 10);
    expect(withGrace.map((d) => d.id)).toEqual(['d', 'b']);
  });
});
