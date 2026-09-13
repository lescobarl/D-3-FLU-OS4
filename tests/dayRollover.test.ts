// ============================================================
// dayRollover.test.ts — Guard del corte por día (item 2)
// ------------------------------------------------------------
// Invariante: si quedó conversación de un día anterior y no se cerró hoy, hay
// que cerrar el día (minuta). Conversación de hoy, día ya cerrado, o sin
// conversación NO disparan.
// ============================================================
import { describe, expect, it } from 'vitest';
import { dayKey, shouldRolloverDay } from '../src/core/days/dayRollover';

const T = (y: number, m: number, d: number, h = 12): number => new Date(y, m - 1, d, h).getTime();

describe('dayRollover', () => {
    it('detecta cambio de día (ayer → hoy) y no se cerró hoy', () => {
        expect(shouldRolloverDay(T(2026, 1, 14), T(2026, 1, 15), '2026-01-14')).toBe(true);
    });

    it('no dispara si la conversación es de hoy', () => {
        expect(shouldRolloverDay(T(2026, 1, 15, 1), T(2026, 1, 15, 23), '2026-01-14')).toBe(false);
    });

    it('no dispara si el día ya se cerró hoy', () => {
        expect(shouldRolloverDay(T(2026, 1, 14), T(2026, 1, 15), '2026-01-15')).toBe(false);
    });

    it('sin conversación no dispara', () => {
        expect(shouldRolloverDay(0, T(2026, 1, 15), '')).toBe(false);
        expect(shouldRolloverDay(null, T(2026, 1, 15), '')).toBe(false);
    });

    it('dayKey usa formato local YYYY-MM-DD', () => {
        expect(dayKey(T(2026, 3, 7))).toBe('2026-03-07');
    });
});
