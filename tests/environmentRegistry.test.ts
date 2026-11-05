// ============================================================
// environmentRegistry.test.ts — Catálogo de AMBIENTES (solo datos)
// ============================================================
// B7 (Q11 — Sistema de Ambientes): valida la integridad del catálogo
// data-driven sobre `src/core/environments/environmentRegistry.ts`:
//   - 5 ambientes pilotos con ids únicos y campos completos
//   - `asistente` como ambiente por defecto (sin tema, sin decoración,
//     capa visible y todas las pestañas de la shell)
//   - cada ambiente no-default define las 8 variables CSS `--flu-*`
//   - contratos de pestañas, decoración 3D, voz y contenido
//   - accessors puros (getAmbiente / getVisibleTabIds / ...)
// Sin hardcode: cada expectativa se deriva del catálogo y de las
// constantes de referencia (ENVIRONMENT_TAB_IDS, ENVIRONMENT_CSS_VAR_KEYS).
// ============================================================
import { describe, test, expect } from 'vitest';
import {
    ENVIRONMENTS,
    DEFAULT_AMBIENTE_ID,
    ENVIRONMENT_TAB_IDS,
    ENVIRONMENT_CSS_VAR_KEYS,
    getAmbiente,
    getAmbientes,
    getDefaultAmbiente,
    isAmbienteId,
    getVisibleTabIds,
    getEnvironmentCssVars,
} from '../src/core/environments/environmentRegistry';
import type { EnvironmentDecoration } from '../src/core/environments/environmentRegistry';

/** Ids esperados del catálogo piloto (contrato de B7). */
const EXPECTED_IDS = ['asistente', 'chef', 'jardinero', 'bricolaje', 'bienestar'];

/** Decoraciones 3D válidas reutilizadas (unión de EnvironmentDecoration). */
const VALID_DECORATIONS: readonly EnvironmentDecoration[] = ['party-hat', 'flower', 'sparkle', 'heart', null];

/** Perfiles y tonos válidos (uniones de src/types/bridge.ts). */
const VALID_PROFILES = ['administrativo', 'profesor', 'estudiante', 'animador'];
const VALID_TONES = ['friendly', 'formal', 'playful', 'calm'];

describe('environmentRegistry — catálogo de ambientes', () => {
    test('existen exactamente 5 ambientes pilotos con los ids esperados', () => {
        expect(getAmbientes()).toHaveLength(EXPECTED_IDS.length);
        expect(getAmbientes().map((ambiente) => ambiente.id)).toEqual(EXPECTED_IDS);
    });

    test('los ids del catálogo son únicos', () => {
        const ids = getAmbientes().map((ambiente) => ambiente.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('getAmbientes() devuelve el mismo catálogo (referencia constante)', () => {
        expect(getAmbientes()).toBe(ENVIRONMENTS);
    });
});

describe('environmentRegistry — campos completos (data-driven)', () => {
    for (const ambiente of getAmbientes()) {
        test(`[${ambiente.id}] identidad y mensajes de bienvenida completos`, () => {
            expect(ambiente.id.trim()).not.toBe('');
            expect(ambiente.nombre.trim()).not.toBe('');
            expect(ambiente.tagline.trim()).not.toBe('');
            expect(ambiente.icono.trim()).not.toBe('');
            expect(ambiente.bienvenida.es.trim()).not.toBe('');
            expect(ambiente.bienvenida.en.trim()).not.toBe('');
        });

        test(`[${ambiente.id}] frases de activación es/en no vacías`, () => {
            expect(ambiente.frasesActivacion.es.length).toBeGreaterThan(0);
            expect(ambiente.frasesActivacion.en.length).toBeGreaterThan(0);
        });

        test(`[${ambiente.id}] voz: perfil válido, frases es/en y tono permitido`, () => {
            expect(VALID_PROFILES).toContain(ambiente.voz.perfil);
            expect(ambiente.voz.frases.es.length).toBeGreaterThan(0);
            expect(ambiente.voz.frases.en.length).toBeGreaterThan(0);
            if (ambiente.voz.tone !== undefined) {
                expect(VALID_TONES).toContain(ambiente.voz.tone);
            }
        });

        test(`[${ambiente.id}] pestañas visibles no vacías, válidas y sin duplicados`, () => {
            expect(ambiente.pestanas.mostrar.length).toBeGreaterThan(0);
            for (const tab of ambiente.pestanas.mostrar) {
                expect(ENVIRONMENT_TAB_IDS).toContain(tab);
            }
            expect(new Set(ambiente.pestanas.mostrar).size).toBe(ambiente.pestanas.mostrar.length);
        });

        test(`[${ambiente.id}] tema: decoración válida y claves CSS permitidas`, () => {
            expect(VALID_DECORATIONS).toContain(ambiente.tema.decoracion);
            for (const key of Object.keys(ambiente.tema.vars)) {
                expect(ENVIRONMENT_CSS_VAR_KEYS).toContain(key);
            }
        });
    }
});

describe('environmentRegistry — ambiente por defecto', () => {
    test('DEFAULT_AMBIENTE_ID es "asistente" y abre el catálogo', () => {
        expect(DEFAULT_AMBIENTE_ID).toBe('asistente');
        expect(ENVIRONMENTS[0].id).toBe(DEFAULT_AMBIENTE_ID);
    });

    test('getDefaultAmbiente() resuelve al ambiente por defecto', () => {
        expect(getDefaultAmbiente().id).toBe(DEFAULT_AMBIENTE_ID);
        expect(getDefaultAmbiente()).toBe(ENVIRONMENTS[0]);
    });

    test('asistente no inyecta tema: vars vacías, sin decoración y capa visible', () => {
        const asistente = getAmbiente(DEFAULT_AMBIENTE_ID)!;
        expect(asistente.tema.vars).toEqual({});
        expect(asistente.tema.decoracion).toBeNull();
        expect(asistente.tema.capVisible).toBe(true);
    });

    test('asistente muestra las 5 pestañas de la shell', () => {
        const asistente = getAmbiente(DEFAULT_AMBIENTE_ID)!;
        expect(asistente.pestanas.mostrar).toEqual([...ENVIRONMENT_TAB_IDS]);
    });
});

describe('environmentRegistry — tema visual (variables CSS)', () => {
    test('cada ambiente no-default define las 8 variables CSS `--flu-*`', () => {
        for (const ambiente of getAmbientes()) {
            if (ambiente.id === DEFAULT_AMBIENTE_ID) continue;
            for (const key of ENVIRONMENT_CSS_VAR_KEYS) {
                const value = ambiente.tema.vars[key];
                expect(value).toBeDefined();
                expect(value!.trim()).not.toBe('');
            }
        }
    });
});

describe('environmentRegistry — contenido y proactividad', () => {
    test('cada ambiente declara un catálogo de contenido existente', () => {
        for (const ambiente of getAmbientes()) {
            expect(Array.isArray(ambiente.contenido.catalogo)).toBe(true);
        }
    });

    test('cada ambiente no-default destaca contenido y define proactividad en [0,1]', () => {
        for (const ambiente of getAmbientes()) {
            if (ambiente.id === DEFAULT_AMBIENTE_ID) continue;
            expect(ambiente.contenido.catalogo.length).toBeGreaterThan(0);
            const proactividad = ambiente.contenido.proactividad;
            expect(proactividad).toBeDefined();
            expect(proactividad!).toBeGreaterThanOrEqual(0);
            expect(proactividad!).toBeLessThanOrEqual(1);
        }
    });

    test('cada ambiente no-default tiene instrucciones de rol para el sistema', () => {
        for (const ambiente of getAmbientes()) {
            if (ambiente.id === DEFAULT_AMBIENTE_ID) continue;
            expect(ambiente.voz.instrucciones.trim()).not.toBe('');
        }
    });
});

describe('environmentRegistry — accessors puros', () => {
    test('getAmbiente resuelve cada id del catálogo', () => {
        for (const ambiente of getAmbientes()) {
            expect(getAmbiente(ambiente.id)?.id).toBe(ambiente.id);
        }
    });

    test('getAmbiente devuelve undefined para ids desconocidos', () => {
        expect(getAmbiente('no-existe')).toBeUndefined();
        expect(getAmbiente('')).toBeUndefined();
    });

    test('isAmbienteId acepta ids válidos y rechaza inválidos', () => {
        for (const ambiente of getAmbientes()) {
            expect(isAmbienteId(ambiente.id)).toBe(true);
        }
        expect(isAmbienteId('no-existe')).toBe(false);
        expect(isAmbienteId('')).toBe(false);
    });

    test('getVisibleTabIds refleja las pestañas declaradas por el ambiente', () => {
        for (const ambiente of getAmbientes()) {
            expect([...getVisibleTabIds(ambiente.id)]).toEqual(ambiente.pestanas.mostrar);
        }
    });

    test('getVisibleTabIds devuelve todas las pestañas para ids desconocidos (fallback seguro)', () => {
        expect([...getVisibleTabIds('no-existe')]).toEqual([...ENVIRONMENT_TAB_IDS]);
    });

    test('getEnvironmentCssVars refleja las variables declaradas por el ambiente', () => {
        for (const ambiente of getAmbientes()) {
            expect(getEnvironmentCssVars(ambiente.id)).toEqual(ambiente.tema.vars);
        }
    });

    test('getEnvironmentCssVars devuelve {} para ids desconocidos', () => {
        expect(getEnvironmentCssVars('no-existe')).toEqual({});
    });
});
