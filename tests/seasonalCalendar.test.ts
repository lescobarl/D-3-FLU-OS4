/**
 * seasonalCalendar — calendario de temporalidades (branding).
 *
 * POR QUE ESTE TEST: medido con cobertura, `src/core/branding/seasonalCalendar.ts`
 * estaba al 0% (274 sentencias sin cubrir) pese a decidir la paleta y el mensaje
 * de temporada de TODA la UI. Aqui se fija la CONDUCTA observable: la jerarquia de
 * prioridad (custom > cumpleanos > calendario general > default), con la fecha
 * controlada por fake timers (nunca la del dia real).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    GENERAL_CALENDAR,
    getActiveSeason,
    getMonthName,
    isSameDay,
    type CustomEvent,
} from '../src/core/branding/seasonalCalendar';

/** Un dia del anio que NO esta en el calendario general (para probar el default). */
const FREE_DAY = (() => {
    const taken = new Set(GENERAL_CALENDAR.map((e) => `${e.month}-${e.day}`));
    for (let m = 1; m <= 12; m++) {
        for (let d = 1; d <= 28; d++) {
            if (!taken.has(`${m}-${d}`)) return { month: m, day: d };
        }
    }
    throw new Error('no hay dia libre en el calendario: revisar GENERAL_CALENDAR');
})();

/** Fija "hoy" a un mes/dia concreto (mediodia, evita bordes de zona horaria). */
function setToday(month: number, day: number): void {
    vi.setSystemTime(new Date(2026, month - 1, day, 12, 0, 0));
}

const bdayOf = (month: number, day: number): string =>
    `1990-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

describe('seasonalCalendar — isSameDay', () => {
    it('es true solo si mes y dia coinciden', () => {
        expect(isSameDay(1, 1, 1, 1)).toBe(true);
        expect(isSameDay(1, 1, 1, 2)).toBe(false);
        expect(isSameDay(2, 1, 1, 1)).toBe(false);
    });
});

describe('seasonalCalendar — getMonthName', () => {
    it('devuelve un nombre para 1..12 y "desconocido" fuera de rango', () => {
        expect(getMonthName(1).length).toBeGreaterThan(0);
        expect(getMonthName(12).length).toBeGreaterThan(0);
        expect(getMonthName(0)).toBe('desconocido');
        expect(getMonthName(13)).toBe('desconocido');
    });
});

describe('seasonalCalendar — getActiveSeason (jerarquia de prioridad)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('sin evento hoy devuelve default (prioridad 0)', () => {
        setToday(FREE_DAY.month, FREE_DAY.day);
        const r = getActiveSeason();
        expect(r.event.palette).toBe('default');
        expect(r.event.priority).toBe(0);
        expect(r.isBirthday).toBe(false);
    });

    it('un festivo del calendario general se activa con su paleta', () => {
        const h = GENERAL_CALENDAR[0];
        setToday(h.month, h.day);
        const r = getActiveSeason();
        expect(r.event.id).toBe(h.id);
        expect(r.event.palette).toBe(h.palette);
        expect(r.isBirthday).toBe(false);
    });

    it('el cumpleanos de hoy gana al calendario general (prioridad 3)', () => {
        setToday(FREE_DAY.month, FREE_DAY.day);
        const r = getActiveSeason(bdayOf(FREE_DAY.month, FREE_DAY.day));
        expect(r.isBirthday).toBe(true);
        expect(r.event.palette).toBe('cumpleanos');
        expect(r.event.priority).toBe(3);
    });

    it('un evento personalizado de hoy gana al cumpleanos (4 > 3)', () => {
        setToday(FREE_DAY.month, FREE_DAY.day);
        const custom: CustomEvent[] = [
            { id: 'mi-evento', name: 'Mi Evento', month: FREE_DAY.month, day: FREE_DAY.day, palette: 'custom-x' },
        ];
        const r = getActiveSeason(bdayOf(FREE_DAY.month, FREE_DAY.day), custom);
        expect(r.event.type).toBe('custom');
        expect(r.event.id).toBe('mi-evento');
        expect(r.event.priority).toBe(4);
        expect(r.isBirthday).toBe(false);
    });

    it('un custom que NO es hoy se ignora (no secuestra la temporada)', () => {
        setToday(FREE_DAY.month, FREE_DAY.day);
        const otroDia = FREE_DAY.day === 1 ? 2 : 1;
        const custom: CustomEvent[] = [
            { id: 'no-hoy', name: 'No', month: FREE_DAY.month, day: otroDia, palette: 'x' },
        ];
        const r = getActiveSeason(null, custom);
        expect(r.event.id).not.toBe('no-hoy');
    });

    it('un cumpleanos invalido no rompe ni gana (cae al default)', () => {
        setToday(FREE_DAY.month, FREE_DAY.day);
        const r = getActiveSeason('no-es-fecha');
        expect(r.isBirthday).toBe(false);
        expect(r.event.palette).toBe('default');
    });
});

describe('seasonalCalendar — GENERAL_CALENDAR es un catalogo valido', () => {
    it('cada evento tiene mes 1-12, dia 1-31, palette y prioridad de calendario', () => {
        const malos = GENERAL_CALENDAR.filter(
            (e) => e.month < 1 || e.month > 12 || e.day < 1 || e.day > 31 || !e.palette || e.priority !== 1,
        ).map((e) => e.id);
        expect(malos, `eventos invalidos: ${malos.join(', ')}`).toEqual([]);
    });

    it('no hay ids duplicados', () => {
        const ids = GENERAL_CALENDAR.map((e) => e.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
