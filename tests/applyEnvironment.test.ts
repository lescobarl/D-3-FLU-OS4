// @vitest-environment jsdom
/**
 * core/environments/applyEnvironment — materializa un ambiente (61 sentencias, 0%).
 *
 * POR QUE ESTE TEST: `src/core/environments/applyEnvironment.ts` es la funcion que
 * convierte una entrada del catalogo en ESTADO REAL: variables CSS en el documento,
 * perfil de voz, personalidad derivada por datos y mensaje de sistema.
 * Estaba al 0%: nadie ejecutaba ni la derivacion condicional ni la limpieza.
 *
 * Las DOS tiendas se sustituyen (son el colaborador de frontera: aqui se afirma QUE
 * se les pide, no como lo guardan ellos). El catalogo y el documento son REALES, y
 * las expectativas se derivan de la propia definicion del ambiente, no de literales
 * copiados: si el catalogo cambia, el test sigue midiendo la regla.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const environmentStore = vi.hoisted(() => ({
    setActiveAmbienteId: vi.fn(),
    resetAmbiente: vi.fn(),
}));
const integrationStore = vi.hoisted(() => ({
    applyProfile: vi.fn(),
    setPersonality: vi.fn(),
    addSystemMessage: vi.fn(),
}));

vi.mock('../src/store/environmentStore', () => ({ useEnvironmentStore: { getState: () => environmentStore } }));
vi.mock('../src/store/integrationStore', () => ({ useIntegrationStore: { getState: () => integrationStore } }));

import {
    applyEnvironment,
    applyEnvironmentThemeVars,
    cleanupEnvironmentThemeVars,
    resetEnvironment,
} from '../src/core/environments/applyEnvironment.js';
import {
    DEFAULT_AMBIENTE_ID,
    ENVIRONMENT_CSS_VAR_KEYS,
    getAmbiente,
    getDefaultAmbiente,
    getEnvironmentCssVars,
} from '../src/core/environments/environmentRegistry.js';

const CHEF = getAmbiente('chef')!;
const ASISTENTE = getAmbiente(DEFAULT_AMBIENTE_ID)!;

const raiz = () => document.documentElement;
const varCss = (key: string) => raiz().style.getPropertyValue(`--${key}`);

beforeEach(() => {
    environmentStore.setActiveAmbienteId.mockReset();
    environmentStore.resetAmbiente.mockReset();
    integrationStore.applyProfile.mockReset();
    integrationStore.setPersonality.mockReset();
    integrationStore.addSystemMessage.mockReset();
    cleanupEnvironmentThemeVars();
});

afterEach(() => {
    cleanupEnvironmentThemeVars();
    vi.unstubAllGlobals();
});

describe('applyEnvironment — tema visual', () => {
    it('inyecta las variables del ambiente y BORRA las que no define', () => {
        applyEnvironmentThemeVars('chef');

        const vars = getEnvironmentCssVars('chef');
        for (const key of ENVIRONMENT_CSS_VAR_KEYS) {
            expect(varCss(key)).toBe(vars[key] ?? '');
        }
        expect(raiz().dataset.ambiente).toBe('chef');
    });

    it('con el ambiente por defecto no deja marca en el documento', () => {
        applyEnvironmentThemeVars(DEFAULT_AMBIENTE_ID);

        expect(raiz().dataset.ambiente).toBe('');
    });

    it('la limpieza devuelve el documento al estado base', () => {
        applyEnvironmentThemeVars('chef');
        expect(varCss('flu-bg')).not.toBe('');

        cleanupEnvironmentThemeVars();

        for (const key of ENVIRONMENT_CSS_VAR_KEYS) {
            expect(varCss(key)).toBe('');
        }
        expect(raiz().dataset.ambiente).toBe('');
    });

    it('sin documento (SSR) no hace nada ni revienta', () => {
        vi.stubGlobal('document', undefined);

        expect(() => applyEnvironmentThemeVars('chef')).not.toThrow();
        expect(() => cleanupEnvironmentThemeVars()).not.toThrow();
    });
});

describe('applyEnvironment — aplicacion completa', () => {
    it('persiste la seleccion, aplica tema, perfil y personalidad derivada', () => {
        const devuelto = applyEnvironment('chef');

        expect(devuelto).toBe(CHEF);
        expect(environmentStore.setActiveAmbienteId).toHaveBeenCalledWith('chef');
        expect(integrationStore.applyProfile).toHaveBeenCalledWith(CHEF.voz.perfil);
        expect(varCss('flu-bg')).toBe(getEnvironmentCssVars('chef')['flu-bg']);

        const override = integrationStore.setPersonality.mock.calls[0][0] as Record<string, unknown>;
        expect(override.name).toBe('FLU');
        expect(override.traits).toEqual([...CHEF.voz.rasgos]);
        expect(override.tone).toBe(CHEF.voz.tone);
        // Los campos derivados aparecen SOLO si el catalogo los trae (regla del modulo).
        expect(Object.hasOwn(override, 'customInstructions')).toBe(CHEF.voz.instrucciones.trim() !== '');
        expect(Object.hasOwn(override, 'proactivity')).toBe(typeof CHEF.contenido.proactividad === 'number');
        expect(integrationStore.addSystemMessage).toHaveBeenCalledTimes(CHEF.voz.instrucciones.trim() !== '' ? 1 : 0);
    });

    it('el ambiente base no inventa rasgos ni mensaje de sistema', () => {
        applyEnvironment(DEFAULT_AMBIENTE_ID);

        // MEDIDO en el catalogo: el asistente no tiene rasgos, ni tono, ni instrucciones.
        expect(ASISTENTE.voz.rasgos).toEqual([]);
        expect(ASISTENTE.voz.tone).toBeUndefined();
        expect(ASISTENTE.voz.instrucciones).toBe('');

        expect(integrationStore.setPersonality).toHaveBeenCalledWith({ name: 'FLU' });
        expect(integrationStore.addSystemMessage).not.toHaveBeenCalled();
    });

    it('un id desconocido cae al ambiente por defecto (no deja el sistema a medias)', () => {
        const devuelto = applyEnvironment('inventado');

        expect(devuelto).toBe(getDefaultAmbiente());
        expect(environmentStore.setActiveAmbienteId).toHaveBeenCalledWith(DEFAULT_AMBIENTE_ID);
        expect(integrationStore.applyProfile).toHaveBeenCalledWith(getDefaultAmbiente().voz.perfil);
        expect(raiz().dataset.ambiente).toBe('');
    });

    it('el mensaje de sistema nombra el ambiente y lleva sus instrucciones', () => {
        applyEnvironment('chef');

        const mensaje = integrationStore.addSystemMessage.mock.calls[0][0] as string;
        expect(mensaje).toContain(CHEF.nombre);
        expect(mensaje).toContain(CHEF.voz.instrucciones);
    });
});

describe('applyEnvironment — vuelta al modo base', () => {
    it('reset limpia el tema, resetea la seleccion, restaura el perfil y lo registra', () => {
        applyEnvironmentThemeVars('chef');

        const devuelto = resetEnvironment();

        expect(devuelto).toBe(getDefaultAmbiente());
        expect(environmentStore.resetAmbiente).toHaveBeenCalledTimes(1);
        expect(integrationStore.applyProfile).toHaveBeenCalledWith(getDefaultAmbiente().voz.perfil);
        expect(integrationStore.addSystemMessage).toHaveBeenCalledTimes(1);
        expect(raiz().dataset.ambiente).toBe('');
        expect(varCss('flu-bg')).toBe('');
        // El reset NO re-aplica una personalidad derivada: la base la pone applyProfile.
        expect(integrationStore.setPersonality).not.toHaveBeenCalled();
    });
});
