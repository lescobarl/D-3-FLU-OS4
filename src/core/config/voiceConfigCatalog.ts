// ============================================================
// FLU OS4 — Catálogo de configuración por voz (single source of truth)
// ============================================================
// Este catálogo es la ÚNICA fuente de verdad de las opciones que FLU
// puede gestionar por voz mediante el contrato `configuracion`.
//
// - gemini.js consume `buildConfiguracionPrompt()` para instruir a la IA
//   sobre qué claves emitir (elimina el prompt hardcodeado antiguo).
// - App.tsx consume `VOICE_CONFIG_CATALOG` + los `handler` para despachar
//   cada clave a la acción real (elimina el switch hardcodeado).
//
// Cualquier nueva opción del módulo de configuración se agrega AQUÍ
// (dato + handler + descripciones es/en) y queda gestionable por voz
// de forma automática, sin tocar el prompt ni el despachador.
// ============================================================

import { PALETTES } from '../branding/seasonalPalettes';
import { AVAILABLE_TRAITS, AVAILABLE_TONES, FLU_PROFILES } from './appConfig';

// ------------------------------------------------------------
// Tipos del catálogo
// ------------------------------------------------------------

/**
 * Claves de handler: cada una corresponde a UNA estrategia de despacho
 * concreta en App.tsx (applyConfigAction). El catálogo mapea clave → handler.
 */
export type ConfigHandlerKey =
    // Branding (set_branding)
    | 'brandingActiveSeason'
    | 'brandingMode'
    | 'brandingBirthday'
    | 'brandingCelebrateAchievements'
    | 'brandingCustomEvent'
    // Text (Gemini)
    | 'textApiKey'
    | 'textModel'
    | 'textApiUrl'
    // Image (Pollinations)
    | 'imageApiKey'
    | 'imageModel'
    | 'imageApiUrl'
    // OCR (local Tesseract por defecto + endpoint remoto opcional)
    | 'ocrApiKey'
    | 'ocrModel'
    | 'ocrApiUrl'
    // General
    | 'language'
    | 'sessionRole'
    // Voz (VoiceConfig)
    | 'voiceSpeed'
    | 'voice'
    | 'voiceNumber'
    // Personalidad (PersonalityConfig → setPersonality)
    | 'personalityTraits'
    | 'personalitySelect'
    | 'personalityText'
    | 'personalityNumber'
    // Avanzado (AdvancedConfig → setAdvancedConfig)
    | 'advancedNumber'
    // Imagen del avatar (ImageConfig → setImageConfig)
    | 'imageBoolean'
    // Colores del avatar (BunnyStore)
    | 'avatarColor'
    | 'avatarComponentColor'
    | 'resetAvatarColors'
    // Motor IA / Perfil
    | 'aiProvider'
    | 'applyProfile'
    // Voz / utilidades (set_config → useConfigPersistence)
    | 'wakeWords'
    | 'debugLogs'
    | 'clearCache'
    // No gestionable por voz (documentado; no emite acción)
    | 'unsupported';

/** Unidad de entrada de un número (para conversión a ms en el despachador). */
export type ConfigInputUnit = 'number' | 'minutes' | 'seconds';

export interface ConfigCatalogEntry {
    /** Clave que emite la IA en `configuracion.clave` */
    clave: string;
    /** Acción del contrato a la que pertenece la clave */
    accion: 'set_branding' | 'set_config';
    /** Estrategia de despacho en App.tsx */
    handler: ConfigHandlerKey;
    /** Tipo semántico del valor esperado */
    tipo: 'text' | 'password' | 'number' | 'boolean' | 'select' | 'color' | 'action' | 'list' | 'voice' | 'date' | 'custom';
    /** Rango mínimo (solo tipo number) */
    min?: number;
    /** Rango máximo (solo tipo number) */
    max?: number;
    /** Paso del slider (solo tipo number) */
    step?: number;
    /** Opciones válidas (solo tipo select/list) */
    opciones?: readonly string[];
    /** Unidad de entrada del valor numérico */
    inputUnit?: ConfigInputUnit;
    /** Requiere `subvalor` para actuar (ej. traits: "add" | "remove") */
    requiereSubvalor?: boolean;
    /** Razón de no soporte (solo handler === 'unsupported') */
    motivoNoSoportado?: string;
    /** Descripción corta en español (para el prompt y el catálogo humano) */
    descripcionEs: string;
    /** Descripción corta en inglés */
    descripcionEn: string;
}

// ------------------------------------------------------------
// Opciones dinámicas (fuente de verdad derivada de los datos reales)
// ------------------------------------------------------------

/** Temporadas reales del branding (Object.keys(PALETTES), 21 paletas). */
export const BRANDING_SEASONS: readonly string[] = Object.keys(PALETTES);

/** Modos del branding estacional. */
export const BRANDING_MODES: readonly string[] = ['auto', 'manual', 'disabled'] as const;

/** Idiomas de la interfaz. */
export const UI_LANGUAGES: readonly string[] = ['es', 'en', 'both'] as const;

/** Motores de IA disponibles (aiServiceFactory). */
export const AI_PROVIDERS: readonly string[] = ['openrouter', 'gemini', 'deepseek', 'local'] as const;

/** Estados emocionales válidos (PersonalityConfig.defaultEmotion). */
export const PERSONALITY_EMOTIONS: readonly string[] = [
    'neutral', 'happy', 'curious', 'thoughtful', 'surprised', 'sad', 'excited',
] as const;

/** Perfiles disponibles (ids reales de FLU_PROFILES). */
export const FLU_PROFILE_IDS: readonly string[] = FLU_PROFILES.map((p) => p.id);

// ------------------------------------------------------------
// Catálogo de claves
// ------------------------------------------------------------

export const VOICE_CONFIG_CATALOG: ConfigCatalogEntry[] = [
    // ============================================================
    // BRANDING (set_branding) — useSeasonalBranding
    // ============================================================
    {
        clave: 'activeSeason',
        accion: 'set_branding',
        handler: 'brandingActiveSeason',
        tipo: 'select',
        opciones: BRANDING_SEASONS,
        descripcionEs: 'Cambia la temporada/tema visual (paleta de colores).',
        descripcionEn: 'Changes the visual season/theme (color palette).',
    },
    {
        clave: 'mode',
        accion: 'set_branding',
        handler: 'brandingMode',
        tipo: 'select',
        opciones: BRANDING_MODES,
        descripcionEs: 'Modo del branding: auto (por fechas), manual (fijado por voz) o disabled.',
        descripcionEn: 'Branding mode: auto (by date), manual (voice-set) or disabled.',
    },
    {
        clave: 'birthday',
        accion: 'set_branding',
        handler: 'brandingBirthday',
        tipo: 'date',
        descripcionEs: 'Fecha de cumpleaños en formato AAAA-MM-DD (para celebrar).',
        descripcionEn: 'Birthday date in YYYY-MM-DD format (used to celebrate).',
    },
    {
        clave: 'celebrateAchievements',
        accion: 'set_branding',
        handler: 'brandingCelebrateAchievements',
        tipo: 'boolean',
        descripcionEs: 'Activa o desactiva las celebraciones visuales por logros.',
        descripcionEn: 'Enables or disables visual celebrations for achievements.',
    },
    {
        clave: 'customEvent',
        accion: 'set_branding',
        handler: 'brandingCustomEvent',
        tipo: 'custom',
        requiereSubvalor: true,
        descripcionEs: 'Añade o quita una festividad personalizada. Valor: "nombre|MM-DD|paleta" (ej. "Día de mamá|05-10|cumpleanos"). Subvalor: "add" o "remove".',
        descripcionEn: 'Adds or removes a custom festivity. Valor: "name|MM-DD|palette" (e.g. "Mom Day|05-10|cumpleanos"). Subvalor: "add" or "remove".',
    },

    // ============================================================
    // TEXTO / Gemini (set_config) — useConfigPersistence
    // ============================================================
    {
        clave: 'textApiKey',
        accion: 'set_config',
        handler: 'textApiKey',
        tipo: 'password',
        descripcionEs: 'Clave API del motor de texto (Gemini/OpenRouter).',
        descripcionEn: 'API key of the text engine (Gemini/OpenRouter).',
    },
    {
        clave: 'textModel',
        accion: 'set_config',
        handler: 'textModel',
        tipo: 'text',
        descripcionEs: 'Modelo de texto (ej. gemini-2.5-flash-lite).',
        descripcionEn: 'Text model (e.g. gemini-2.5-flash-lite).',
    },
    {
        clave: 'textApiUrl',
        accion: 'set_config',
        handler: 'textApiUrl',
        tipo: 'text',
        descripcionEs: 'URL del endpoint de texto.',
        descripcionEn: 'URL of the text endpoint.',
    },

    // ============================================================
    // IMAGEN / Pollinations (set_config) — useConfigPersistence
    // ============================================================
    {
        clave: 'imageApiKey',
        accion: 'set_config',
        handler: 'imageApiKey',
        tipo: 'password',
        descripcionEs: 'Clave API del motor de imágenes.',
        descripcionEn: 'API key of the image engine.',
    },
    {
        clave: 'imageModel',
        accion: 'set_config',
        handler: 'imageModel',
        tipo: 'text',
        descripcionEs: 'Modelo de imágenes.',
        descripcionEn: 'Image model.',
    },
    {
        clave: 'imageApiUrl',
        accion: 'set_config',
        handler: 'imageApiUrl',
        tipo: 'text',
        descripcionEs: 'URL del endpoint de imágenes.',
        descripcionEn: 'URL of the image endpoint.',
    },

    // ============================================================
    // GENERAL (set_config)
    // ============================================================
    {
        clave: 'language',
        accion: 'set_config',
        handler: 'language',
        tipo: 'select',
        opciones: UI_LANGUAGES,
        descripcionEs: 'Idioma por defecto de la interfaz. FLU habla cualquier idioma que le pidas.',
        descripcionEn: 'Default UI language. FLU can speak any language you ask.',
    },
    {
        clave: 'sessionRole',
        accion: 'set_config',
        handler: 'sessionRole',
        tipo: 'text',
        descripcionEs: 'Rol de la sesión (texto libre).',
        descripcionEn: 'Session role (free text).',
    },

    // ============================================================
    // VOZ (set_config → setVoiceConfig)
    // ============================================================
    {
        clave: 'voiceSpeed',
        accion: 'set_config',
        handler: 'voiceSpeed',
        tipo: 'number',
        min: 0.1,
        max: 10.0,
        descripcionEs: 'Velocidad del TTS (se acepta 0.1-10.0; se acota al rango seguro 0.5-2.0).',
        descripcionEn: 'TTS speed (accepts 0.1-10.0; clamps to the safe 0.5-2.0 range).',
    },
    {
        clave: 'voice',
        accion: 'set_config',
        handler: 'voice',
        tipo: 'voice',
        descripcionEs: 'Selecciona una voz TTS instalada por su nombre o URI.',
        descripcionEn: 'Selects an installed TTS voice by name or URI.',
    },
    {
        clave: 'pitch',
        accion: 'set_config',
        handler: 'voiceNumber',
        tipo: 'number',
        min: 0.5,
        max: 2.0,
        step: 0.1,
        descripcionEs: 'Tono del TTS (0.5-2.0).',
        descripcionEn: 'TTS pitch (0.5-2.0).',
    },
    {
        clave: 'volume',
        accion: 'set_config',
        handler: 'voiceNumber',
        tipo: 'number',
        min: 0,
        max: 1,
        step: 0.1,
        descripcionEs: 'Volumen del TTS (0.0-1.0).',
        descripcionEn: 'TTS volume (0.0-1.0).',
    },

    // ============================================================
    // PERSONALIDAD (set_config → setPersonality)
    // ============================================================
    {
        clave: 'traits',
        accion: 'set_config',
        handler: 'personalityTraits',
        tipo: 'list',
        opciones: AVAILABLE_TRAITS,
        requiereSubvalor: true,
        descripcionEs: 'Añade o quita un rasgo de personalidad. Usa subvalor "add" o "remove".',
        descripcionEn: 'Adds or removes a personality trait. Use subvalor "add" or "remove".',
    },
    {
        clave: 'tone',
        accion: 'set_config',
        handler: 'personalitySelect',
        tipo: 'select',
        opciones: AVAILABLE_TONES,
        descripcionEs: 'Tono de comunicación de FLU.',
        descripcionEn: 'FLU communication tone.',
    },
    {
        clave: 'customInstructions',
        accion: 'set_config',
        handler: 'personalityText',
        tipo: 'text',
        descripcionEs: 'Instrucciones personalizadas de texto libre para el system prompt.',
        descripcionEn: 'Free-text custom instructions injected into the system prompt.',
    },
    {
        clave: 'proactivity',
        accion: 'set_config',
        handler: 'personalityNumber',
        tipo: 'number',
        min: 0,
        max: 1,
        step: 0.1,
        descripcionEs: 'Nivel de proactividad de FLU (0-1).',
        descripcionEn: 'FLU proactivity level (0-1).',
    },
    {
        clave: 'defaultEmotion',
        accion: 'set_config',
        handler: 'personalitySelect',
        tipo: 'select',
        opciones: PERSONALITY_EMOTIONS,
        descripcionEs: 'Emoción por defecto de FLU.',
        descripcionEn: 'FLU default emotion.',
    },

    // ============================================================
    // AVANZADO (set_config → setAdvancedConfig)
    // ============================================================
    {
        clave: 'animationSpeed',
        accion: 'set_config',
        handler: 'advancedNumber',
        tipo: 'number',
        min: 0.5,
        max: 2.0,
        step: 0.1,
        descripcionEs: 'Velocidad de animación del avatar (0.5-2.0).',
        descripcionEn: 'Avatar animation speed (0.5-2.0).',
    },
    {
        clave: 'emotionalReactivity',
        accion: 'set_config',
        handler: 'advancedNumber',
        tipo: 'number',
        min: 0,
        max: 1,
        step: 0.1,
        descripcionEs: 'Reactividad emocional del avatar (0-1).',
        descripcionEn: 'Avatar emotional reactivity (0-1).',
    },
    {
        clave: 'creativity',
        accion: 'set_config',
        handler: 'advancedNumber',
        tipo: 'number',
        min: 0,
        max: 1,
        step: 0.1,
        descripcionEs: 'Creatividad de la IA (temperature) (0-1).',
        descripcionEn: 'AI creativity (temperature) (0-1).',
    },
    {
        clave: 'emotionMinConfidence',
        accion: 'set_config',
        handler: 'advancedNumber',
        tipo: 'number',
        min: 0,
        max: 1,
        step: 0.05,
        descripcionEs: 'Confianza mínima para reportar una emoción del usuario (0-1).',
        descripcionEn: 'Minimum confidence to report a user emotion (0-1).',
    },
    {
        clave: 'emotionBaseDetectionConfidence',
        accion: 'set_config',
        handler: 'advancedNumber',
        tipo: 'number',
        min: 0,
        max: 1,
        step: 0.05,
        descripcionEs: 'Confianza base para detección de elogios/críticas (0-1).',
        descripcionEn: 'Base confidence for praise/criticism detection (0-1).',
    },
    {
        clave: 'emotionTopicChangeOverlapRatio',
        accion: 'set_config',
        handler: 'advancedNumber',
        tipo: 'number',
        min: 0,
        max: 0.5,
        step: 0.01,
        descripcionEs: 'Umbral de solapamiento de palabras para detectar cambio de tema (0-0.5).',
        descripcionEn: 'Word overlap threshold to detect a topic change (0-0.5).',
    },
    {
        clave: 'emotionTopicChangeMinWords',
        accion: 'set_config',
        handler: 'advancedNumber',
        tipo: 'number',
        min: 1,
        max: 10,
        step: 1,
        descripcionEs: 'Palabras mínimas para considerar un cambio de tema (1-10).',
        descripcionEn: 'Minimum words to consider a topic change (1-10).',
    },
    {
        clave: 'emotionShortUtteranceWordCount',
        accion: 'set_config',
        handler: 'advancedNumber',
        tipo: 'number',
        min: 1,
        max: 10,
        step: 1,
        descripcionEs: 'Umbral de palabras de una frase corta (1-10).',
        descripcionEn: 'Short-utterance word count threshold (1-10).',
    },
    {
        clave: 'tomMaxParticipants',
        accion: 'set_config',
        handler: 'advancedNumber',
        tipo: 'number',
        min: 2,
        max: 50,
        step: 1,
        descripcionEs: 'Máximo de participantes que FLU rastrea a la vez (2-50).',
        descripcionEn: 'Max participants FLU tracks at once (2-50).',
    },
    {
        clave: 'tomMaxTopicsPerParticipant',
        accion: 'set_config',
        handler: 'advancedNumber',
        tipo: 'number',
        min: 5,
        max: 100,
        step: 1,
        descripcionEs: 'Máximo de temas recordados por participante (5-100).',
        descripcionEn: 'Max topics remembered per participant (5-100).',
    },
    {
        clave: 'tomParticipantInactivityMs',
        accion: 'set_config',
        handler: 'advancedNumber',
        tipo: 'number',
        min: 1,
        max: 120,
        step: 1,
        inputUnit: 'minutes',
        descripcionEs: 'Minutos sin interactuar para considerar a un participante inactivo (1-120).',
        descripcionEn: 'Minutes without interaction before a participant is "inactive" (1-120).',
    },
    {
        clave: 'tomSummaryDisplayLimit',
        accion: 'set_config',
        handler: 'advancedNumber',
        tipo: 'number',
        min: 1,
        max: 10,
        step: 1,
        descripcionEs: 'Máximo de ítems del resumen por categoría (1-10).',
        descripcionEn: 'Max summary items per category (1-10).',
    },
    {
        clave: 'systemEventWindowMs',
        accion: 'set_config',
        handler: 'advancedNumber',
        tipo: 'number',
        min: 1,
        max: 30,
        step: 1,
        inputUnit: 'minutes',
        descripcionEs: 'Ventana en minutos de eventos que se pasan a Gemini (1-30).',
        descripcionEn: 'Event window in minutes passed to Gemini (1-30).',
    },
    {
        clave: 'systemEventDedupBucketMs',
        accion: 'set_config',
        handler: 'advancedNumber',
        tipo: 'number',
        min: 1,
        max: 30,
        step: 1,
        inputUnit: 'seconds',
        descripcionEs: 'Ventana en segundos para deduplicar eventos (1-30).',
        descripcionEn: 'Dedup bucket in seconds for events (1-30).',
    },

    // ============================================================
    // IMAGEN DEL AVATAR (set_config → setImageConfig)
    // ============================================================
    {
        clave: 'capVisible',
        accion: 'set_config',
        handler: 'imageBoolean',
        tipo: 'boolean',
        descripcionEs: 'Muestra u oculta la gorra del avatar.',
        descripcionEn: 'Shows or hides the avatar cap.',
    },
    {
        clave: 'hairVisible',
        accion: 'set_config',
        handler: 'imageBoolean',
        tipo: 'boolean',
        descripcionEs: 'Muestra u oculta el cabello del avatar.',
        descripcionEn: 'Shows or hides the avatar hair.',
    },

    // ============================================================
    // COLORES DEL AVATAR (set_config → BunnyStore)
    // ============================================================
    {
        clave: 'avatarColor',
        accion: 'set_config',
        handler: 'avatarColor',
        tipo: 'color',
        descripcionEs: 'Color de un componente del avatar: formato "componente:color" (ej. "Bunny_pants:#8B4513").',
        descripcionEn: 'Avatar component color: format "component:color" (e.g. "Bunny_pants:#8B4513").',
    },
    {
        clave: 'pantsColor',
        accion: 'set_config',
        handler: 'avatarComponentColor',
        tipo: 'color',
        descripcionEs: 'Color del pantalón (código hexadecimal).',
        descripcionEn: 'Pants color (hex code).',
    },
    {
        clave: 'bodyColor',
        accion: 'set_config',
        handler: 'avatarComponentColor',
        tipo: 'color',
        descripcionEs: 'Color del cuerpo (código hexadecimal).',
        descripcionEn: 'Body color (hex code).',
    },
    {
        clave: 'faceColor',
        accion: 'set_config',
        handler: 'avatarComponentColor',
        tipo: 'color',
        descripcionEs: 'Color de la cara (código hexadecimal).',
        descripcionEn: 'Face color (hex code).',
    },
    {
        clave: 'resetAvatarColors',
        accion: 'set_config',
        handler: 'resetAvatarColors',
        tipo: 'action',
        descripcionEs: 'Restablece los colores del avatar a sus valores por defecto.',
        descripcionEn: 'Resets the avatar colors to their defaults.',
    },

    // ============================================================
    // MOTOR IA / PERFIL (set_config)
    // ============================================================
    {
        clave: 'aiProvider',
        accion: 'set_config',
        handler: 'aiProvider',
        tipo: 'select',
        opciones: AI_PROVIDERS,
        descripcionEs: 'Motor de IA preferido (openrouter, gemini, deepseek, local).',
        descripcionEn: 'Preferred AI provider (openrouter, gemini, deepseek, local).',
    },
    {
        clave: 'profile',
        accion: 'set_config',
        handler: 'applyProfile',
        tipo: 'select',
        opciones: FLU_PROFILE_IDS,
        descripcionEs: 'Aplica un perfil completo de FLU (personalidad + imagen + voz + avanzado).',
        descripcionEn: 'Applies a full FLU profile (personality + image + voice + advanced).',
    },

    // ============================================================
    // SOPORTADO por voz (set_config → useConfigPersistence)
    // ============================================================
    {
        clave: 'wakeWords',
        accion: 'set_config',
        handler: 'wakeWords',
        tipo: 'text',
        requiereSubvalor: true,
        descripcionEs: 'Añade o quita palabras de activación. Usa subvalor "add" o "remove".',
        descripcionEn: 'Adds or removes wake words. Use subvalor "add" or "remove".',
    },
    {
        clave: 'clearCache',
        accion: 'set_config',
        handler: 'clearCache',
        tipo: 'action',
        descripcionEs: 'Limpia la caché y recarga la aplicación.',
        descripcionEn: 'Clears the cache and reloads the app.',
    },
    {
        clave: 'debugLogs',
        accion: 'set_config',
        handler: 'debugLogs',
        tipo: 'boolean',
        descripcionEs: 'Habilita o deshabilita los logs de depuración.',
        descripcionEn: 'Enables or disables debug logs.',
    },
    // ============================================================
    // NO SOPORTADO por voz (documentado; sin acción)
    // ============================================================
    // ============================================================
    // OCR (local Tesseract por defecto + endpoint remoto opcional)
    // ============================================================
    {
        clave: 'ocrApiKey',
        accion: 'set_config',
        handler: 'ocrApiKey',
        tipo: 'password',
        descripcionEs: 'Clave de API opcional para OCR remoto. Vacío = OCR local (Tesseract).',
        descripcionEn: 'Optional API key for remote OCR. Empty = local OCR (Tesseract).',
    },
    {
        clave: 'ocrModel',
        accion: 'set_config',
        handler: 'ocrModel',
        tipo: 'text',
        descripcionEs: 'Modelo opcional para OCR remoto. Vacío = OCR local (Tesseract).',
        descripcionEn: 'Optional model for remote OCR. Empty = local OCR (Tesseract).',
    },
    {
        clave: 'ocrApiUrl',
        accion: 'set_config',
        handler: 'ocrApiUrl',
        tipo: 'text',
        descripcionEs: 'URL del endpoint de OCR remoto opcional. Vacío = OCR local (Tesseract).',
        descripcionEn: 'Optional remote OCR endpoint URL. Empty = local OCR (Tesseract).',
    },
    // ============================================================
    // NO SOPORTADO por voz (documentado; sin acción)
    // ============================================================
    {
        clave: 'memoryCurve',
        accion: 'set_config',
        handler: 'unsupported',
        tipo: 'select',
        motivoNoSoportado: 'Curva de memoria sin control en el módulo de configuración.',
        descripcionEs: 'Curva de memoria no expuesta en el módulo.',
        descripcionEn: 'Memory curve not exposed in the config module.',
    },
    {
        clave: 'memoryTamaño',
        accion: 'set_config',
        handler: 'unsupported',
        tipo: 'number',
        motivoNoSoportado: 'Tamaño de memoria sin control en el módulo de configuración.',
        descripcionEs: 'Tamaño de memoria no expuesto en el módulo.',
        descripcionEn: 'Memory size not exposed in the config module.',
    },
];

// ------------------------------------------------------------
// Helpers de formato para el prompt
// ------------------------------------------------------------

function formatValueEs(entry: ConfigCatalogEntry): string {
    switch (entry.tipo) {
        case 'select':
        case 'list':
            return ` (${(entry.opciones ?? []).join(', ')})${entry.requiereSubvalor ? '; usa subvalor "add" o "remove"' : ''}`;
        case 'number': {
            const unit =
                entry.inputUnit === 'minutes'
                    ? ' minutos'
                    : entry.inputUnit === 'seconds'
                        ? ' segundos'
                        : '';
            return ` (${entry.min}-${entry.max}${unit})`;
        }
        case 'boolean':
            return ' (true/false)';
        case 'text':
            return entry.requiereSubvalor ? ' (texto; usa subvalor "add" o "remove")' : ' (string)';
        case 'password':
            return ' (string)';
        case 'voice':
            return ' (nombre o URI de una voz TTS instalada)';
        case 'color':
            return entry.clave === 'avatarColor'
                ? ' (formato: "componente:color", ej. "Bunny_pants:#8B4513")'
                : ' (código hexadecimal, ej. "#FF5733")';
        case 'date':
            return ' (AAAA-MM-DD)';
        case 'custom':
            return ' (formato "nombre|MM-DD|paleta", ej. "Día de mamá|05-10|cumpleanos"); usa subvalor "add" o "remove"';
        case 'action':
            return '';
        default:
            return ' (string)';
    }
}

function formatValueEn(entry: ConfigCatalogEntry): string {
    switch (entry.tipo) {
        case 'select':
        case 'list':
            return ` (${(entry.opciones ?? []).join(', ')})${entry.requiereSubvalor ? '; use subvalor "add" or "remove"' : ''}`;
        case 'number': {
            const unit =
                entry.inputUnit === 'minutes'
                    ? ' minutes'
                    : entry.inputUnit === 'seconds'
                        ? ' seconds'
                        : '';
            return ` (${entry.min}-${entry.max}${unit})`;
        }
        case 'boolean':
            return ' (true/false)';
        case 'text':
            return entry.requiereSubvalor ? ' (text; use subvalor "add" or "remove")' : ' (string)';
        case 'password':
            return ' (string)';
        case 'voice':
            return ' (name or URI of an installed TTS voice)';
        case 'color':
            return entry.clave === 'avatarColor'
                ? ' (format: "component:color", e.g. "Bunny_pants:#8B4513")'
                : ' (hex code, e.g. "#FF5733")';
        case 'date':
            return ' (YYYY-MM-DD)';
        case 'custom':
            return ' (format "name|MM-DD|palette", e.g. "Mom Day|05-10|cumpleanos"); use subvalor "add" or "remove"';
        case 'action':
            return '';
        default:
            return ' (string)';
    }
}

// ------------------------------------------------------------
// Generador del prompt de configuración (reemplaza el hardcode de gemini.js)
// ------------------------------------------------------------

/**
 * Construye el bloque de instrucciones `configuracion` para el system prompt,
 * a partir del catálogo (single source of truth). Cero hardcode: temporadas,
 * rasgos, tonos, modos, idiomas, proveedores y perfiles se derivan de los datos.
 */
export function buildConfiguracionPrompt(language: 'es' | 'en' = 'es'): string {
    const isEnglish = language === 'en';
    const brandingEntries = VOICE_CONFIG_CATALOG.filter(
        (e) => e.accion === 'set_branding' && e.handler !== 'unsupported',
    );
    const configEntries = VOICE_CONFIG_CATALOG.filter(
        (e) => e.accion === 'set_config' && e.handler !== 'unsupported',
    );
    const unsupportedEntries = VOICE_CONFIG_CATALOG.filter((e) => e.handler === 'unsupported');

    const brandingLine = `${isEnglish ? 'For set_branding: clave can be' : 'Para set_branding: clave puede ser'} ${brandingEntries
        .map((e) => `"${e.clave}"${isEnglish ? formatValueEn(e) : formatValueEs(e)}`)
        .join(', ')}.`;

    const configLine = `${isEnglish ? 'For set_config: clave can be' : 'Para set_config: clave puede ser'} ${configEntries
        .map((e) => `"${e.clave}"${isEnglish ? formatValueEn(e) : formatValueEs(e)}`)
        .join(', ')}.`;

    const unsupportedLine = `${isEnglish
        ? 'NOT available via configuracion (do NOT emit these claves)'
        : 'NO disponibles via configuracion (no emitas estas claves)'}: ${unsupportedEntries
        .map((e) => `"${e.clave}"`)
        .join(', ')}.`;

    return [
        isEnglish
            ? 'You can also use the "configuracion" field when the user explicitly asks to change settings.'
            : 'Tambien puedes usar el campo "configuracion" cuando el usuario pida explicitamente cambiar ajustes.',
        isEnglish
            ? 'Use configuracion ONLY for explicit configuration commands like: "OK FLU set...", "FLU change...", "set theme to...", "activate...", "configure...".'
            : 'Usa configuracion SOLO para comandos explicitos de configuracion como: "OK FLU configura...", "FLU cambia...", "pon tema de...", "activa...", "configura...".',
        isEnglish
            ? 'Available actions: "set_branding" (change visual theme/season), "set_config" (change any other setting).'
            : 'Acciones disponibles: "set_branding" (cambiar tema visual/temporada), "set_config" (cambiar cualquier otro ajuste).',
        brandingLine,
        configLine,
        unsupportedLine,
        isEnglish
            ? 'IMPORTANT: Do NOT interpret casual aesthetic preferences as configuration commands. Only act when the user gives a direct instruction. If the user mentions memory size, explain it is not available.'
            : 'IMPORTANTE: No interpretes preferencias esteticas casuales como comandos de configuracion. Solo actua cuando el usuario de una instruccion directa. Si el usuario menciona tamano de memoria, explica que no esta disponible.',
    ].join(' ');
}
