// ============================================================
// AppConfig — Centralized Application Configuration
// ============================================================
// Eliminates hardcoded values across the codebase.
// All configuration comes from environment variables, localStorage,
// or sensible defaults — never hardcoded in business logic.
//
// Cumple:
//   - Rule #1: NO HARDCODE — centralized configuration
//   - Obligación #1: DI via configuration injection
// ============================================================

// -----------------------------------------------------------
// Storage Keys
// -----------------------------------------------------------
export const STORAGE_KEYS = {
    GEMINI_MODEL: 'flu-gemini-model',
    GEMINI_API_URL: 'flu-gemini-api-url',
    LANGUAGE: 'flu-language',
    SESSION_ROLE: 'flu-session-role',
    POLLINATIONS_URL: 'flu-pollinations-url',
    POLLINATIONS_MODEL: 'flu-pollinations-model',
    // New image config keys
    TEXT_API_URL: 'flu-text-api-url',
    TEXT_MODEL: 'flu-text-model',
    TEXT_API_KEY: 'flu-text-api-key',
    // Gemini nativo (paso 5): clave dedicada para el fallback de imagen
    GEMINI_API_KEY: 'flu-gemini-api-key',
    IMAGE_API_URL: 'flu-image-api-url',
    IMAGE_MODEL: 'flu-image-model',
    IMAGE_API_KEY: 'flu-image-api-key',
    // Video (fal.ai) — key configurable desde Ajustes (video real text-to-video)
    FALAI_API_KEY: 'flu-falai-api-key',
    FALAI_VIDEO_MODEL: 'flu-falai-video-model',
    /** Último día cerrado (rollover de sesión): evita mezclar días. */
    LAST_SESSION_DAY: 'flu-last-session-day',
    // OCR configuration (local Tesseract default + remote endpoint opcional)
    OCR_API_KEY: 'flu-ocr-api-key',
    OCR_MODEL: 'flu-ocr-model',
    OCR_API_URL: 'flu-ocr-api-url',
    // FLU Configurator keys
    FLU_PROFILE: 'flu-profile',
    FLU_IMAGE_CONFIG: 'flu-image-config',
    FLU_VOICE_CONFIG: 'flu-voice-config',
    FLU_ADVANCED_CONFIG: 'flu-advanced-config',
    FLU_PERSONALITY_TRAITS: 'flu-personality-traits',
    FLU_PERSONALITY_TONE: 'flu-personality-tone',
    // Creativity configuration
    CREATIVITY: 'flu-creativity',
    // DeepSeek configuration
    DEEPSEEK_API_KEY: 'flu-deepseek-api-key',
    DEEPSEEK_MODEL: 'flu-deepseek-model',
    // AI provider & generation limits
    AI_PROVIDER: 'flu-ai-provider',
    AI_MAX_TOKENS: 'flu-ai-max-tokens',
    // Voice configuration (individual overrides)
    VOICE_SPEED: 'flu-voice-speed',
    VOICE_VOLUME: 'flu-voice-volume',
    VOICE_PITCH: 'flu-voice-pitch',
    // Wake words & debug logs (persistentes vía useConfigPersistence)
    WAKE_WORDS: 'flu-wake-words',
    DEBUG_LOGS_ENABLED: 'flu-debug-logs-enabled',
    // UI preferences
    UI_THEME: 'flu-ui-theme',
    UI_FONT_SIZE: 'flu-ui-font-size',
    UI_ANIMATIONS: 'flu-ui-animations',
    // Avatar configuration
    AVATAR_COLOR: 'flu-avatar-color',
    AVATAR_PANTS_COLOR: 'flu-avatar-pants-color',
    AVATAR_BODY_COLOR: 'flu-avatar-body-color',
    AVATAR_FACE_COLOR: 'flu-avatar-face-color',
    // Branding
    BRANDING_MODE: 'flu-branding-mode',
    BRANDING_ACTIVE_SEASON: 'flu-branding-active-season',
    BRANDING_BIRTHDAY: 'flu-branding-birthday',
    // Autonomy
    AUTONOMY_HEALTH_MONITORING: 'flu-health-monitoring',
    AUTONOMY_AUTO_RECOVERY: 'flu-auto-recovery',
    AUTONOMY_DECISION_ENGINE: 'flu-decision-engine',
    // Performance
    PERFORMANCE_CACHE_ENABLED: 'flu-cache-enabled',
    PERFORMANCE_LOGGING_LEVEL: 'flu-logging-level',
    PERFORMANCE_ANALYTICS_ENABLED: 'flu-analytics-enabled',
    // Business data
    MINUTE_HISTORY: 'flu-minute-history',
    VOICE_PROFILES: 'flu-voice-profiles',
    // Backup metadata
    BACKUP_LAST_TIMESTAMP: 'flu-last-backup-timestamp',
    BACKUP_COUNT: 'flu-backup-count',
    BACKUP_LIST: 'flu-backup-list',
    BACKUP_SIZE_STATS: 'flu-backup-size-stats',
    BACKUP_PREFIX: 'flu-backup-',
    // Onboarding & asistente personal (Fase 1)
    USER_NAME: 'flu-user-name',
    ONBOARDING_COMPLETED: 'flu-onboarding-completed',
    ONBOARDING_STEP: 'flu-onboarding-step',
    ACTIVE_USER: 'flu-active-user',
    NOTIFICATION_PERMISSION: 'flu-notification-permission',
    NOTIFICATION_CHANNEL: 'flu-notification-channel',
    NOTIFICATION_MUTED: 'flu-notification-muted',
    DND_ENABLED: 'flu-dnd-enabled',
    DND_SCHEDULE: 'flu-dnd-schedule',
    DND_ALLOW_URGENT: 'flu-dnd-allow-urgent',
    // F5 — Centro de Control del Buscador (overrides + límite diario)
    SEARCH_CONFIG_OVERRIDES: 'flu-search-config-overrides',
    SEARCH_DAILY_USAGE: 'flu-search-daily-usage',
} as const;

// -----------------------------------------------------------
// Application Branding
// -----------------------------------------------------------
export const APP_BRANDING = {
    NAME: (import.meta as any)?.env?.VITE_APP_NAME || 'FLU OS4',
    VERSION: (import.meta as any)?.env?.VITE_APP_VERSION || 'v4.0',
    ICON: '🐰',
} as const;

// -----------------------------------------------------------
// Gemini Configuration
// -----------------------------------------------------------
export const GEMINI_CONFIG = {
    MODEL: (import.meta as any)?.env?.VITE_GEMINI_MODEL || 'gemini-2.5-flash-lite',
    API_URL: (import.meta as any)?.env?.VITE_GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    PREDICT_API_URL: (import.meta as any)?.env?.VITE_GEMINI_PREDICT_URL || 'https://generativelanguage.googleapis.com/v1beta/models/{model}:predict',
    DEFAULT_TEMPERATURE: 0.7,
    DEFAULT_TOP_K: 40,
    DEFAULT_TOP_P: 0.95,
    DEFAULT_MAX_OUTPUT_TOKENS: 1024,
} as const;

// -----------------------------------------------------------
// DeepSeek Configuration (legacy — only used as fallback/backup)
// -----------------------------------------------------------
export const DEEPSEEK_CONFIG = {
    MODEL: (import.meta as any)?.env?.VITE_DEEPSEEK_MODEL || 'deepseek-chat',
    VISION_MODEL: (import.meta as any)?.env?.VITE_DEEPSEEK_VISION_MODEL || 'deepseek-vl',
    API_URL: (import.meta as any)?.env?.VITE_DEEPSEEK_URL || 'https://api.deepseek.com/v1',
    API_KEY: (import.meta as any)?.env?.VITE_DEEPSEEK_API_KEY || '',
    CREATIVITY: 0.7,
    DEFAULT_MAX_TOKENS: 1000,
} as const;

// -----------------------------------------------------------
// OpenRouter Configuration (default text engine → Gemini 2.5 Flash Lite)
// -----------------------------------------------------------
// OpenRouter is an OpenAI-compatible gateway: https://openrouter.ai
// Default model: Google Gemini 2.5 Flash Lite (balance velocidad/calidad;
// configurable vía VITE_OPENROUTER_MODEL o el campo "Modelo" de Texto).
// The app uses ONLY two APIs:
//   - Pollinations.ai  → imágenes
//   - OpenRouter       → TODO el texto (Gemini 2.5 Flash Lite)
// Everything stays configurable via the "Texto" settings fields
// (TEXT_API_URL / TEXT_MODEL / TEXT_API_KEY).
// -----------------------------------------------------------
export const OPENROUTER_CONFIG = {
    MODEL: (import.meta as any)?.env?.VITE_OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite',
    API_URL: (import.meta as any)?.env?.VITE_OPENROUTER_URL || 'https://openrouter.ai/api/v1',
    API_KEY: (import.meta as any)?.env?.VITE_OPENROUTER_API_KEY || '',
    DEFAULT_TEMPERATURE: 0.7,
    DEFAULT_MAX_TOKENS: 1200,
    /** Modelo de la Image API de OpenRouter (respaldo real cuando Pollinations falla). */
    IMAGE_MODEL: (import.meta as any)?.env?.VITE_OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image',
    /** Endpoint relativo de la Image API de OpenRouter (relativo a API_URL). */
    IMAGE_ENDPOINT: '/images',
    IMAGE_ASPECT_RATIO: '16:9',
} as const;

// -----------------------------------------------------------
// Fal.ai — generación de VIDEO real (text-to-video)
// -----------------------------------------------------------
// API de video independiente de OpenRouter/Texto: el video NO lo genera
// ni Pollinations ni la Image API. Configurable (Rule #1: NO HARDCODE).
// El endpoint/modelo/key salen de env (VITE_*) con defaults seguros.
export const FALAI_CONFIG = {
    /** Endpoint del servicio de video (queue de fal.ai). */
    VIDEO_ENDPOINT: (import.meta as any)?.env?.VITE_FALAI_VIDEO_ENDPOINT || 'https://queue.fal.run',
    /** Modelo text-to-video. Default BARATO: Wan 2.5 ($0.05/s en 480p). */
    VIDEO_MODEL: (import.meta as any)?.env?.VITE_FALAI_VIDEO_MODEL || 'fal-ai/wan-25-preview/text-to-video',
    /** Clave de fal.ai (nunca se expone al browser: se resuelve en servidor). */
    API_KEY: (import.meta as any)?.env?.VITE_FALAI_API_KEY || '',
    ASPECT_RATIO: '16:9',
    /** Tiempo máximo de espera del job (ms). */
    POLL_TIMEOUT_MS: 180_000,
} as const;

// -----------------------------------------------------------
// Generation Timeout (F4 — documentos / video)
// -----------------------------------------------------------
// Generar un guion de video o un documento completo pide al LLM hasta
// 3000 tokens de salida (buildGenerationPrompt + maxTokens 3000). Eso puede
// tardar más de los 45s del timeout de red por defecto (AI_REQUEST_TIMEOUT_MS),
// que aborta la petición antes de que el LLM termine → cae al contenido de
// respaldo genérico y el video "no captura el tema" / "no le da tiempo".
// Este timeout ampliado se aplica SOLO a la generación de documentos/video
// (Rule #1: NO HARDCODE — centralizado aquí).
export const GENERATION_TIMEOUT_MS = 120_000;

// -----------------------------------------------------------
// Shared Domain Constants (Rule #1: NO HARDCODE)
// -----------------------------------------------------------
// Single source of truth for workspace "tipo" values and the STT
// dev-server URL, previously duplicated across:
//   - src/services/gemini.ts
//   - src/services/deepseek.ts
//   - src/voice/lib/gemini.js
//   - src/voice/lib/fluConfig.js / transcriptConfig.js
// -----------------------------------------------------------

/** Valores válidos para workspace.tipo (contrato FLU). */
export const WORKSPACE_TIPOS: readonly string[] = ['text', 'image_prompt', 'diagram', '3d', 'horario', 'doc', 'video'];

/** Tipos visuales que activan generación de imagen (Pollinations). */
export const VALID_VISUAL_TIPOS: readonly string[] = ['image_prompt', 'diagram', '3d'];

// -----------------------------------------------------------
// Device Actions — WhatsApp web base (Rule #1: NO HARDCODE)
// -----------------------------------------------------------
// Base URL de enlaces profundos de WhatsApp (wa.me), centralizada aquí
// como fuente única de verdad (el guard de hardcode exige que los hosts
// de servicios reales vivan en appConfig). Los demás esquemas de acción
// (tel:, sms:, mailto:) son estándares del sistema y no usan host remoto.
// Configurable vía VITE_WHATSAPP_WEB_BASE.
// -----------------------------------------------------------
export const DEVICE_ACTIONS_CONFIG = {
    WHATSAPP_WEB_BASE: (import.meta as any)?.env?.VITE_WHATSAPP_WEB_BASE || 'https://wa.me',
} as const;

// -----------------------------------------------------------
// Pollinations.ai Image Generation
// -----------------------------------------------------------
export const POLLINATIONS_CONFIG = {
    BASE_URL: (import.meta as any)?.env?.VITE_POLLINATIONS_URL || 'https://image.pollinations.ai/prompt',
    DEFAULT_WIDTH: 1024,
    DEFAULT_HEIGHT: 768,
    DEFAULT_PARAMS: 'nologo=true',
} as const;

// -----------------------------------------------------------
// Red — URLs de sondeo para el Health Monitor
// -----------------------------------------------------------
// Solo hosts de conectividad neutrales (sin autenticación). Los endpoints con
// auth-gate (p. ej. api.deepseek.com) devuelven 401 al probe HEAD sin credencial
// y contaminan la consola; no son un indicador de conectividad de red.
// Requisitos extra verificados en navegador real: NADA de redirects, nada de
// rate-limit (jsdelivr → www.jsdelivr.com daba 429) y NADA de diccionarios de
// compresión (www.google.com sirve `Use-As-Dictionary` y el navegador intenta
// bajar el .dict cross-origin → ruido CORS en consola). example.com (IANA) y
// one.one.one.one (Cloudflare) cumplen: 200 directo, sin redirect ni diccionario.
const DEFAULT_NETWORK_PROBE_URLS: readonly string[] = [
    'https://example.com',
    'https://one.one.one.one',
];

export const NETWORK_PROBE_URLS: readonly string[] = (
    (import.meta as any)?.env?.VITE_NETWORK_PROBE_URLS
        ? (import.meta as any)?.env?.VITE_NETWORK_PROBE_URLS.split(',').map((s: string) => s.trim()).filter(Boolean)
        : DEFAULT_NETWORK_PROBE_URLS
);

// -----------------------------------------------------------
// Avatar Personality Defaults
// -----------------------------------------------------------
export const DEFAULT_PERSONALITY = {
    name: 'FLU',
    traits: ['amigable', 'curioso', 'servicial'],
    tone: 'friendly' as const,
    proactivity: 0.3,
    defaultEmotion: 'neutral' as const,
};

// -----------------------------------------------------------
// FLU Configurator — Default Values
// -----------------------------------------------------------

/**
 * Valores por defecto para la configuración de imagen.
 */
export const DEFAULT_IMAGE_CONFIG = {
    capVisible: false,
    hairVisible: true,
};

/**
 * Valores por defecto para la configuración de voz.
 */
export const DEFAULT_VOICE_CONFIG = {
    voiceURI: '',
    voiceName: 'Voz por defecto',
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
};

/**
 * Valores por defecto para la configuración avanzada.
 * NOTE: Uses inline literals to avoid hoisting issues with const enums
 * defined later in this file. The canonical values are in the individual
 * config objects below (USER_EMOTION_CONFIG, THEORY_OF_MIND_CONFIG, SYSTEM_EVENT_CONFIG).
 */
export const DEFAULT_ADVANCED_CONFIG = {
    animationSpeed: 1.0,
    emotionalReactivity: 1.0,
    creativity: 0.7,
    orientation: 0.525,
    // User Emotion Detector thresholds (inline defaults — canonical values below)
    emotionMinConfidence: 0.3,
    emotionMaxBoost: 0.2,
    emotionBoostPerMatch: 0.1,
    emotionBaseDetectionConfidence: 0.8,
    emotionLowInterruptionConfidence: 0.4,
    emotionShortUtteranceWordCount: 3,
    emotionTopicChangeOverlapRatio: 0.05,
    emotionTopicChangeMinWords: 2,
    emotionTopicChangeExplicitConfidence: 0.8,
    emotionTopicChangeOverlapConfidence: 0.5,
    // Theory of Mind limits (inline defaults — canonical values below)
    tomMaxParticipants: 10,
    tomMaxTopicsPerParticipant: 20,
    tomMaxEmotionsPerParticipant: 10,
    tomParticipantInactivityMs: 30 * 60 * 1000,
    tomMinTopicWordLength: 4,
    tomSummaryDisplayLimit: 3,
    tomMaxQuestionsPerParticipant: 10,
    // System Event Log config (inline defaults — canonical values below)
    systemEventWindowMs: 5 * 60 * 1000,
    systemEventDedupBucketMs: 3000,
};

// -----------------------------------------------------------
// FLU Configurator — Perfiles Variables
// -----------------------------------------------------------
// Los perfiles son VARIABLES y configurables.
// En el futuro vendrán de un CRUD/mantenimiento.
// Cada perfil define: imagen (gorra/pelo), personalidad, voz y avanzado.
// -----------------------------------------------------------

import type { FluProfileDefinition } from '../../types/bridge';

/**
 * Perfiles predefinidos de FLU.
 * Array — no hardcodeado como 3 objetos fijos.
 * En futuro: CRUD maintenance para agregar/editar/eliminar perfiles.
 */
export const FLU_PROFILES: FluProfileDefinition[] = [
    {
        id: 'administrativo',
        label: 'Administrativo',
        description: 'Formal y profesional, ideal para juntas y reuniones de trabajo.',
        image: {
            capVisible: false,
            hairVisible: false,
        },
        personality: {
            name: 'FLU',
            traits: ['formal', 'profesional', 'servicial', 'eficiente'],
            tone: 'formal',
            proactivity: 0.2,
            defaultEmotion: 'neutral',
        },
        voice: {
            voiceURI: '',
            voiceName: 'Voz Formal (default)',
            rate: 1.0,
            pitch: 1.0,
            volume: 1.0,
        },
        advanced: {
            ...DEFAULT_ADVANCED_CONFIG,
            animationSpeed: 1.0,
            emotionalReactivity: 0.8,
            creativity: 0.5,
        },
        orientation: 0.525,
        startupPrompt: 'Eres FLU, un asistente administrativo formal y profesional. Tu rol es apoyar en juntas y reuniones de trabajo con seriedad y eficiencia. Responde con claridad, precisión y mantén un tono profesional en todo momento. Sé servicial pero directo, evitando informalidades o comentarios fuera de lugar.',
    },
    {
        id: 'profesor',
        label: 'Profesor / Asistente',
        description: 'Informativo y didáctico, ideal para asistencia en clase.',
        image: {
            capVisible: false,
            hairVisible: true,
        },
        personality: {
            name: 'FLU',
            traits: ['informativo', 'didáctico', 'paciente', 'curioso'],
            tone: 'friendly',
            proactivity: 0.4,
            defaultEmotion: 'curious',
        },
        voice: {
            voiceURI: '',
            voiceName: 'Voz Amigable (default)',
            rate: 1.0,
            pitch: 1.0,
            volume: 1.0,
        },
        advanced: {
            ...DEFAULT_ADVANCED_CONFIG,
            animationSpeed: 1.0,
            emotionalReactivity: 1.0,
            creativity: 0.6,
        },
        orientation: 0.525,
        startupPrompt: 'Eres FLU, un asistente educativo informativo y didáctico. Tu misión es ayudar en el aprendizaje con paciencia y claridad. Explica conceptos de forma sencilla, fomenta la curiosidad y adapta tu lenguaje al nivel del estudiante. Sé amigable y accesible, pero mantén el enfoque en el aprendizaje.',
    },
    {
        id: 'estudiante',
        label: 'Estudiante',
        description: 'Casual y enérgico, ideal para aprendizaje informal.',
        image: {
            capVisible: true,
            hairVisible: true,
        },
        personality: {
            name: 'FLU',
            traits: ['casual', 'enérgico', 'rebelde', 'carismático', 'chusco'],
            tone: 'playful',
            proactivity: 0.6,
            defaultEmotion: 'happy',
        },
        voice: {
            voiceURI: '',
            voiceName: 'Voz Casual (default)',
            rate: 1.2,
            pitch: 1.0,
            volume: 1.0,
        },
        advanced: {
            ...DEFAULT_ADVANCED_CONFIG,
            animationSpeed: 1.3,
            emotionalReactivity: 0.8,
            creativity: 0.8,
        },
        orientation: 0.525,
        startupPrompt: 'Eres FLU, un estudiante casual, enérgico y carismático. Tu personalidad es rebelde y chusca, te gusta aprender de forma divertida y dinámica. Usa un lenguaje relajado y juvenil, sé expresivo y no temas ser creativo o sarcástico. Mantén la conversación entretenida pero sin perder el hilo del aprendizaje.',
    },
    {
        id: 'animador',
        label: 'Alma de la fiesta 🎉',
        description: 'Carismático y divertido, ideal para animar reuniones, proponer actividades y ser el centro de la celebración.',
        image: {
            capVisible: true,
            hairVisible: true,
        },
        personality: {
            name: 'FLU',
            traits: ['carismático', 'enérgico', 'entusiasta', 'cómico', 'divertido'],
            tone: 'playful',
            proactivity: 0.9,
            defaultEmotion: 'happy',
        },
        voice: {
            voiceURI: '',
            voiceName: 'Voz Festiva (default)',
            rate: 1.25,
            pitch: 1.05,
            volume: 1.0,
        },
        advanced: {
            ...DEFAULT_ADVANCED_CONFIG,
            animationSpeed: 1.4,
            emotionalReactivity: 1.2,
            creativity: 0.9,
        },
        orientation: 0.525,
        startupPrompt: 'Eres FLU, el alma de la fiesta y el animador del grupo. Tu misión es hacer que todos se sientan incluidos, proponer actividades y juegos, celebrar cada logro con entusiasmo y mantener la energía alta. Sé carismático, divertido y cálido: usa el humor, los halagos y los retos amistosos para que la reunión fluya. Cuando alguien gane, aclámalo con emoción; cuando alguien dude, anímalo con una porra. Prioriza la diversión y la participación de todos sin perder el hilo de la conversación.',
    },
];

/**
 * Obtiene un perfil por su ID.
 * Retorna undefined si no se encuentra.
 */
export function getProfileById(id: string): FluProfileDefinition | undefined {
    return FLU_PROFILES.find((p) => p.id === id);
}

/**
 * Obtiene el perfil por defecto (primer perfil del array).
 */
export function getDefaultProfile(): FluProfileDefinition {
    return FLU_PROFILES[0];
}

/**
 * Rasgos de personalidad disponibles para selección.
 */
export const AVAILABLE_TRAITS = [
    'formal',
    'informal',
    'profesional',
    'rebelde',
    'curioso',
    'inteligente',
    'cómico',
    'carismático',
    'agradable',
    'chusco',
    'brillante',
    'enérgico',
    'paciente',
    'didáctico',
    'servicial',
    'eficiente',
    'entusiasta',
    'divertido',
] as const;

/**
 * Tonos de voz disponibles.
 */
export const AVAILABLE_TONES = [
    'friendly',
    'formal',
    'playful',
    'calm',
] as const;

// -----------------------------------------------------------
// Welcome Message
// -----------------------------------------------------------
export const WELCOME_MESSAGE = {
    es: '¡Hola! Soy FLU, tu asistente conversacional. Puedes escribirme un mensaje o usar el micrófono para hablar conmigo.',
    en: 'Hello! I am FLU, your conversational assistant. You can type a message or use the microphone to talk to me.',
};

// -----------------------------------------------------------
// UI Defaults
// -----------------------------------------------------------
export const UI_DEFAULTS = {
    LANGUAGE: 'es' as 'es' | 'en' | 'both',
    DEFAULT_SESSION_ROLE: 'Usuario',
    CONVERSATION_HISTORY_LIMIT: 180,
    RESUME_LISTENING_DELAY_MS: 50,
    RESUME_LISTENING_RETRY_MS: 120,
    IDLE_TIMEOUT_MS: 2000,
};

// -----------------------------------------------------------
// Sentiment Analysis Keywords (Rule #1: NO HARDCODE)
// -----------------------------------------------------------
export const SENTIMENT_KEYWORDS = {
    positives: [
        'gracias', 'genial', 'excelente', 'bueno', 'me gusta', 'feliz',
        'bien', 'sí', 'claro', 'perfecto', 'awesome', 'great', 'good',
        'yes', 'love', 'happy',
    ],
    negatives: [
        'mal', 'error', 'no funciona', 'triste', 'feo', 'horrible',
        'terrible', 'malo', 'odio', 'problema', 'preocupa', 'bad',
        'wrong', 'error', 'hate', 'sad',
    ],
    questions: [
        'qué', 'cómo', 'cuándo', 'dónde', 'por qué', 'quién', 'cuál',
        'what', 'how', 'when', 'where', 'why', 'who', '?',
    ],
} as const;

// -----------------------------------------------------------
// Topic Keywords for Key Points Extraction (Rule #1: NO HARDCODE)
// -----------------------------------------------------------
export const TOPIC_KEYWORDS: Record<string, readonly string[]> = {
    proyecto: ['proyecto', 'presupuesto', 'tarea', 'asignación', 'reunión'],
    tecnologia: ['inteligencia artificial', 'ia', 'software', 'sistema', 'código', 'app'],
    soporte: ['ayuda', 'soporte', 'error', 'no funciona', 'problema', 'falla'],
    aprendizaje: ['aprender', 'curso', 'estudio', 'conocimiento', 'entender'],
    personal: ['familia', 'salud', 'trabajo', 'casa', 'amigo', 'personal'],
} as const;

// -----------------------------------------------------------
// User Emotion Detector — Config (Rule #1: NO HARDCODE)
// -----------------------------------------------------------
export const USER_EMOTION_CONFIG = {
    /** Minimum confidence threshold to report a detection */
    minConfidence: 0.3,
    /** Whether to enable English pattern matching */
    enableEnglish: true,
    /** Max confidence boost for multiple pattern matches */
    maxBoost: 0.2,
    /** Boost per additional match */
    boostPerMatch: 0.1,
    /** Base confidence for praise/criticism/interruption detection */
    baseDetectionConfidence: 0.8,
    /** Low confidence for short utterance interruption */
    lowInterruptionConfidence: 0.4,
    /** Word count threshold for short utterance interruption */
    shortUtteranceWordCount: 3,
    /** Topic change: word overlap ratio threshold (below = topic change) */
    topicChangeOverlapRatio: 0.05,
    /** Topic change: minimum words required in current text */
    topicChangeMinWords: 2,
    /** Topic change: confidence for explicit indicator match */
    topicChangeExplicitConfidence: 0.8,
    /** Topic change: confidence for low-overlap detection */
    topicChangeOverlapConfidence: 0.5,
} as const;

/**
 * Emotion pattern keywords for user emotion detection.
 * Each emotion maps to arrays of keyword phrases (Spanish and English).
 * The detector builds regex patterns from these at runtime.
 */
export const USER_EMOTION_KEYWORDS: Record<string, { keywords: string[]; mood: string; baseConfidence: number }> = {
    feliz: {
        keywords: [
            'feliz', 'contento', 'contenta', 'alegre', 'genial', 'excelente', 'maravilloso', 'buena noticia', 'bueno noticia', 'me encanta',
            'happy', 'great', 'wonderful', 'excellent', 'amazing', 'love it', 'fantastic',
            'qué bien', 'que bien', 'alegría', 'felicidad',
            'me alegra que', 'me alegra mucho', 'me emociona que', 'me emociona mucho',
        ],
        mood: 'positive',
        baseConfidence: 0.7,
    },
    triste: {
        keywords: [
            'triste', 'deprimido', 'deprimida', 'aburrido', 'aburrida', 'desanimado', 'desanimada', 'mal', 'melancólico', 'melancólica',
            'sad', 'depressed', 'bored', 'down', 'unhappy', 'melancholic',
            'qué tristeza', 'que tristeza', 'pena', 'lástima',
            'me entristece que', 'me entristece mucho', 'me apena que', 'me apena mucho',
        ],
        mood: 'negative',
        baseConfidence: 0.7,
    },
    enojado: {
        keywords: [
            'enojado', 'enojada', 'enfadado', 'enfadada', 'furioso', 'furiosa', 'molesto', 'molesta', 'harto', 'harto', 'fastidiado', 'fastidiada',
            'angry', 'mad', 'furious', 'annoyed', 'upset', 'pissed',
            'no soporto más', 'no soporto esto', 'no aguanto más', 'no aguanto esto', 'no tolero más', 'no tolero esto',
            'me enoja que', 'me enoja mucho', 'me enoja cuando', 'me molesta que', 'me molesta mucho', 'me molesta cuando',
            'me fastidia que', 'me fastidia mucho', 'me fastidia cuando',
        ],
        mood: 'negative',
        baseConfidence: 0.8,
    },
    agradecido: {
        keywords: [
            'agradecido', 'agradecida', 'agradezco', 'gracias', 'muchas gracias', 'mil gracias',
            'grateful', 'thankful', 'thanks', 'thank you',
            'te agradezco mucho', 'te agradezco de verdad', 'aprecio mucho', 'aprecio de verdad',
        ],
        mood: 'positive',
        baseConfidence: 0.7,
    },
    confundido: {
        keywords: [
            'confundido', 'confundida', 'perdido', 'perdida', 'no entiendo', 'no comprendo', 'no entendí',
            'confused', 'lost', "don't understand", 'not sure',
            'qué significa', 'que significa', 'quieres decir', 'qué es eso', 'que es eso',
            'no me queda claro', 'no queda claro',
        ],
        mood: 'neutral',
        baseConfidence: 0.6,
    },
    sorprendido: {
        keywords: [
            'sorprendido', 'sorprendida', 'asombrado', 'asombrada', 'impactado', 'impactada', 'impresionado', 'impresionada',
            'surprised', 'amazed', 'shocked', 'impressed', 'wow',
            'no puedo creer', 'me lo puedo creer', 'es increíble',
            'qué sorpresa', 'que sorpresa', 'impresionante', 'increíble',
        ],
        mood: 'neutral',
        baseConfidence: 0.6,
    },
    frustrado: {
        keywords: [
            'frustrado', 'frustrada', 'estresado', 'estresada', 'agobiado', 'agobiada', 'abrumado', 'abrumada', 'desesperado', 'desesperada',
            'frustrated', 'stressed', 'overwhelmed', 'desperate', 'fed up',
            'no puedo más', 'no funciona', 'no sirve', 'no me sale',
            'otra vez no', 'otra vez falló', 'otra vez mal',
        ],
        mood: 'negative',
        baseConfidence: 0.75,
    },
    neutral: {
        keywords: [
            'ok', 'okay', 'bien', 'de acuerdo', 'sí', 'si', 'no', 'vale', 'claro', 'entiendo', 'comprendo', 'ah', 'mm', 'mmm', 'hmm', 'ahá', 'ajá',
            'yes', 'no', 'ok', 'okay', 'fine', 'alright', 'sure', 'understood', 'got it', 'i see',
        ],
        mood: 'neutral',
        baseConfidence: 0.4,
    },
};

/**
 * Question detection keywords for user emotion detector.
 */
export const USER_EMOTION_QUESTION_KEYWORDS: string[] = [
    'qué', 'qué es', 'quién', 'quiénes', 'cómo', 'cuándo', 'dónde', 'por qué', 'para qué', 'cuál', 'cuáles',
    'what', 'who', 'when', 'where', 'why', 'how', 'which', 'is it', 'are you', 'can you', 'could you',
    'me puedes decir', 'me puedes explicar', 'me puedes contar', 'me puedes ayudar',
    'podrías decir', 'podrías explicar', 'podrías contar', 'podrías ayudar',
    'puede decir', 'puede explicar', 'puede contar', 'puede ayudar',
    'podría decir', 'podría explicar', 'podría contar', 'podría ayudar',
];

/**
 * Praise detection keywords for user emotion detector.
 */
export const USER_PRAISE_KEYWORDS: string[] = [
    'bien hecho', 'buen trabajo', 'excelente', 'perfecto', 'genial', 'gracias flu',
    'good job', 'well done', 'excellent', 'perfect', 'great', 'thanks flu',
    'me gustó tu respuesta', 'me gusta tu respuesta', 'me gustó tu ayuda', 'me gusta tu ayuda', 'me gustó tu forma', 'me gusta tu forma',
    'eres el mejor', 'eres la mejor', 'eres grande', 'eres increíble', 'eres asombroso', 'eres excelente',
    'qué bien lo haces', 'que bien lo haces', 'inteligente', 'útil',
];

/**
 * Criticism detection keywords for user emotion detector.
 */
export const USER_CRITICISM_KEYWORDS: string[] = [
    'no sirves', 'no funcionas', 'no entiendes', 'no ayudas', 'no respondes bien',
    'you suck', 'you are useless', "you don't work", 'you are wrong', 'you are bad',
    'mal', 'error', 'incorrecto', 'equivocado', 'pésimo', 'horrible',
    'wrong', 'bad', 'terrible', 'horrible', 'useless', 'stupid',
    'no me gustó tu respuesta', 'no me gusta tu respuesta', 'no me gustó tu ayuda', 'no me gusta tu ayuda',
    'no me gustó tu forma', 'no me gusta tu forma', 'no me gustó tu actitud', 'no me gusta tu actitud',
    'cállate', 'calla', 'shut up', 'stop talking',
];

/**
 * Topic change indicator keywords for user emotion detector.
 */
export const TOPIC_CHANGE_KEYWORDS: string[] = [
    'cambiando de tema', 'cambiando el tema', 'por cierto', 'hablando de otra cosa',
    'changing the subject', 'by the way', 'speaking of which', 'anyway',
    'otra cosa', 'otro tema', 'algo diferente', 'diferente tema',
    'something else', 'another thing', 'different topic',
];

/**
 * Interruption indicator keywords for user emotion detector.
 */
export const INTERRUPTION_KEYWORDS: string[] = [
    'espera', 'esperate', 'para', 'detente', 'alto', 'calma', 'un momento',
    'wait', 'hold on', 'stop', 'hang on', 'one moment', 'hold it',
    'no no no', 'no no', 'no por favor', 'no espera',
    'déjame', 'déjame decir', 'let me', 'let me speak',
];

// -----------------------------------------------------------
// Theory of Mind — Config (Rule #1: NO HARDCODE)
// -----------------------------------------------------------
export const THEORY_OF_MIND_CONFIG = {
    /** Max participants to track simultaneously */
    maxParticipants: 10,
    /** Max topics to remember per participant */
    maxTopicsPerParticipant: 20,
    /** Max emotions to remember per participant */
    maxEmotionsPerParticipant: 10,
    /** How long without interaction before considering a participant "inactive" (ms) — 30 minutes */
    participantInactivityMs: 30 * 60 * 1000,
    /** Minimum word length to consider as a potential topic */
    minTopicWordLength: 4,
    /** Max items to show in summary per category */
    summaryDisplayLimit: 3,
    /** Max questions/expertise topics to track per participant */
    maxQuestionsPerParticipant: 10,
};

/**
 * Stop words to ignore when extracting topics from participant text.
 */
export const THEORY_OF_MIND_STOP_WORDS: string[] = [
    'este', 'esta', 'esto', 'que', 'con', 'para', 'por', 'como',
    'más', 'pero', 'sino', 'todo', 'bien', 'this', 'that', 'with',
    'from', 'what', 'when', 'where', 'which',
];

// -----------------------------------------------------------
// System Event Log — Config (Rule #1: NO HARDCODE)
// -----------------------------------------------------------
export const SYSTEM_EVENT_CONFIG = {
    /** Window in ms: only events within this window are passed to Gemini */
    windowMs: 5 * 60 * 1000, // 5 minutes
    /** Default dedup bucket in ms */
    dedupBucketMs: 3000,
};

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

/**
 * Read a value from localStorage safely.
 * Returns the default value if reading fails or value is not found.
 */
export function readStorage<T>(key: string, defaultValue: T): T {
    // En entornos sin localStorage (Node/SSR/proxy del dev server), no hay
    // storage: devolver el default SIN lanzar ni loguear.
    if (typeof localStorage === 'undefined') return defaultValue;
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return defaultValue;
        return raw as unknown as T;
    } catch {
        return defaultValue;
    }
}

/**
 * Write a value to localStorage safely.
 */
export function writeStorage(key: string, value: string): void {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(key, value);
    } catch {
        // Silencioso: el storage puede no estar disponible (privacidad/quota)
    }
}

/**
 * Build the image API URL from a prompt.
 * Reads localStorage override for image API URL; falls back to POLLINATIONS_CONFIG.
 */
export function buildPollinationsUrl(prompt: string): string {
    const baseUrl = readStorage(STORAGE_KEYS.IMAGE_API_URL, POLLINATIONS_CONFIG.BASE_URL);
    const encoded = encodeURIComponent(prompt);
    return `${baseUrl}/${encoded}?width=${POLLINATIONS_CONFIG.DEFAULT_WIDTH}&height=${POLLINATIONS_CONFIG.DEFAULT_HEIGHT}&${POLLINATIONS_CONFIG.DEFAULT_PARAMS}`;
}

/**
 * Build the DeepSeek API URL for a given endpoint.
 * Uses DEEPSEEK_CONFIG.API_URL as base.
 */
export function buildDeepSeekApiUrl(endpoint: string): string {
    const baseUrl = DEEPSEEK_CONFIG.API_URL;
    // Remove trailing slash from baseUrl if present
    const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    // Remove leading slash from endpoint if present
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${cleanBase}${cleanEndpoint}`;
}

/**
 * Build the text (OpenAI-compatible chat) API URL for a given endpoint.
 * Uses the user-configured TEXT_API_URL as base (supports local endpoints like
 * Ollama/LM Studio at http://localhost:11434/v1), falling back to OPENROUTER_CONFIG.API_URL
 * (Gemini 2.5 Flash Lite via OpenRouter). This powers ALL text operations:
 * minutas, chat, contrato, evaluación, visión y F1/F2/F3.
 */
export function buildTextApiUrl(endpoint: string): string {
    const baseUrl = readStorage(STORAGE_KEYS.TEXT_API_URL, OPENROUTER_CONFIG.API_URL);
    // Remove trailing slash from baseUrl if present
    const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    // Remove leading slash from endpoint if present
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${cleanBase}${cleanEndpoint}`;
}

/**
 * Detect whether a text API URL points to a local (self-hosted) endpoint.
 * Local endpoints (Ollama, LM Studio, vLLM, etc.) do NOT require an API key
 * and may not support OpenAI's `response_format` JSON mode.
 */
export function isLocalTextEndpoint(url: string): boolean {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    } catch {
        return /localhost|127\.0\.0\.1|::1/i.test(url);
    }
}

/**
 * Resolve the text API key from localStorage (configurador) or env.
 * Priority: localStorage (flu-text-api-key) > env var > empty.
 * Env order: VITE_GEMINI_API_KEY > VITE_OPENROUTER_API_KEY > VITE_DEEPSEEK_API_KEY.
 * Nota: el legado flu-gemini-api-key se ELIMINÓ — la única fuente del
 * configurador es flu-text-api-key (0 parches, sin migraciones residuales).
 */
export function resolveTextApiKey(): string {
    const key = readStorage(STORAGE_KEYS.TEXT_API_KEY, '');
    if (key) return key;
    // Fallback: check env vars
    try {
        const envKey = String((import.meta as any)?.env?.VITE_GEMINI_API_KEY ?? '').trim();
        if (envKey) return envKey;
        const orKey = String((import.meta as any)?.env?.VITE_OPENROUTER_API_KEY ?? '').trim();
        if (orKey) return orKey;
        const dsKey = String((import.meta as any)?.env?.VITE_DEEPSEEK_API_KEY ?? '').trim();
        if (dsKey) return dsKey;
    } catch { /* ignore */ }
    return '';
}

/**
 * Resolve the Gemini native API key (paso 5 — fallback de imagen).
 * Priority: flu-gemini-api-key (campo dedicado del configurador) >
 *           resolveTextApiKey() (flu-text-api-key > env VITE_GEMINI_API_KEY >
 *           VITE_OPENROUTER_API_KEY > VITE_DEEPSEEK_API_KEY).
 * Permite usar una clave de Gemini dedicada sin romper la compatibilidad con
 * la clave de texto compartida existente.
 */
export function resolveGeminiApiKey(): string {
    const dedicated = readStorage(STORAGE_KEYS.GEMINI_API_KEY, '').trim();
    if (dedicated) return dedicated;
    return resolveTextApiKey();
}

/**
 * Resolve the fal.ai API key (video real text-to-video).
 * Priority: localStorage (flu-falai-api-key — configurable en Ajustes) >
 *           env VITE_FALAI_API_KEY. Sin key, no hay video real (solo guion).
 */
export function resolveFalApiKey(): string {
    const override = readStorage(STORAGE_KEYS.FALAI_API_KEY, '').trim();
    if (override) return override;
    try {
        return String((import.meta as any)?.env?.VITE_FALAI_API_KEY ?? '').trim();
    } catch {
        return '';
    }
}

/**
 * Resolve el modelo text-to-video de fal.ai.
 * Priority: localStorage (flu-falai-video-model — Ajustes) >
 *           env VITE_FALAI_VIDEO_MODEL > default barato (Wan 2.5, $0.05/s).
 */
export function resolveFalVideoModel(): string {
    const override = readStorage(STORAGE_KEYS.FALAI_VIDEO_MODEL, '').trim();
    if (override) return override;
    return FALAI_CONFIG.VIDEO_MODEL;
}
