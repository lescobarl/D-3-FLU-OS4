// ============================================================
// environmentIntents — Resolvedor determinista de intents de ambiente (por voz)
//   - resolveEnvironmentIntent (texto transcrito → intent { tipo, ambienteId })
//   - normalizeEnvironment     (contrato crudo string|objeto → intent válido)
// Objetivo: validar la activación por voz de ambientes (Q11 — Sistema de
// Ambientes) mediante el MISMO patrón determinista de configCommands/gameCommands:
// el intent se deriva del texto contrastando `frasesActivacion` del catálogo
// (environmentRegistry.ts) y fluye por la ÚNICA ruta existente
// (contract.ambiente → App.tsx applyEnvironment/resetEnvironment).
// Sin parches ni rutas dobles: cada expectativa refleja el comportamiento REAL
// del módulo + el catálogo de ambientes (data-driven, sin hardcode).
// ============================================================
import { describe, test, expect } from 'vitest';
import { resolveEnvironmentIntent, normalizeEnvironment } from '../src/core/environments/environmentIntents';
import { getAmbientes, DEFAULT_AMBIENTE_ID } from '../src/core/environments/environmentRegistry';

const defaultAmbienteId = DEFAULT_AMBIENTE_ID;

/** Ambientes activables (todo el catálogo excepto el por defecto). */
const activationAmbientes = getAmbientes().filter((ambiente) => ambiente.id !== defaultAmbienteId);

describe('environmentIntents — integridad de datos del catálogo', () => {
    test('todos los ambientes tienen frasesActivacion es/en no vacías', () => {
        for (const ambiente of getAmbientes()) {
            expect(ambiente.id).toBeTruthy();
            expect(ambiente.frasesActivacion?.es?.length ?? 0).toBeGreaterThan(0);
            expect(ambiente.frasesActivacion?.en?.length ?? 0).toBeGreaterThan(0);
        }
    });
});

describe('environmentIntents — activación por voz (resolveEnvironmentIntent)', () => {
    test.each(activationAmbientes.map((ambiente) => [ambiente.id, ambiente] as const))(
        'ES: cada frase de "%s" resuelve a activar',
        (_id, ambiente) => {
            for (const frase of ambiente.frasesActivacion.es) {
                expect(resolveEnvironmentIntent(frase, 'es')).toEqual({
                    tipo: 'activar',
                    ambienteId: ambiente.id,
                });
            }
        },
    );

    test.each(activationAmbientes.map((ambiente) => [ambiente.id, ambiente] as const))(
        'EN: cada frase de "%s" resuelve a activar',
        (_id, ambiente) => {
            for (const frase of ambiente.frasesActivacion.en) {
                expect(resolveEnvironmentIntent(frase, 'en')).toEqual({
                    tipo: 'activar',
                    ambienteId: ambiente.id,
                });
            }
        },
    );

    test(`ES: cada frase del ambiente por defecto ("${defaultAmbienteId}") resuelve a reset`, () => {
        const defaultAmbiente = getAmbientes().find((ambiente) => ambiente.id === defaultAmbienteId)!;
        for (const frase of defaultAmbiente.frasesActivacion.es) {
            expect(resolveEnvironmentIntent(frase, 'es')).toEqual({
                tipo: 'reset',
                ambienteId: defaultAmbienteId,
            });
        }
    });

    test(`EN: cada frase del ambiente por defecto ("${defaultAmbienteId}") resuelve a reset`, () => {
        const defaultAmbiente = getAmbientes().find((ambiente) => ambiente.id === defaultAmbienteId)!;
        for (const frase of defaultAmbiente.frasesActivacion.en) {
            expect(resolveEnvironmentIntent(frase, 'en')).toEqual({
                tipo: 'reset',
                ambienteId: defaultAmbienteId,
            });
        }
    });

    test('insensible a acentos: "actúa como chef" → activar chef', () => {
        expect(resolveEnvironmentIntent('actúa como chef', 'es')).toEqual({
            tipo: 'activar',
            ambienteId: 'chef',
        });
    });

    test('insensible a acentos: "modo jardín" → activar jardinero', () => {
        expect(resolveEnvironmentIntent('modo jardín', 'es')).toEqual({
            tipo: 'activar',
            ambienteId: 'jardinero',
        });
    });

    test('idioma no reconocido cae a es (lang por defecto)', () => {
        expect(resolveEnvironmentIntent('modo cocina', 'fr')).toEqual({
            tipo: 'activar',
            ambienteId: 'chef',
        });
    });

    test('texto vacío / solo espacios / sin argumento → null', () => {
        expect(resolveEnvironmentIntent('', 'es')).toBeNull();
        expect(resolveEnvironmentIntent('   ', 'es')).toBeNull();
        expect(resolveEnvironmentIntent()).toBeNull();
    });

    test.each([
        'cuéntame un chiste',
        '¿tienes un modo nocturno?',
        'qué clima hace hoy',
        'cambia el canal a deportes',
        'hola flu',
    ])('sin coincidencia "%s" → null', (phrase) => {
        expect(resolveEnvironmentIntent(phrase, 'es')).toBeNull();
    });
});

describe('environmentIntents — normalizeEnvironment (contrato crudo)', () => {
    test.each(activationAmbientes.map((ambiente) => [ambiente.id, ambiente] as const))(
        'string válido "%s" → activar',
        (_id, ambiente) => {
            expect(normalizeEnvironment(ambiente.id)).toEqual({
                tipo: 'activar',
                ambienteId: ambiente.id,
            });
        },
    );

    test(`string "${defaultAmbienteId}" → reset`, () => {
        expect(normalizeEnvironment(defaultAmbienteId)).toEqual({
            tipo: 'reset',
            ambienteId: defaultAmbienteId,
        });
    });

    test('string con mayúsculas/espacios se normaliza', () => {
        expect(normalizeEnvironment('  Chef ')).toEqual({
            tipo: 'activar',
            ambienteId: 'chef',
        });
    });

    test('string inválido → null', () => {
        expect(normalizeEnvironment('noexiste')).toBeNull();
    });

    test('objeto { tipo: activar, ambienteId } → activar', () => {
        expect(normalizeEnvironment({ tipo: 'activar', ambienteId: 'chef' })).toEqual({
            tipo: 'activar',
            ambienteId: 'chef',
        });
    });

    test('objeto { tipo: reset, ambienteId } → reset siempre apunta al ambiente por defecto', () => {
        expect(normalizeEnvironment({ tipo: 'reset', ambienteId: 'chef' })).toEqual({
            tipo: 'reset',
            ambienteId: defaultAmbienteId,
        });
    });

    test('objeto { tipo: activar, ambienteId: default } se coacciona a reset', () => {
        expect(normalizeEnvironment({ tipo: 'activar', ambienteId: defaultAmbienteId })).toEqual({
            tipo: 'reset',
            ambienteId: defaultAmbienteId,
        });
    });

    test('objeto inválido → null', () => {
        expect(normalizeEnvironment({ tipo: 'activar', ambienteId: 'nope' })).toBeNull();
        expect(normalizeEnvironment({ tipo: 'raro', ambienteId: 'chef' })).toBeNull();
        expect(normalizeEnvironment({})).toBeNull();
        expect(normalizeEnvironment(null)).toBeNull();
        expect(normalizeEnvironment(undefined)).toBeNull();
        expect(normalizeEnvironment(42 as unknown as string)).toBeNull();
    });
});
