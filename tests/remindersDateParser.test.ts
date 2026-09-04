// ============================================================
// Fase 2 — Recordatorios (A7/A8): parser de fechas
// dateParser + nlDateParser: motor determinista con reloj inyectable.
// ============================================================
import { describe, expect, it } from 'vitest';

import { formatDateTime, parseDateTime } from '../src/core/reminders/dateParser';
import { describeNlDateTime, parseNlDateTime } from '../src/core/reminders/nlDateParser';

const DAY_MS = 24 * 60 * 60 * 1000;

// Jueves 15 de enero de 2026, 10:00 (hora local fija).
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const now = () => NOW;

/** Afirma que el valor no es null y lo devuelve tipado. */
function parsed<T>(value: T | null): T {
  expect(value).not.toBeNull();
  return value as T;
}

describe('dateParser — parseDateTime (formato determinista)', () => {
  it('reconoce solo hora HH:mm y la programa hoy si no ha pasado', () => {
    const result = parsed(parseDateTime('10:30', { now }));
    expect(result.at).toBe(new Date(2026, 0, 15, 10, 30).getTime());
    expect(result.format).toBe('time-only');
    expect(result.hasTime).toBe(true);
  });

  it('reprograma la hora para mañana si ya pasó hoy', () => {
    const result = parsed(parseDateTime('09:00', { now }));
    expect(result.at).toBe(new Date(2026, 0, 16, 9, 0).getTime());
    expect(result.format).toBe('time-only');
    expect(result.hasTime).toBe(true);
  });

  it('reconoce fecha ISO YYYY-MM-DD a medianoche local', () => {
    const result = parsed(parseDateTime('2026-01-15', { now }));
    expect(result.at).toBe(new Date(2026, 0, 15).getTime());
    expect(result.format).toBe('iso-date');
    expect(result.hasTime).toBe(false);
  });

  it('rechaza fechas inválidas (2026-02-30)', () => {
    expect(parseDateTime('2026-02-30', { now })).toBeNull();
  });

  it('reconoce fecha ISO con hora (T o espacio)', () => {
    for (const text of ['2026-01-15T14:30:00', '2026-01-15 14:30']) {
      const result = parsed(parseDateTime(text, { now }));
      expect(result.at).toBe(new Date(2026, 0, 15, 14, 30).getTime());
      expect(result.format).toBe('iso-datetime');
      expect(result.hasTime).toBe(true);
    }
  });

  it('reconoce fecha DMY (DD/MM/YYYY) con y sin hora', () => {
    const date = parsed(parseDateTime('15/01/2026', { now }));
    expect(date.at).toBe(new Date(2026, 0, 15).getTime());
    expect(date.format).toBe('dmy-date');
    expect(date.hasTime).toBe(false);

    const dateTime = parsed(parseDateTime('15/01/2026 14:30', { now }));
    expect(dateTime.at).toBe(new Date(2026, 0, 15, 14, 30).getTime());
    expect(dateTime.format).toBe('dmy-datetime');
    expect(dateTime.hasTime).toBe(true);
  });

  it('reconoce ISO 8601 completo con zona (UTC-aware)', () => {
    const result = parsed(parseDateTime('2026-01-15T14:30:00.000Z', { now }));
    expect(result.at).toBe(new Date('2026-01-15T14:30:00.000Z').getTime());
    expect(result.format).toBe('iso-full');
    expect(result.hasTime).toBe(true);
  });

  it('devuelve null para texto no reconocido o vacío', () => {
    expect(parseDateTime('hola', { now })).toBeNull();
    expect(parseDateTime('', { now })).toBeNull();
    expect(parseDateTime('   ', { now })).toBeNull();
    expect(parseDateTime(null as unknown as string, { now })).toBeNull();
    expect(parseDateTime(undefined as unknown as string, { now })).toBeNull();
  });

  it('formatea timestamps como YYYY-MM-DD HH:mm local', () => {
    expect(formatDateTime(new Date(2026, 0, 15, 10, 30).getTime())).toBe('2026-01-15 10:30');
    expect(formatDateTime(new Date(2026, 11, 31, 23, 5).getTime())).toBe('2026-12-31 23:05');
  });
});

describe('nlDateParser — desplazamientos relativos (en N unidades)', () => {
  it('interpreta "en N minutos"', () => {
    const result = parsed(parseNlDateTime('en 5 minutos', { now }));
    expect(result.type).toBe('offset');
    expect(result.at).toBe(NOW + 5 * 60_000);
    expect(result.matchedText).toBe('5 minutos');
    expect(result.label).toBe('en 5 minutos');
  });

  it('interpreta "en N horas" (singular y plural)', () => {
    const one = parsed(parseNlDateTime('en 1 hora', { now }));
    expect(one.at).toBe(NOW + 3_600_000);
    expect(one.label).toBe('en 1 hora');

    const two = parsed(parseNlDateTime('en 2 horas', { now }));
    expect(two.at).toBe(NOW + 2 * 3_600_000);
    expect(two.label).toBe('en 2 horas');
  });

  it('interpreta "en N días" normalizando acentos', () => {
    const result = parsed(parseNlDateTime('en 3 días', { now }));
    expect(result.type).toBe('offset');
    expect(result.at).toBe(NOW + 3 * DAY_MS);
    expect(result.matchedText).toBe('3 dias');
    expect(result.label).toBe('en 3 días');
  });

  it('interpreta "en N semanas"', () => {
    const result = parsed(parseNlDateTime('en 1 semana', { now }));
    expect(result.type).toBe('offset');
    expect(result.at).toBe(NOW + 7 * DAY_MS);
    expect(result.label).toBe('en 1 semana');
  });
});

describe('nlDateParser — fechas absolutas (el N de mes)', () => {
  it('interpreta "el 25 de diciembre" en el año actual si no ha pasado', () => {
    const result = parsed(parseNlDateTime('el 25 de diciembre', { now }));
    expect(result.type).toBe('absolute');
    expect(result.at).toBe(new Date(2026, 11, 25).getTime());
    expect(result.matchedText).toBe('el 25 de diciembre');
    expect(result.label).toBe('el 25 de diciembre');
  });

  it('acepta "25 de diciembre" sin el artículo', () => {
    const result = parsed(parseNlDateTime('25 de diciembre', { now }));
    expect(result.type).toBe('absolute');
    expect(result.at).toBe(new Date(2026, 11, 25).getTime());
  });

  it('mueve fechas ya pasadas al año siguiente ("el 10 de enero")', () => {
    const result = parsed(parseNlDateTime('el 10 de enero', { now }));
    expect(result.type).toBe('absolute');
    expect(result.at).toBe(new Date(2027, 0, 10).getTime());
    expect(result.label).toBe('el 10 de enero');
  });

  it('interpreta meses en inglés ("december 25")', () => {
    const result = parsed(parseNlDateTime('december 25', { now }));
    expect(result.type).toBe('absolute');
    expect(result.at).toBe(new Date(2026, 11, 25).getTime());
    expect(result.matchedText).toBe('december 25');
  });
});

describe('nlDateParser — partes del día', () => {
  it('interpreta "esta tarde" a las 18:00', () => {
    const result = parsed(parseNlDateTime('esta tarde', { now }));
    expect(result.type).toBe('part-of-day');
    expect(result.at).toBe(new Date(2026, 0, 15, 18, 0).getTime());
    expect(result.label).toBe('esta tarde');
  });

  it('interpreta "esta noche" a las 21:00', () => {
    const result = parsed(parseNlDateTime('esta noche', { now }));
    expect(result.type).toBe('part-of-day');
    expect(result.at).toBe(new Date(2026, 0, 15, 21, 0).getTime());
    expect(result.label).toBe('esta noche');
  });

  it('interpreta "this afternoon" y normaliza la etiqueta a español', () => {
    const result = parsed(parseNlDateTime('this afternoon', { now }));
    expect(result.type).toBe('part-of-day');
    expect(result.at).toBe(new Date(2026, 0, 15, 18, 0).getTime());
    expect(result.label).toBe('esta tarde');
  });

  it('interpreta "this morning" a las 9:00 sin saltar al día siguiente', () => {
    const result = parsed(parseNlDateTime('this morning', { now }));
    expect(result.type).toBe('part-of-day');
    expect(result.at).toBe(new Date(2026, 0, 15, 9, 0).getTime());
    expect(result.label).toBe('esta mañana');
  });
});

describe('nlDateParser — días de la semana', () => {
  it('interpreta "el próximo lunes" con una semana de margen', () => {
    const result = parsed(parseNlDateTime('el próximo lunes', { now }));
    expect(result.type).toBe('weekday');
    expect(result.at).toBe(new Date(2026, 0, 26).getTime());
    expect(result.matchedText).toBe('el proximo lunes');
    expect(result.label).toBe('el próximo lunes');
  });

  it('interpreta "next monday" como el próximo lunes', () => {
    const result = parsed(parseNlDateTime('next monday', { now }));
    expect(result.type).toBe('weekday');
    expect(result.at).toBe(new Date(2026, 0, 26).getTime());
    expect(result.matchedText).toBe('next monday');
    expect(result.label).toBe('el próximo lunes');
  });

  it('interpreta "el lunes" como el lunes más cercano (esta semana)', () => {
    const result = parsed(parseNlDateTime('el lunes', { now }));
    expect(result.type).toBe('weekday');
    expect(result.at).toBe(new Date(2026, 0, 19).getTime());
    expect(result.label).toBe('el lunes');
  });

  it('interpreta "sábado" normalizando acentos (etiqueta canónica sin tilde)', () => {
    const result = parsed(parseNlDateTime('sábado', { now }));
    expect(result.type).toBe('weekday');
    expect(result.at).toBe(new Date(2026, 0, 17).getTime());
    expect(result.matchedText).toBe('sabado');
    expect(result.label).toBe('el sabado');
  });
});

describe('nlDateParser — relativos (pasado mañana / mañana / hoy)', () => {
  it('interpreta "pasado mañana" como +2 días', () => {
    const result = parsed(parseNlDateTime('pasado mañana', { now }));
    expect(result.type).toBe('day-after');
    expect(result.at).toBe(new Date(2026, 0, 17).getTime());
    expect(result.label).toBe('pasado mañana');
  });

  it('interpreta "mañana" como +1 día a medianoche', () => {
    const result = parsed(parseNlDateTime('mañana', { now }));
    expect(result.type).toBe('tomorrow');
    expect(result.at).toBe(new Date(2026, 0, 16).getTime());
    expect(result.label).toBe('mañana');
  });

  it('interpreta "hoy" sin hora y salta al día siguiente si ya pasó la medianoche', () => {
    const result = parsed(parseNlDateTime('hoy', { now }));
    expect(result.type).toBe('today');
    expect(result.at).toBe(new Date(2026, 0, 16).getTime());
    expect(result.label).toBe('hoy');
  });

  it('interpreta "hoy a las 14" como hoy a las 14:00', () => {
    const result = parsed(parseNlDateTime('hoy a las 14', { now }));
    expect(result.type).toBe('today');
    expect(result.at).toBe(new Date(2026, 0, 15, 14, 0).getTime());
  });
});

describe('nlDateParser — hora simple (time-only)', () => {
  it('interpreta "a las 14" como hoy a las 14:00 con etiqueta "a las HH:mm"', () => {
    const result = parsed(parseNlDateTime('a las 14', { now }));
    expect(result.type).toBe('today');
    expect(result.at).toBe(new Date(2026, 0, 15, 14, 0).getTime());
    expect(result.label).toBe('a las 14:00');
  });

  it('salta al día siguiente si la hora ya pasó ("a las 9")', () => {
    const result = parsed(parseNlDateTime('a las 9', { now }));
    expect(result.type).toBe('today');
    expect(result.at).toBe(new Date(2026, 0, 16, 9, 0).getTime());
    expect(result.label).toBe('a las 09:00');
  });

  it('interpreta "a las 3 de la tarde" como las 15:00', () => {
    const result = parsed(parseNlDateTime('a las 3 de la tarde', { now }));
    expect(result.type).toBe('today');
    expect(result.at).toBe(new Date(2026, 0, 15, 15, 0).getTime());
    expect(result.label).toBe('a las 15:00');
  });

  it('interpreta "14:30" en formato reloj', () => {
    const result = parsed(parseNlDateTime('14:30', { now }));
    expect(result.type).toBe('today');
    expect(result.at).toBe(new Date(2026, 0, 15, 14, 30).getTime());
    expect(result.label).toBe('a las 14:30');
  });

  it('interpreta "3pm" como las 15:00', () => {
    const result = parsed(parseNlDateTime('3pm', { now }));
    expect(result.type).toBe('today');
    expect(result.at).toBe(new Date(2026, 0, 15, 15, 0).getTime());
    expect(result.label).toBe('a las 15:00');
  });
});

describe('nlDateParser — casos nulos', () => {
  it('devuelve null para texto no reconocido o vacío', () => {
    expect(parseNlDateTime('hola', { now })).toBeNull();
    expect(parseNlDateTime('', { now })).toBeNull();
    expect(parseNlDateTime('   ', { now })).toBeNull();
    expect(parseNlDateTime(null as unknown as string, { now })).toBeNull();
    expect(parseNlDateTime(undefined as unknown as string, { now })).toBeNull();
  });
});

describe('nlDateParser — describeNlDateTime (formato legible)', () => {
  it('formatea un timestamp lejano terminando en "a las HH:mm"', () => {
    const far = new Date(2099, 0, 15, 10, 30, 0).getTime();
    expect(describeNlDateTime(far)).toMatch(/ a las 10:30$/);
  });
});
