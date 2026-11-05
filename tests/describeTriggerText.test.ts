// ============================================================
// describeTriggerText — la confirmación dice el DÍA COMPLETO
// ------------------------------------------------------------
// Bug real: decía "vie", "jue", "mar". Invariante: fecha puntual y recurrencia
// semanal usan el nombre completo del día, localizado, sin listas en duro.
// ============================================================
import { describe, it, expect } from 'vitest';
import { describeTriggerWhen } from '../src/core/agenda/describeTriggerText';

// Jueves 2026-09-17 10:00 local.
const JUEVES = new Date(2026, 8, 17, 10, 0, 0, 0).getTime();

describe('describeTriggerWhen — día completo (no abreviado)', () => {
    it('fecha puntual usa el nombre completo', () => {
        const s = describeTriggerWhen({ type: 'absolute', at: JUEVES } as never, 'es');
        expect(s).toContain('jueves');
        expect(s).not.toMatch(/\bjue\b/); // no la abreviatura
        expect(s).toContain('10:00');
    });

    it('semanal usa nombres completos', () => {
        const s = describeTriggerWhen({ type: 'weekly', daysOfWeek: [1, 4], timeOfDay: '10:30' } as never, 'es');
        expect(s).toContain('lunes');
        expect(s).toContain('jueves');
        expect(s).not.toMatch(/\blun\b/);
    });

    it('en inglés, nombre completo', () => {
        const s = describeTriggerWhen({ type: 'absolute', at: JUEVES } as never, 'en');
        expect(s.toLowerCase()).toContain('thursday');
    });

    it('diario mantiene el texto', () => {
        expect(describeTriggerWhen({ type: 'daily', timeOfDay: '08:00' } as never, 'es')).toContain('todos los días');
    });
});
