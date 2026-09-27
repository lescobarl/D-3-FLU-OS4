// ============================================================
// surfaceMatrix - invariantes DERIVADOS de las superficies de comandos que NO
// son juegos: NOTAS, CONFIGURACION/PANEL y ENTORNOS.
//
// Mismo contrato que la matriz de motores (G6): una superficie se PUBLICA como
// dato y el test recorre TODAS las entradas de esa superficie, sin listas
// manuales. "Declarado pero no entendido" = deriva.
//
//   S1 NOTAS    - cada capacidad de NOTE_COMMAND_SURFACE se entiende.
//   S2 PANEL    - cada clave del catalogo de configuracion es gestionable por
//                 voz (aparece en el prompt que ve la IA) o es explicitamente
//                 no soportada con motivo.
//   S3 ENTORNOS - cada frase de activacion de cada ambiente activa ESE ambiente;
//                 las pestanas y variables CSS usadas pertenecen al registro.
// ============================================================
import { describe, expect, it } from 'vitest';

import {
    NOTE_COMMAND_SURFACE,
    parseNoteIntentText,
    parseNoteItemRemoveIntentText,
    parseNoteRemoveIntentText,
} from '../src/voice/lib/noteIntentParser.js';
import {
    VOICE_CONFIG_CATALOG,
    buildConfiguracionPrompt,
} from '../src/core/config/voiceConfigCatalog';
import {
    ENVIRONMENTS,
    ENVIRONMENT_TAB_IDS,
    ENVIRONMENT_CSS_VAR_KEYS,
    DEFAULT_AMBIENTE_ID,
} from '../src/core/environments/environmentRegistry';
import { resolveEnvironmentIntent } from '../src/core/environments/environmentIntents';

// ------------------------------------------------------------
// S1 NOTAS
// ------------------------------------------------------------
describe('S1 notas - toda capacidad declarada se entiende', () => {
    type Espera = Record<string, unknown>;
    type ParseNota = { label?: string; body?: string };
    type ParseRemove = { target: string | null; all: boolean };

    const cumple = (espera: Espera, got: Record<string, unknown> | null): string | null => {
        if (got === null) return 'no se entendio (null)';
        for (const [clave, valor] of Object.entries(espera)) {
            const real = got[clave];
            if (valor === null) {
                if (real !== null && real !== undefined) return `${clave}=${JSON.stringify(real)} (esperaba null)`;
                continue;
            }
            if (typeof valor === 'string' && valor.startsWith('prefijo:')) {
                const prefijo = valor.slice('prefijo:'.length);
                if (typeof real !== 'string' || !real.startsWith(prefijo)) {
                    return `${clave}=${JSON.stringify(real)} (esperaba prefijo "${prefijo}")`;
                }
                continue;
            }
            if (valor === 'no-vacio') {
                if (typeof real !== 'string' || real.trim() === '') return `${clave} vacio o ausente`;
                continue;
            }
            if (real !== valor) return `${clave}=${JSON.stringify(real)} (esperaba ${JSON.stringify(valor)})`;
        }
        return null;
    };

    it('la superficie publicada es unica y no tiene ids repetidos', () => {
        const ids = NOTE_COMMAND_SURFACE.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBeGreaterThanOrEqual(9);
    });

    it('cada frase testigo declarada produce el resultado declarado', () => {
        const fallos: string[] = [];
        let frases = 0;
        const cubiertos = new Set<string>();
        for (const capacidad of NOTE_COMMAND_SURFACE) {
            cubiertos.add(capacidad.parser);
            for (const frase of capacidad.frases) {
                frases += 1;
                const got =
                    capacidad.parser === 'remove'
                        ? (parseNoteRemoveIntentText(frase) as ParseRemove | null)
                        : capacidad.parser === 'removeItem'
                          ? (parseNoteItemRemoveIntentText(frase) as ParseNota | null)
                          : (parseNoteIntentText(frase) as ParseNota | null);
                const problema = cumple(capacidad.espera as Espera, got as Record<string, unknown> | null);
                if (problema) fallos.push(`[${capacidad.id}] "${frase}" -> ${problema}`);
            }
        }
        expect({ frases: frases > 0, parsers: [...cubiertos].sort() }).toEqual({
            frases: true,
            parsers: ['nota', 'remove', 'removeItem'],
        });
        expect(fallos).toEqual([]);
    });
});

// ------------------------------------------------------------
// S2 PANEL / CONFIGURACION
// ------------------------------------------------------------
describe('S2 panel - toda clave del catalogo es gestionable por voz o no soportada con motivo', () => {
    const prompts = {
        es: buildConfiguracionPrompt('es'),
        en: buildConfiguracionPrompt('en'),
    };

    it('el catalogo tiene claves unicas por accion y ambas acciones pobladas', () => {
        const pares = VOICE_CONFIG_CATALOG.map((e) => `${e.accion}:${e.clave}`);
        expect(new Set(pares).size).toBe(pares.length);
        expect(new Set(VOICE_CONFIG_CATALOG.map((e) => e.accion))).toEqual(
            new Set(['set_branding', 'set_config']),
        );
    });

    it('toda clave aparece en el prompt que ve la IA (es y en): ninguna es invisible', () => {
        const invisibles: string[] = [];
        for (const entry of VOICE_CONFIG_CATALOG) {
            for (const [lang, prompt] of Object.entries(prompts)) {
                if (!prompt.includes(entry.clave)) {
                    invisibles.push(`${entry.clave} (${lang})`);
                }
            }
        }
        expect(invisibles).toEqual([]);
    });

    it('toda entrada del panel declara es/en; lo no soportado declara el motivo', () => {
        const fallos: string[] = [];
        for (const entry of VOICE_CONFIG_CATALOG) {
            if (!entry.descripcionEs?.trim() || !entry.descripcionEn?.trim()) {
                fallos.push(`${entry.clave} sin descripcion es/en`);
            }
            const noSoportado = entry.handler === 'unsupported' || Boolean(entry.motivoNoSoportado);
            if (noSoportado && !entry.motivoNoSoportado?.trim()) {
                fallos.push(`${entry.clave} no soportada sin motivo`);
            }
            if (!noSoportado && entry.motivoNoSoportado) {
                fallos.push(`${entry.clave} soportada pero con motivo de no soporte`);
            }
        }
        expect(fallos).toEqual([]);
    });
});

// ------------------------------------------------------------
// S3 ENTORNOS
// ------------------------------------------------------------
describe('S3 entornos - cada frase de activacion activa su ambiente', () => {
    it('cada frase es/en de cada ambiente resuelve a ESE ambiente', () => {
        const fallos: string[] = [];
        let frases = 0;
        for (const ambiente of ENVIRONMENTS) {
            for (const lang of ['es', 'en'] as const) {
                for (const frase of ambiente.frasesActivacion?.[lang] ?? []) {
                    frases += 1;
                    const intent = resolveEnvironmentIntent(frase, lang);
                    const esperado = ambiente.id === DEFAULT_AMBIENTE_ID ? 'reset' : 'activar';
                    if (!intent) {
                        fallos.push(`${ambiente.id} (${lang}) "${frase}" -> no resuelve`);
                    } else if (intent.tipo !== esperado || intent.ambienteId !== ambiente.id) {
                        fallos.push(
                            `${ambiente.id} (${lang}) "${frase}" -> ${intent.tipo}/${intent.ambienteId} (esperaba ${esperado}/${ambiente.id})`,
                        );
                    }
                }
            }
        }
        expect(frases).toBeGreaterThan(0);
        expect(fallos).toEqual([]);
    });

    it('las pestanas y variables CSS usadas pertenecen al registro declarado', () => {
        const tabs = new Set<string>(ENVIRONMENT_TAB_IDS);
        const varKeys = new Set<string>(ENVIRONMENT_CSS_VAR_KEYS);
        const fallos: string[] = [];
        for (const ambiente of ENVIRONMENTS) {
            for (const tab of ambiente.pestanas?.mostrar ?? []) {
                if (!tabs.has(tab)) fallos.push(`${ambiente.id} usa pestana desconocida "${tab}"`);
            }
            for (const key of Object.keys(ambiente.tema?.vars ?? {})) {
                if (!varKeys.has(key)) fallos.push(`${ambiente.id} define variable CSS desconocida "${key}"`);
            }
        }
        expect(fallos).toEqual([]);
    });

    it('cada ambiente declara bienvenida, voz y frases de activacion en ambos idiomas', () => {
        const fallos: string[] = [];
        for (const ambiente of ENVIRONMENTS) {
            if (!ambiente.bienvenida?.es?.trim() || !ambiente.bienvenida?.en?.trim()) {
                fallos.push(`${ambiente.id} sin bienvenida es/en`);
            }
            if (!ambiente.voz?.frases?.es?.length || !ambiente.voz?.frases?.en?.length) {
                fallos.push(`${ambiente.id} sin frases de voz es/en`);
            }
            if (!ambiente.frasesActivacion?.es?.length || !ambiente.frasesActivacion?.en?.length) {
                fallos.push(`${ambiente.id} sin frases de activacion es/en`);
            }
        }
        expect(fallos).toEqual([]);
    });
});
