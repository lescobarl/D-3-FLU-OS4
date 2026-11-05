/**
 * app/configActions — despacho de configuracion por voz (validadores).
 *
 * POR QUE ESTE TEST: `src/app/configActions.ts` esta al 0% (305 sentencias) y es
 * la via por la que la voz cambia la configuracion. Aqui se fijan sus dos
 * VALIDADORES puros: `parseBoolean` (booleano indulgente) y `applyNumberConfig`
 * (parseo + conversion de unidades + rango del catalogo).
 */
import { describe, expect, it, vi } from 'vitest';
import { applyNumberConfig, parseBoolean } from '../src/app/configActions';
import type { ConfigCatalogEntry } from '../src/core/config/voiceConfigCatalog';

const entry = (over: Partial<ConfigCatalogEntry> = {}): ConfigCatalogEntry =>
    ({ accion: 'set_x', clave: 'k', label: 'x', handler: 'noop', ...over }) as unknown as ConfigCatalogEntry;

describe('configActions — parseBoolean', () => {
    it('reconoce los verdaderos (con acentos y es/en)', () => {
        for (const v of ['true', '1', 'yes', 'si', 'sí', 'on', 'activar', 'mostrar', 'visible']) {
            expect(parseBoolean(v)).toBe(true);
        }
    });
    it('reconoce los falsos', () => {
        for (const v of ['false', '0', 'no', 'off', 'desactivar', 'ocultar', 'invisible']) {
            expect(parseBoolean(v)).toBe(false);
        }
    });
    it('ignora mayusculas y espacios alrededor', () => {
        expect(parseBoolean('  SI  ')).toBe(true);
        expect(parseBoolean('\tNo\n')).toBe(false);
    });
    it('devuelve null si no lo reconoce', () => {
        expect(parseBoolean('quizas')).toBeNull();
        expect(parseBoolean('')).toBeNull();
    });
});

describe('configActions — applyNumberConfig', () => {
    it('un valor no numerico no aplica (false)', () => {
        const apply = vi.fn();
        expect(applyNumberConfig(entry(), 'abc', apply)).toBe(false);
        expect(apply).not.toHaveBeenCalled();
    });

    it('convierte minutos a ms y aplica', () => {
        const apply = vi.fn();
        expect(applyNumberConfig(entry({ inputUnit: 'minutes' }), '2', apply)).toBe(true);
        expect(apply).toHaveBeenCalledWith(120_000);
    });

    it('convierte segundos a ms', () => {
        const apply = vi.fn();
        expect(applyNumberConfig(entry({ inputUnit: 'seconds' }), '3', apply)).toBe(true);
        expect(apply).toHaveBeenCalledWith(3_000);
    });

    it('sin unidad de entrada aplica el numero tal cual', () => {
        const apply = vi.fn();
        expect(applyNumberConfig(entry(), '7.5', apply)).toBe(true);
        expect(apply).toHaveBeenCalledWith(7.5);
    });

    it('respeta el minimo y el maximo del catalogo (no aplica fuera de rango)', () => {
        const apply = vi.fn();
        expect(applyNumberConfig(entry({ min: 10, max: 100 }), '5', apply)).toBe(false);
        expect(applyNumberConfig(entry({ min: 10, max: 100 }), '200', apply)).toBe(false);
        expect(apply).not.toHaveBeenCalled();
        expect(applyNumberConfig(entry({ min: 10, max: 100 }), '50', apply)).toBe(true);
        expect(apply).toHaveBeenCalledWith(50);
    });
});
