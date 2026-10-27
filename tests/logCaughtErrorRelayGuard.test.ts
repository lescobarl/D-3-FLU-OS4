/**
 * logCaughtError NO puede reportarse a si mismo (bucle sin fin).
 *
 * HALLAZGO MEDIDO (no es teoria): `logCaughtError` mandaba el error al relay central
 * y, si el relay RECHAZA, su `catch` volvia a llamar a `logCaughtError` con el
 * contexto '[catch] src/lib/caughtError.ts'. Ese segundo intento vuelve a importar
 * y a usar el MISMO relay que acaba de fallar, asi que vuelve a rechazar y vuelve a
 * re-reportar: una cadena sin fin de importaciones dinamicas y `console.error`.
 * En un worker de vitest se comio 5,8 GB de memoria antes de morir (y en el
 * navegador revienta la consola).
 *
 * REGLA QUE SE VIGILA: un fallo del relay se queda donde esta (consola), no se
 * re-reporta por el registro central. El doble del relay falla UNA vez y luego
 * funciona, para que el bucle sea contable y la guarda no se cuelgue: con el
 * defecto, el relay recibe DOS llamadas; con la regla, UNA.
 *
 * REANCLA DEL MECANISMO (corte 2026-10-26): el import dinamico de
 * `clientLogRelay` salio de `caughtError` (cerraba ciclos de imports ENTRE
 * WORKERS en el build). Ahora `caughtError` es HOJA y el relay se registra como
 * RECEPTOR (`registrarReceptorCaughtError`). El guard se reancla a esa API
 * manteniendo el MISMO contrato de conducta: el doble del receptor falla una
 * vez, el fallo se queda en la consola y nunca se re-reporta.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const relay = vi.hoisted(() => ({ llamadas: 0, fallaLaPrimera: true }));

import { logCaughtError, registrarReceptorCaughtError } from '../src/lib/caughtError.js';

beforeEach(() => {
    relay.llamadas = 0;
    relay.fallaLaPrimera = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Doble del relay del hilo principal: falla UNA vez y luego funciona, para
    // que el bucle sea contable (mismo contrato que con el import dinamico).
    registrarReceptorCaughtError(() => {
        relay.llamadas += 1;
        if (relay.fallaLaPrimera) {
            relay.fallaLaPrimera = false;
            throw new Error('relay caido');
        }
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Marca vigilada: el fallo del relay se RE-REPORTO (el bucle sin fin del hallazgo).
 * Exportada para poder falsificarla (guardMutationGuard: sin prueba de detector es teatro).
 * @param llamadas Numero de llamadas que recibio el relay.
 */
export function huboReReporte(llamadas: number): boolean {
    return llamadas > 1;
}

describe('logCaughtError - el relay que falla no se re-reporta', () => {
    it('un relay que rechaza NO provoca un segundo reporte', () => {
        logCaughtError('origen', new Error('boom'));

        expect(relay.llamadas).toBe(1);
    });

    it('el error original sigue llegando a la consola y el fallo del relay se ve', () => {
        logCaughtError('origen', new Error('boom'));

        expect(console.error).toHaveBeenCalledWith('[catch] origen', expect.stringContaining('boom'));
        // El fallo del relay queda en la consola (no se re-reporta al relay).
        expect(console.error).toHaveBeenCalledWith('[catch] relay origen', expect.stringContaining('relay caido'));
        expect(console.error).toHaveBeenCalledTimes(2);
    });

    it('un relay que funciona reporta una sola vez y sin ruido', () => {
        relay.fallaLaPrimera = false;
        logCaughtError('origen-ok', new Error('boom'));

        expect(relay.llamadas).toBe(1);
        expect(console.error).toHaveBeenCalledTimes(1);
    });

    it('varios errores seguidos se reportan uno a uno (sin acumular estado)', () => {
        relay.fallaLaPrimera = false;
        logCaughtError('uno', new Error('a'));
        logCaughtError('dos', new Error('b'));

        expect(relay.llamadas).toBe(2);
        expect(console.error).toHaveBeenCalledTimes(2);
    });

    it('PRUEBA DE DETECTOR: el detector marca el re-reporte y no marca el reporte unico', () => {
        // Entradas sinteticas: dos llamadas SON el bucle medido; una no.
        expect(huboReReporte(2)).toBe(true);
        expect(huboReReporte(0)).toBe(false);
        // Y sobre la senal REAL: un relay que falla no puede re-reportarse.
        logCaughtError('origen-detector', new Error('boom'));
        expect(huboReReporte(relay.llamadas)).toBe(false);
    });
});
