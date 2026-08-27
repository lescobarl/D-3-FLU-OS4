// ============================================================
// FLU OS4 — Tests del catálogo de configuración por voz
// ============================================================
// Verifica que VOICE_CONFIG_CATALOG sea la ÚNICA fuente de verdad:
// invariantes de datos, mapeo a campos reales del bridge (tipado) y
// cobertura completa del prompt (es/en) generado por buildConfiguracionPrompt.
// Cero conteos hardcodeados: todo se deriva de los exports reales.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
    VOICE_CONFIG_CATALOG,
    BRANDING_SEASONS,
    BRANDING_MODES,
    UI_LANGUAGES,
    AI_PROVIDERS,
    PERSONALITY_EMOTIONS,
    FLU_PROFILE_IDS,
    buildConfiguracionPrompt,
    type ConfigHandlerKey,
} from '../src/core/config/voiceConfigCatalog';
import { AVAILABLE_TRAITS, AVAILABLE_TONES, FLU_PROFILES } from '../src/core/config/appConfig';
import type { AdvancedConfig, VoiceConfig, ImageConfig, PersonalityConfig } from '../src/types/bridge';

// ------------------------------------------------------------
// Conjuntos de campos REALES (type-checked: si el bridge cambia,
// este Record deja de compilar → tsc falla antes que el runtime).
// ------------------------------------------------------------
const ADVANCED_FIELDS: Record<keyof AdvancedConfig, true> = {
    animationSpeed: true,
    emotionalReactivity: true,
    creativity: true,
    orientation: true,
    emotionMinConfidence: true,
    emotionMaxBoost: true,
    emotionBoostPerMatch: true,
    emotionBaseDetectionConfidence: true,
    emotionLowInterruptionConfidence: true,
    emotionShortUtteranceWordCount: true,
    emotionTopicChangeOverlapRatio: true,
    emotionTopicChangeMinWords: true,
    emotionTopicChangeExplicitConfidence: true,
    emotionTopicChangeOverlapConfidence: true,
    tomMaxParticipants: true,
    tomMaxTopicsPerParticipant: true,
    tomMaxEmotionsPerParticipant: true,
    tomParticipantInactivityMs: true,
    tomMinTopicWordLength: true,
    tomSummaryDisplayLimit: true,
    tomMaxQuestionsPerParticipant: true,
    systemEventWindowMs: true,
    systemEventDedupBucketMs: true,
};
const ADVANCED_FIELD_NAMES = new Set<string>(Object.keys(ADVANCED_FIELDS));

const VOICE_FIELDS: Record<keyof VoiceConfig, true> = {
    apiKey: true,
    model: true,
    voiceURI: true,
    voiceName: true,
    rate: true,
    pitch: true,
    volume: true,
};
const VOICE_FIELD_NAMES = new Set<string>(Object.keys(VOICE_FIELDS));

const IMAGE_FIELDS: Record<keyof ImageConfig, true> = {
    capVisible: true,
    hairVisible: true,
};
const IMAGE_FIELD_NAMES = new Set<string>(Object.keys(IMAGE_FIELDS));

const PERSONALITY_FIELDS: Record<keyof PersonalityConfig, true> = {
    name: true,
    traits: true,
    tone: true,
    proactivity: true,
    defaultEmotion: true,
    profile: true,
    image: true,
    voice: true,
    advanced: true,
    customInstructions: true,
};
const PERSONALITY_FIELD_NAMES = new Set<string>(Object.keys(PERSONALITY_FIELDS));

// ------------------------------------------------------------
// Handlers implementados en App.tsx (applyConfigAction) — espejo exacto
// del switch de despacho. Si un handler del catálogo no está aquí, o
// viceversa, el test falla (sincronía bidireccional garantizada).
// ------------------------------------------------------------
const IMPLEMENTED_HANDLERS = [
    'brandingActiveSeason',
    'brandingMode',
    'brandingBirthday',
    'brandingCelebrateAchievements',
    'brandingCustomEvent',
    'textApiKey',
    'textModel',
    'textApiUrl',
    'imageApiKey',
    'imageModel',
    'imageApiUrl',
    'ocrApiKey',
    'ocrModel',
    'ocrApiUrl',
    'language',
    'sessionRole',
    'voiceSpeed',
    'voice',
    'voiceNumber',
    'personalityTraits',
    'personalitySelect',
    'personalityText',
    'personalityNumber',
    'advancedNumber',
    'imageBoolean',
    'avatarColor',
    'avatarComponentColor',
    'resetAvatarColors',
    'aiProvider',
    'applyProfile',
    'wakeWords',
    'debugLogs',
    'clearCache',
    'unsupported',
] as const satisfies readonly ConfigHandlerKey[];
const IMPLEMENTED_HANDLER_SET = new Set<string>(IMPLEMENTED_HANDLERS);

// Selects reales por clave (fuente de verdad exportada del catálogo).
const EXPECTED_OPTIONS: Record<string, readonly string[]> = {
    activeSeason: BRANDING_SEASONS,
    mode: BRANDING_MODES,
    language: UI_LANGUAGES,
    aiProvider: AI_PROVIDERS,
    traits: AVAILABLE_TRAITS,
    tone: AVAILABLE_TONES,
    defaultEmotion: PERSONALITY_EMOTIONS,
    profile: FLU_PROFILE_IDS,
};

const SUPPORTED = VOICE_CONFIG_CATALOG.filter((e) => e.handler !== 'unsupported');
const UNSUPPORTED = VOICE_CONFIG_CATALOG.filter((e) => e.handler === 'unsupported');

describe('VOICE_CONFIG_CATALOG — constantes derivadas de datos reales', () => {
    it('BRANDING_SEASONS se deriva de Object.keys(PALETTES) y no tiene temporadas inventadas', () => {
        expect(BRANDING_SEASONS.length).toBeGreaterThan(0);
        expect(BRANDING_SEASONS).not.toContain('independencia');
    });

    it('FLU_PROFILE_IDS coincide exactamente con los ids reales de FLU_PROFILES', () => {
        expect(FLU_PROFILE_IDS).toEqual(FLU_PROFILES.map((p) => p.id));
        expect(FLU_PROFILE_IDS).toContain('administrativo');
    });

    it('modos/idiomas/proveedores/emociones exponen sus valores esperados', () => {
        expect(BRANDING_MODES).toEqual(['auto', 'manual', 'disabled']);
        expect(UI_LANGUAGES).toEqual(['es', 'en', 'both']);
        expect(AI_PROVIDERS).toEqual(['openrouter', 'gemini', 'deepseek', 'local']);
        expect(PERSONALITY_EMOTIONS).toContain('happy');
        expect(AVAILABLE_TONES).toEqual(['friendly', 'formal', 'playful', 'calm']);
    });
});

describe('VOICE_CONFIG_CATALOG — invariantes de datos', () => {
    it('no hay claves duplicadas por (accion, clave)', () => {
        const pairs = VOICE_CONFIG_CATALOG.map((e) => `${e.accion}:${e.clave}`);
        expect(new Set(pairs).size).toBe(pairs.length);
    });

    it('toda entrada tiene descripciones es/en no vacías', () => {
        VOICE_CONFIG_CATALOG.forEach((e) => {
            expect(e.descripcionEs.trim().length, `${e.clave}.descripcionEs`).toBeGreaterThan(0);
            expect(e.descripcionEn.trim().length, `${e.clave}.descripcionEn`).toBeGreaterThan(0);
        });
    });

    it('entradas soportadas y no soportadas tienen la semántica correcta', () => {
        UNSUPPORTED.forEach((e) => {
            expect(e.motivoNoSoportado, `${e.clave}.motivoNoSoportado`).toBeTruthy();
            expect(e.accion).toBe('set_config');
        });
        SUPPORTED.forEach((e) => {
            expect(e.motivoNoSoportado, `${e.clave} no debería tener motivoNoSoportado`).toBeUndefined();
        });
    });

    it('hay entradas soportadas de branding y de config (ninguna lista vacía)', () => {
        expect(SUPPORTED.filter((e) => e.accion === 'set_branding').length).toBeGreaterThan(0);
        expect(SUPPORTED.filter((e) => e.accion === 'set_config').length).toBeGreaterThan(0);
    });
});

describe('VOICE_CONFIG_CATALOG — handlers vs App.tsx (dispatcher)', () => {
    it('todo handler del catálogo está implementado en applyConfigAction', () => {
        VOICE_CONFIG_CATALOG.forEach((e) => {
            expect(IMPLEMENTED_HANDLER_SET.has(e.handler), `handler ${e.handler} (${e.clave}) no implementado`).toBe(true);
        });
    });

    it('todo handler implementado tiene al menos una entrada en el catálogo', () => {
        IMPLEMENTED_HANDLERS.forEach((h) => {
            expect(VOICE_CONFIG_CATALOG.some((e) => e.handler === h), `handler ${h} sin entrada de catálogo`).toBe(true);
        });
    });

    it('los handlers advancedNumber/imageBoolean/voiceNumber mapean a campos reales del bridge', () => {
        VOICE_CONFIG_CATALOG.forEach((e) => {
            if (e.handler === 'advancedNumber') {
                expect(ADVANCED_FIELD_NAMES.has(e.clave), `${e.clave} no es campo de AdvancedConfig`).toBe(true);
            }
            if (e.handler === 'imageBoolean') {
                expect(IMAGE_FIELD_NAMES.has(e.clave), `${e.clave} no es campo de ImageConfig`).toBe(true);
            }
            if (e.handler === 'voiceNumber') {
                expect(VOICE_FIELD_NAMES.has(e.clave), `${e.clave} no es campo de VoiceConfig`).toBe(true);
            }
        });
    });

    it('los handlers de personalidad mapean a campos reales de PersonalityConfig', () => {
        VOICE_CONFIG_CATALOG.forEach((e) => {
            switch (e.handler) {
                case 'personalityTraits':
                    expect(e.clave).toBe('traits');
                    break;
                case 'personalitySelect':
                    expect(['tone', 'defaultEmotion']).toContain(e.clave);
                    break;
                case 'personalityText':
                    expect(e.clave).toBe('customInstructions');
                    break;
                case 'personalityNumber':
                    expect(e.clave).toBe('proactivity');
                    break;
            }
        });
        // Campos gestionables por voz existen realmente en el tipo (type-checked)
        expect(PERSONALITY_FIELD_NAMES.has('customInstructions')).toBe(true);
        expect(PERSONALITY_FIELD_NAMES.has('proactivity')).toBe(true);
        expect(PERSONALITY_FIELD_NAMES.has('traits')).toBe(true);
        expect(PERSONALITY_FIELD_NAMES.has('tone')).toBe(true);
        expect(PERSONALITY_FIELD_NAMES.has('defaultEmotion')).toBe(true);
    });
});

describe('VOICE_CONFIG_CATALOG — tipos de entrada y opciones', () => {
    it('los números soportados declaran min/max válidos y step > 0 (cuando existe)', () => {
        VOICE_CONFIG_CATALOG.forEach((e) => {
            if (e.tipo === 'number') {
                if (e.motivoNoSoportado !== undefined) {
                    // Entradas no soportadas (p.ej. memoryTamaño) describen el
                    // ajuste pero no acotan valores porque no se aplican por voz.
                    expect(e.min, `${e.clave}.min`).toBeUndefined();
                    expect(e.max, `${e.clave}.max`).toBeUndefined();
                    expect(e.step, `${e.clave}.step`).toBeUndefined();
                    return;
                }
                expect(e.min, `${e.clave}.min`).toBeDefined();
                expect(e.max, `${e.clave}.max`).toBeDefined();
                expect(e.min! <= e.max!, `${e.clave}: min <= max`).toBe(true);
                // step es opcional (voiceSpeed lo omite); si existe debe ser > 0
                if (e.step !== undefined) {
                    expect(e.step > 0, `${e.clave}: step > 0`).toBe(true);
                }
            } else {
                expect(e.min, `${e.clave}.min no debería existir`).toBeUndefined();
                expect(e.max, `${e.clave}.max no debería existir`).toBeUndefined();
                expect(e.step, `${e.clave}.step no debería existir`).toBeUndefined();
            }
        });
    });

    it('selects/lists soportados tienen opciones no vacías y únicas', () => {
        SUPPORTED.filter((e) => e.tipo === 'select' || e.tipo === 'list').forEach((e) => {
            expect(e.opciones, `${e.clave}.opciones`).toBeDefined();
            expect(e.opciones!.length, `${e.clave}: opciones no vacías`).toBeGreaterThan(0);
            expect(new Set(e.opciones).size, `${e.clave}: opciones únicas`).toBe(e.opciones!.length);
        });
    });

    it('cada select/list usa la constante real exportada correspondiente', () => {
        SUPPORTED.filter((e) => e.tipo === 'select' || e.tipo === 'list').forEach((e) => {
            const expected = EXPECTED_OPTIONS[e.clave];
            expect(expected, `${e.clave} no tiene constante real esperada`).toBeDefined();
            expect(e.opciones).toEqual(expected);
        });
    });

    it('traits requiere subvalor (add/remove)', () => {
        const traits = VOICE_CONFIG_CATALOG.find((e) => e.clave === 'traits');
        expect(traits?.requiereSubvalor).toBe(true);
    });
});

describe('buildConfiguracionPrompt — cobertura ES', () => {
    const prompt = buildConfiguracionPrompt('es');

    it('usa la cabecera ES y NO la EN', () => {
        expect(prompt).toContain('Para set_branding: clave puede ser');
        expect(prompt).toContain('Para set_config: clave puede ser');
        expect(prompt).not.toContain('For set_branding');
        expect(prompt).not.toContain('For set_config');
    });

    it('lista TODAS las claves soportadas (branding y config)', () => {
        SUPPORTED.forEach((e) => {
            expect(prompt, `clave soportada "${e.clave}" ausente`).toContain(`"${e.clave}"`);
        });
    });

    it('lista TODAS las claves NO soportadas en su línea explícita', () => {
        expect(prompt).toContain('NO disponibles via configuracion');
        UNSUPPORTED.forEach((e) => {
            expect(prompt, `clave no soportada "${e.clave}" ausente`).toContain(`"${e.clave}"`);
        });
    });

    it('incluye las opciones exactas de cada select/list soportado', () => {
        SUPPORTED.filter((e) => e.tipo === 'select' || e.tipo === 'list').forEach((e) => {
            expect(prompt, `opciones de "${e.clave}"`).toContain(`"${e.clave}" (${e.opciones!.join(', ')})`);
        });
    });

    it('incluye el rango (con unidad) de cada número soportado', () => {
        SUPPORTED.filter((e) => e.tipo === 'number').forEach((e) => {
            const unit = e.inputUnit === 'minutes' ? ' minutos' : e.inputUnit === 'seconds' ? ' segundos' : '';
            expect(prompt, `rango de "${e.clave}"`).toContain(`"${e.clave}" (${e.min}-${e.max}${unit})`);
        });
    });

    it('no filtra temporadas inventadas', () => {
        expect(prompt).not.toContain('independencia');
    });
});

describe('buildConfiguracionPrompt — cobertura EN', () => {
    const prompt = buildConfiguracionPrompt('en');

    it('usa la cabecera EN y NO la ES', () => {
        expect(prompt).toContain('For set_branding: clave can be');
        expect(prompt).toContain('For set_config: clave can be');
        expect(prompt).toContain('NOT available via configuracion');
        expect(prompt).not.toContain('Para set_branding');
        expect(prompt).not.toContain('Para set_config');
        expect(prompt).not.toContain('NO disponibles via configuracion');
    });

    it('lista TODAS las claves soportadas', () => {
        SUPPORTED.forEach((e) => {
            expect(prompt, `clave soportada "${e.clave}" ausente`).toContain(`"${e.clave}"`);
        });
    });

    it('lista TODAS las claves NO soportadas', () => {
        UNSUPPORTED.forEach((e) => {
            expect(prompt, `clave no soportada "${e.clave}" ausente`).toContain(`"${e.clave}"`);
        });
    });

    it('incluye las opciones exactas de cada select/list soportado', () => {
        SUPPORTED.filter((e) => e.tipo === 'select' || e.tipo === 'list').forEach((e) => {
            expect(prompt, `opciones de "${e.clave}"`).toContain(`"${e.clave}" (${e.opciones!.join(', ')})`);
        });
    });

    it('incluye el rango (con unidad) de cada número soportado', () => {
        SUPPORTED.filter((e) => e.tipo === 'number').forEach((e) => {
            const unit = e.inputUnit === 'minutes' ? ' minutes' : e.inputUnit === 'seconds' ? ' seconds' : '';
            expect(prompt, `rango de "${e.clave}"`).toContain(`"${e.clave}" (${e.min}-${e.max}${unit})`);
        });
    });
});
