// ============================================================
// Guard — la confirmación de alarma nombra el DÍA cuando no es hoy
// ------------------------------------------------------------
// Causa raíz (caso 6): "hoy" con hora ya pasada se rola a mañana en
// silencio y la respuesta no dice el día → el usuario cree que quedó
// para hoy y la siguiente petición choca por dedup de datetime.
// Este guard falla mientras `alarmAddedReply` no exprese el día.
// ============================================================
import { describe, it, expect } from 'vitest';
import { parseTemporalIntent } from '../src/core/temporal/temporalIntentParser';

// Jueves 15 de enero de 2026, 10:00 (local).
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const parse = (text: string) => parseTemporalIntent(text, { now: NOW });

describe('alarma — la confirmación expresa el día resuelto', () => {
  it('"hoy" con hora pasada se rola a mañana y la respuesta lo dice', () => {
    const r = parse('pon una alarma hoy a las 8 con 30 minutos a.m');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('alarm.add');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: new Date(2026, 0, 16, 8, 30).getTime() });
    expect(r.reply).toContain('08:30');
    expect(r.reply).toMatch(/mañana/i);
  });

  it('"mañana a las 7" → la respuesta dice mañana', () => {
    const r = parse('pon una alarma mañana a las 7');
    expect(r.data?.trigger).toEqual({ kind: 'absolute', at: new Date(2026, 0, 16, 7, 0).getTime() });
    expect(r.reply).toContain('07:00');
    expect(r.reply).toMatch(/mañana/i);
  });

  it('alarma de hoy (hora futura) NO dice mañana', () => {
    const r = parse('pon una alarma hoy a las 2 con 13 minutos p.m');
    expect(r.reply).toContain('14:13');
    expect(r.reply).not.toMatch(/mañana/i);
  });

  it('recurrencia explícita no lleva día relativo', () => {
    const r = parse('pon una alarma todos los días a las 8');
    expect(r.reply).not.toMatch(/mañana/i);
  });

  it('inglés: la confirmación dice "tomorrow" para el día siguiente', () => {
    const r = parse('set an alarm tomorrow at 7 am');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('alarm.add');
    expect(r.reply).toMatch(/tomorrow/i);
  });
});
