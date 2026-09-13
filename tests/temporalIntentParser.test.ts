// ============================================================
// Temporal Intent Parser — Alarmas, despertador y temporizador
// ------------------------------------------------------------
// Pruebas del parser determinista es/en (Fase 1D — Etapa C).
// El reloj de referencia es el JUEVES 15 de enero de 2026 10:00
// (local) para que las horas relativas sean deterministas.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  parseTemporalIntent,
  formatDurationMs,
} from '../src/core/temporal/temporalIntentParser';
import {
  MS_DAY,
  MS_HOUR,
  MS_MINUTE,
  MS_SECOND,
} from '../src/core/temporal/scheduleEngine';

/** Fecha local (meses 1-based). */
const at = (y: number, mo: number, d: number, h: number, mi: number): number =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

// Jueves 15 de enero de 2026, 10:00 (dayOfWeek = 4).
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();

function parse(text: string, opts: { now?: number; defaultAlarmTimeOfDay?: string; defaultTimerMinutes?: number } = {}) {
  return parseTemporalIntent(text, { now: NOW, ...opts });
}

describe('parseTemporalIntent — alarma de UNA SOLA VEZ (solo hora)', () => {
  it('una alarma a las 7 de la mañana → absolute de una vez (hoy ya pasó), etiqueta por defecto', () => {
    const r = parse('pon una alarma a las 7 de la mañana');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('alarm.add');
    expect(r.data?.kind).toBe('alarm');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: at(2026, 1, 16, 7, 0) });
    expect(r.data?.recurrence).toEqual({ kind: 'once' });
    expect(r.data?.label).toBe('Alarma a las 07:00');
    expect(r.reply).toContain('07:00');
  });

  it('a las 7 de la noche → absolute hoy 19:00 (ajuste PM), una sola vez', () => {
    const r = parse('pon una alarma a las 7 de la noche');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: at(2026, 1, 15, 19, 0) });
    expect(r.data?.recurrence).toEqual({ kind: 'once' });
  });

  it('al mediodía → absolute hoy 12:00 (una sola vez)', () => {
    const r = parse('pon una alarma al mediodía');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: at(2026, 1, 15, 12, 0) });
  });

  it('a la medianoche → absolute mañana 00:00 (una sola vez)', () => {
    const r = parse('pon una alarma a la medianoche');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: at(2026, 1, 16, 0, 0) });
  });

  it('con etiqueta propia → la etiqueta se usa en data y en reply (no la genérica)', () => {
    const r = parse('pon una alarma a las 7 de la mañana para los dientes');
    expect(r.data?.label).toBe('dientes');
    expect(r.reply).toContain('"dientes"');
    expect(r.reply).not.toContain('Alarma a las');
  });

  it('sin hora y sin default → pide aclaración (handled true, action null)', () => {
    const r = parse('pon una alarma');
    expect(r.handled).toBe(true);
    expect(r.action).toBeNull();
    expect(r.reply).toContain('hora');
  });

  it('sin hora con default 07:00 → usa el default (una sola vez)', () => {
    const r = parse('pon una alarma', { defaultAlarmTimeOfDay: '07:00' });
    expect(r.action).toBe('alarm.add');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: at(2026, 1, 16, 7, 0) });
    expect(r.data?.recurrence).toEqual({ kind: 'once' });
  });
});

describe('parseTemporalIntent — un solo disparo (día concreto)', () => {
  it('mañana a las 7 → absolute at(2026,1,16,7,0) una sola vez', () => {
    const r = parse('pon una alarma mañana a las 7');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: at(2026, 1, 16, 7, 0) });
    expect(r.data?.recurrence).toEqual({ kind: 'once' });
  });

  it('hoy a las 11 → absolute at(2026,1,15,11,0)', () => {
    const r = parse('pon una alarma hoy a las 11');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: at(2026, 1, 15, 11, 0) });
  });

  it('pasado mañana a las 8 → absolute at(2026,1,17,8,0)', () => {
    const r = parse('pon una alarma pasado mañana a las 8');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: at(2026, 1, 17, 8, 0) });
  });

  it('el lunes a las 6 → absolute at(2026,1,19,6,0)', () => {
    const r = parse('pon una alarma el lunes a las 6');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: at(2026, 1, 19, 6, 0) });
    expect(r.data?.recurrence).toEqual({ kind: 'once' });
  });

  it('el viernes a las 9 → absolute at(2026,1,16,9,0)', () => {
    const r = parse('pon una alarma el viernes a las 9');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: at(2026, 1, 16, 9, 0) });
  });

  it('el domingo a las 8 → absolute at(2026,1,18,8,0)', () => {
    const r = parse('pon una alarma el domingo a las 8');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: at(2026, 1, 18, 8, 0) });
  });

  it('el jueves a las 12 → mismo día de la semana → salta 7 días', () => {
    const r = parse('pon una alarma el jueves a las 12');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: at(2026, 1, 22, 12, 0) });
  });
});

describe('parseTemporalIntent — formato ASR (Chrome: "12 13 p m")', () => {
  it('hoy "12 13 p m" → absolute 12:13 PM del día de referencia (hoy, 15-ene 2026)', () => {
    const r = parse('pon una alarma a las 12 13 p m hoy');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('alarm.add');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: at(2026, 1, 15, 12, 13) });
    expect(r.reply).toContain('12:13');
  });

  it('"12 13 p m" sin día → absolute hoy 12:13 (minutos separados por espacio)', () => {
    const r = parse('pon una alarma a las 12 13 p m');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: at(2026, 1, 15, 12, 13) });
    expect(r.reply).toContain('12:13');
  });

  it('"5 00 p m" → absolute hoy 17:00 (meridiano p.m. con espacios)', () => {
    const r = parse('pon una alarma a las 5 00 p m');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: at(2026, 1, 15, 17, 0) });
  });

  it('"12 13" literal con dos puntos → absolute hoy 12:13', () => {
    const r = parse('pon una alarma a las 12:13');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: at(2026, 1, 15, 12, 13) });
  });

  it('"12 13 p.m." con puntos en el meridiano → absolute hoy 12:13', () => {
    const r = parse('pon una alarma a las 12:13 p.m.');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: at(2026, 1, 15, 12, 13) });
  });

  it('"genera una alarma a las 12:30" (caso real) → UNA sola vez, no diaria', () => {
    const r = parse('genera una alarma a las 12:30 del mediodía');
    expect(r.action).toBe('alarm.add');
    expect(r.data?.recurrence).toEqual({ kind: 'once' });
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: at(2026, 1, 15, 12, 30) });
  });

  it('la etiqueta NO queda con residuos de hora ("13 p m")', () => {
    const r = parse('pon una alarma a las 12 13 p m');
    expect(r.data?.label).toBe('Alarma a las 12:13');
    expect(r.data?.label).not.toContain('13 p m');
  });

  it('"2 con 13 minutos p.m" hoy → absolute 14:13 (conector verbal ASR)', () => {
    const r = parse('pon una alarma hoy a las 2 con 13 minutos p.m');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('alarm.add');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: at(2026, 1, 15, 14, 13) });
    expect(r.reply).toContain('14:13');
  });

  it('"hoy" con hora ya pasada → se rola a mañana a esa hora (no se rechaza)', () => {
    const r = parse('pon una alarma hoy a las 8 con 30 minutos a.m');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('alarm.add');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: at(2026, 1, 16, 8, 30) });
  });
});

describe('parseTemporalIntent — recurrencia explícita (gana sobre el día)', () => {
  it('los lunes a las 6 → daily 06:00 + weekdays[1]', () => {
    const r = parse('pon una alarma los lunes a las 6');
    expect(r.data?.trigger).toEqual({ kind: 'daily', timeOfDay: '06:00' });
    expect(r.data?.recurrence).toEqual({ kind: 'weekdays', days: [1] });
  });

  it('todos los días a las 8 → daily 08:00 + daily', () => {
    const r = parse('pon una alarma todos los días a las 8');
    expect(r.data?.trigger).toEqual({ kind: 'daily', timeOfDay: '08:00' });
    expect(r.data?.recurrence).toEqual({ kind: 'daily' });
  });

  it('de lunes a viernes a las 7 → weekdays[1..5]', () => {
    const r = parse('pon una alarma de lunes a viernes a las 7');
    expect(r.data?.recurrence).toEqual({ kind: 'weekdays', days: [1, 2, 3, 4, 5] });
  });

  it('de lunes a sábado a las 6 → weekdays[1..6]', () => {
    const r = parse('pon una alarma de lunes a sábado a las 6');
    expect(r.data?.recurrence).toEqual({ kind: 'weekdays', days: [1, 2, 3, 4, 5, 6] });
  });

  it('entre semana a las 9 → weekdays[1..5]', () => {
    const r = parse('pon una alarma entre semana a las 9');
    expect(r.data?.recurrence).toEqual({ kind: 'weekdays', days: [1, 2, 3, 4, 5] });
  });

  it('a las 6 de la mañana los lunes (recurrencia al final) → weekdays[1]', () => {
    const r = parse('pon una alarma a las 6 de la mañana los lunes');
    expect(r.data?.trigger).toEqual({ kind: 'daily', timeOfDay: '06:00' });
    expect(r.data?.recurrence).toEqual({ kind: 'weekdays', days: [1] });
  });
});

describe('parseTemporalIntent — temporizador (countdown)', () => {
  it('pon un temporizador de 5 minutos → countdown 5*MS_MINUTE, once', () => {
    const r = parse('pon un temporizador de 5 minutos');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('timer.start');
    expect(r.data?.kind).toBe('timer');
    expect(r.data?.trigger).toEqual({ kind: 'countdown', at: NOW, durationMs: 5 * MS_MINUTE });
    expect(r.data?.recurrence).toEqual({ kind: 'once' });
    expect(r.data?.label).toBe('Temporizador');
  });

  it('de una hora y 30 minutos → 90*MS_MINUTE', () => {
    const r = parse('pon un temporizador de una hora y 30 minutos');
    expect(r.data?.trigger).toEqual({ kind: 'countdown', at: NOW, durationMs: 90 * MS_MINUTE });
    expect(r.reply).toContain('1 hora y 30 minutos');
  });

  it('de media hora → 30*MS_MINUTE', () => {
    const r = parse('pon un temporizador de media hora');
    expect(r.data?.trigger).toEqual({ kind: 'countdown', at: NOW, durationMs: 30 * MS_MINUTE });
  });

  it('de 45 segundos → 45*MS_SECOND', () => {
    const r = parse('pon un temporizador de 45 segundos');
    expect(r.data?.trigger).toEqual({ kind: 'countdown', at: NOW, durationMs: 45 * MS_SECOND });
  });

  it('con etiqueta propia → label en data y en reply, sin etiqueta genérica', () => {
    const r = parse('pon un temporizador de 2 minutos para la pasta');
    expect(r.data?.label).toBe('pasta');
    expect(r.reply).toContain('"pasta"');
    expect(r.reply).not.toContain('Timer');
  });

  it('sin duración y sin default → pide aclaración', () => {
    const r = parse('pon un temporizador');
    expect(r.handled).toBe(true);
    expect(r.action).toBeNull();
    expect(r.reply).toContain('tiempo');
  });

  it('sin duración con default 10 → usa 10*MS_MINUTE', () => {
    const r = parse('pon un temporizador', { defaultTimerMinutes: 10 });
    expect(r.action).toBe('timer.start');
    expect(r.data?.trigger).toEqual({ kind: 'countdown', at: NOW, durationMs: 10 * MS_MINUTE });
  });

  it('formatDurationMs exporta duración legible es/en', () => {
    expect(formatDurationMs(90 * MS_MINUTE, 'es')).toBe('1 hora y 30 minutos');
    expect(formatDurationMs(5 * MS_MINUTE, 'en')).toBe('5 minutes');
    expect(formatDurationMs(45 * MS_SECOND, 'es')).toBe('45 segundos');
  });
});

describe('parseTemporalIntent — listar, cancelar y no reconocido', () => {
  it('qué alarmas tengo → alarm.list (es)', () => {
    const r = parse('qué alarmas tengo');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('alarm.list');
  });

  it('show my alarms → alarm.list (en)', () => {
    const r = parse('show my alarms');
    expect(r.action).toBe('alarm.list');
  });

  it('qué temporizadores tengo → timer.list', () => {
    const r = parse('qué temporizadores tengo');
    expect(r.action).toBe('timer.list');
  });

  it('cancela todas las alarmas → alarm.cancel con all=true', () => {
    const r = parse('cancela todas las alarmas');
    expect(r.action).toBe('alarm.cancel');
    expect(r.data?.kind).toBe('alarm');
    expect(r.data?.all).toBe(true);
  });

  it('cancela la alarma de las 7 → alarm.cancel con cancelTarget 07:00', () => {
    const r = parse('cancela la alarma de las 7');
    expect(r.action).toBe('alarm.cancel');
    expect(r.data?.all).toBe(false);
    expect(r.data?.cancelTarget).toBe('07:00');
  });

  it('cancela el temporizador → timer.cancel', () => {
    const r = parse('cancela el temporizador');
    expect(r.action).toBe('timer.cancel');
    expect(r.data?.kind).toBe('timer');
    expect(r.data?.all).toBe(false);
  });

  it('cancela todos los temporizadores → timer.cancel con all=true', () => {
    const r = parse('cancela todos los temporizadores');
    expect(r.action).toBe('timer.cancel');
    expect(r.data?.all).toBe(true);
  });

  it('texto vacío → handled false sin acción', () => {
    const r = parse('   ');
    expect(r.handled).toBe(false);
    expect(r.action).toBeNull();
  });

  it('texto no relacionado → handled false', () => {
    const r = parse('cuéntame un chiste');
    expect(r.handled).toBe(false);
    expect(r.action).toBeNull();
  });

  it('"detén la alarma" → alarm.stop (silenciar, sin cancelar el ítem)', () => {
    const r = parse('detén la alarma');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('alarm.stop');
  });

  it('"silencia el temporizador" → timer.stop', () => {
    const r = parse('silencia el temporizador');
    expect(r.action).toBe('timer.stop');
  });

  it('regresión: "cancela la alarma" sigue siendo alarm.cancel', () => {
    const r = parse('cancela la alarma');
    expect(r.action).toBe('alarm.cancel');
  });
});
