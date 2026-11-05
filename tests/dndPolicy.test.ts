// ============================================================
// DND Policy — No molestar (Fase 1, D2)
// ------------------------------------------------------------
// Prueba la lógica pura y determinista del horario "no molestar".
// Regla #1: los valores vienen de FLU_CONFIG.dnd (no hardcode).
// ============================================================
import { describe, test, expect } from 'vitest';
import {
  parseTimeToMinutes,
  isDoNotDisturbActive,
  describeDndSchedule,
} from '../src/core/dnd/dndPolicy';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const dnd = (FLU_CONFIG as any).dnd as {
  enabled: boolean;
  schedule: { start: string; end: string };
  allowUrgent: boolean;
  tickMs: number;
};

describe('dndPolicy — parseTimeToMinutes', () => {
  test('convierte "HH:mm" válido a minutos desde medianoche', () => {
    expect(parseTimeToMinutes('00:00')).toBe(0);
    expect(parseTimeToMinutes('07:30')).toBe(450);
    expect(parseTimeToMinutes('12:00')).toBe(720);
    expect(parseTimeToMinutes('22:05')).toBe(1325);
    expect(parseTimeToMinutes('23:59')).toBe(1439);
  });

  test('tolera espacio inicial/final y "H:mm"', () => {
    expect(parseTimeToMinutes(' 7:30 ')).toBe(450);
    expect(parseTimeToMinutes('9:05')).toBe(545);
  });

  test('devuelve null para formatos inválidos', () => {
    expect(parseTimeToMinutes('')).toBeNull();
    expect(parseTimeToMinutes('7:60')).toBeNull();
    expect(parseTimeToMinutes('24:00')).toBeNull();
    expect(parseTimeToMinutes('aa:bb')).toBeNull();
    expect(parseTimeToMinutes('7')).toBeNull();
    expect(parseTimeToMinutes(null as unknown as string)).toBeNull();
    expect(parseTimeToMinutes(undefined as unknown as string)).toBeNull();
  });
});

describe('dndPolicy — isDoNotDisturbActive', () => {
  const at = (hh: number, mm = 0) => {
    const d = new Date(2026, 0, 1);
    d.setHours(hh, mm, 0, 0);
    return d;
  };

  const cfg = (start: string, end: string) => ({
    enabled: true,
    schedule: { start, end },
  });

  test('rango normal: activo cuando start <= now < end', () => {
    expect(isDoNotDisturbActive(at(8, 0), cfg('08:00', '17:00'))).toBe(true);
    expect(isDoNotDisturbActive(at(16, 59), cfg('08:00', '17:00'))).toBe(true);
    expect(isDoNotDisturbActive(at(17, 0), cfg('08:00', '17:00'))).toBe(false);
    expect(isDoNotDisturbActive(at(7, 59), cfg('08:00', '17:00'))).toBe(false);
  });

  test('rango nocturno que cruza medianoche', () => {
    expect(isDoNotDisturbActive(at(23, 0), cfg('22:00', '07:00'))).toBe(true);
    expect(isDoNotDisturbActive(at(2, 30), cfg('22:00', '07:00'))).toBe(true);
    expect(isDoNotDisturbActive(at(6, 59), cfg('22:00', '07:00'))).toBe(true);
    expect(isDoNotDisturbActive(at(7, 0), cfg('22:00', '07:00'))).toBe(false);
    expect(isDoNotDisturbActive(at(12, 0), cfg('22:00', '07:00'))).toBe(false);
  });

  test('disabled siempre inactivo aunque esté dentro del horario', () => {
    expect(
      isDoNotDisturbActive(at(23, 0), { enabled: false, schedule: { start: '22:00', end: '07:00' } }),
    ).toBe(false);
  });

  test('start === end es un rango vacío: nunca activo', () => {
    expect(isDoNotDisturbActive(at(12, 0), cfg('12:00', '12:00'))).toBe(false);
  });

  test('horario inválido nunca activo', () => {
    expect(isDoNotDisturbActive(at(12, 0), cfg('aa:bb', '12:00'))).toBe(false);
  });

  test('allowUrgent no afecta al estado activo del DND (lo decide el service)', () => {
    const withUrgent = { ...cfg('22:00', '07:00'), allowUrgent: true };
    expect(isDoNotDisturbActive(at(23, 0), withUrgent)).toBe(true);
  });

  test('la configuración por defecto de FLU_CONFIG.dnd es coherente', () => {
    expect(dnd.schedule.start).toBe('22:00');
    expect(dnd.schedule.end).toBe('07:00');
    expect(dnd.enabled).toBe(false);
    expect(typeof dnd.tickMs).toBe('number');
  });
});

describe('dndPolicy — describeDndSchedule', () => {
  test('formatea el horario como "start – end"', () => {
    expect(describeDndSchedule({ schedule: { start: '22:00', end: '07:00' } })).toBe('22:00 – 07:00');
  });

  test('devuelve "—" si el horario es inválido', () => {
    expect(describeDndSchedule({ schedule: { start: 'aa', end: '07:00' } })).toBe('—');
  });
});
