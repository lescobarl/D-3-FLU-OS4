// ============================================================
// SharedConfig — Configuración compartida server-safe
// ============================================================
// Fuente ÚNICA de los valores y la lógica que comparten el CLIENTE
// (navegador) y el SERVIDOR (vite.config.ts → geminiProxy → gemini.js).
//
// Regla de capas (AGENTS.md §1): este módulo NO puede tocar
// `import.meta.env` en scope de módulo (en Node, al cargar
// vite.config.ts, `import.meta.env` es `undefined` y revienta).
// El cliente sigue leyendo `import.meta.env.VITE_X` ESTÁTICO en
// appConfig.ts; el servidor lee el env inyectado por
// createGeminiMiddleware({ env }) (loadEnv) o process.env, a través
// de readServerEnv().
//
// Un solo lugar por valor:
//   - isLocalTextEndpoint (detección de endpoint local)
//   - prioridad de keys (VITE_OPENROUTER > VITE_GEMINI > VITE_DEEPSEEK)
//   - defaults de OpenRouter / fal.ai / Pollinations
// ============================================================

import type { FluProfileDefinition } from '../../types/bridge';

// -----------------------------------------------------------
// Env del servidor (inyectado en runtime, sin import.meta.env)
// -----------------------------------------------------------

/** Mapa de variables de entorno (string | undefined). */
export type EnvRecord = Record<string, string | undefined>;

let serverEnv: EnvRecord | null = null;

/**
 * Inyecta el env cargado por `loadEnv()` en vite.config.ts.
 * El servidor lo usa como respaldo cuando no hay variable en process.env.
 */
export function setServerEnv(env: EnvRecord | null | undefined): void {
    serverEnv = env && typeof env === 'object' ? env : null;
}

/** Devuelve el env inyectado (o un mapa vacío si aún no se inyectó). */
export function getServerEnv(): EnvRecord {
    return serverEnv ?? {};
}

/**
 * Lee una variable de entorno server-side: primero el env inyectado
 * (loadEnv) y luego process.env. Nunca toca import.meta.env.
 */
export function readServerEnv(name: string): string | undefined {
    const injected = serverEnv ? serverEnv[name] : undefined;
    if (injected) return injected;
    if (typeof process !== 'undefined' && process.env) {
        const fromProcess = process.env[name];
        if (fromProcess) return fromProcess;
    }
    return undefined;
}

// -----------------------------------------------------------
// Dominio compartido (workspace)
// -----------------------------------------------------------

/** Valores válidos para workspace.tipo (contrato FLU). */
export const WORKSPACE_TIPOS: readonly string[] = ['text', 'image_prompt', 'diagram', '3d', 'horario', 'doc', 'video'];

/** Tipos visuales que activan generación de imagen (Pollinations). */
export const VALID_VISUAL_TIPOS: readonly string[] = ['image_prompt', 'diagram', '3d'];

// -----------------------------------------------------------
// Defaults (Rule #1: NO HARDCODE) — sin import.meta.env
// -----------------------------------------------------------

/** Defaults del motor de texto (OpenRouter → Gemini 2.5 Flash Lite). */
export const OPENROUTER_DEFAULTS = {
    MODEL: 'google/gemini-2.5-flash-lite',
    API_URL: 'https://openrouter.ai/api/v1',
    DEFAULT_TEMPERATURE: 0.7,
    DEFAULT_MAX_TOKENS: 1200,
    /** Modelo de la Image API de OpenRouter (respaldo real cuando Pollinations falla). */
    IMAGE_MODEL: 'google/gemini-2.5-flash-image',
    /** Endpoint relativo de la Image API de OpenRouter (relativo a API_URL). */
    IMAGE_ENDPOINT: '/images',
    IMAGE_ASPECT_RATIO: '16:9',
} as const;

/** Defaults de fal.ai (video text-to-video). */
export const FALAI_DEFAULTS = {
    VIDEO_ENDPOINT: 'https://queue.fal.run',
    VIDEO_MODEL: 'fal-ai/wan-25-preview/text-to-video',
    ASPECT_RATIO: '16:9',
    POLL_TIMEOUT_MS: 180_000,
} as const;

/** Defaults de Pollinations.ai (imágenes). */
export const POLLINATIONS_DEFAULTS = {
    BASE_URL: 'https://image.pollinations.ai/prompt',
    DEFAULT_WIDTH: 1024,
    DEFAULT_HEIGHT: 768,
    DEFAULT_PARAMS: 'nologo=true',
} as const;

/** Timeout Policy (V12 — delays de política). */
export const TIMEOUT_POLICY_MS = {
    onboardingGestureCleanup: 10_000,
    documentObjectUrlRevoke: 5_000,
    pizarronToast: 4_000,
    healthProbeAbort: 5_000,
    networkPingAbort: 3_000,
    sustainedActionRecheck: 1_000,
    falVideoPoll: 3_000,
    falVideoFetchAbort: 200_000,
} as const;

/**
 * Timeouts de RED por defecto (ms) — fuente ÚNICA (C18, Rule #1: NO HARDCODE).
 * Los consumidores (httpClient, workers, proxies, musicSearch) importan de aquí;
 * ningún módulo re-declara su propio literal de timeout.
 */
export const REQUEST_TIMEOUT_DEFAULTS = {
    /** Petición de texto IA (motor por defecto). */
    AI_TEXT_MS: 45_000,
    /** Conversación / consulta general. */
    CONVERSATION_MS: 15_000,
    /** Consulta de minutas (lookup corto). */
    MINUTES_MS: 10_000,
    /** Generación de imagen nativa. */
    IMAGE_MS: 90_000,
    /** Petición a worker (fbx / voice id). */
    WORKER_MS: 45_000,
    /** Proxy de búsqueda. */
    SEARCH_PROXY_MS: 8_000,
    /** Proxy de navegador curado. */
    BROWSER_PROXY_MS: 10_000,
    /** Búsqueda de música (Deezer). */
    MUSIC_SEARCH_MS: 8_000,
    /** Sonda de transmisibilidad de audio. */
    MUSIC_PROBE_MS: 4_000,
} as const;

/**
 * Umbrales de AUTONOMÍA (salud / decisiones / auto-optimización) — fuente
 * única (C38). Ningún módulo de autonomía declara umbrales numéricos inline.
 */
export const AUTONOMY_THRESHOLD_DEFAULTS = {
    health: {
        degraded: 0.85,
        critical: 0.60,
        loadWarnRatio: 0.75,
        weightDegraded: 0.85,
        aiAvailabilityMin: 0.95,
        speechRecognitionAvailabilityMin: 0.90,
        speechSynthesisErrorRateMax: 0.15,
        speechSynthesisAvailabilityMin: 0.98,
        indexedDbAvailabilityMin: 0.99,
        networkErrorRateMax: 0.25,
        networkAvailabilityMin: 0.85,
        memoryErrorRateMax: 0.05,
        memoryAvailabilityMin: 0.95,
        reactComponentsAvailabilityMin: 0.98,
    },
    decision: {
        hysteresis: 0.15,
        factorWeightResponseTime: 0.25,
        factorWeightSuccessRate: 0.30,
        factorWeightCost: 0.20,
        factorWeightEcological: 0.15,
        factorWeightResponseQuality: 0.10,
        confidenceSupportPerFactor: 0.05,
        confidenceRiskPenalty: 0.05,
        sampleOpenrouterSuccessRate: 0.92,
        sampleOpenrouterCostPer1k: 0.075,
        sampleOpenrouterQuality: 0.90,
        sampleGeminiSuccessRate: 0.85,
        sampleGeminiCostPer1k: 0.50,
        sampleGeminiQuality: 0.88,
    },
    optimization: {
        minConfidence: 0.65,
        confidenceMax: 0.95,
        confidenceStep: 0.05,
        minImprovement: 0.05,
        weightSpeechSuccessRate: 0.2,
        weightAiResponseTime: 0.15,
        weightTimeoutRate: 0.15,
        weightMemoryUsage: 0.1,
        weightUserFeedback: 0.25,
        weightSystemStability: 0.15,
    },
} as const;

/**
 * Umbrales de VOZ (diarización) — fuente única (C38). Reemplazan los literales
 * de respaldo inline en speakerDiarization.js.
 */
export const VOICE_DIARIZATION_DEFAULTS = {
    cosineContinuity: 0.74,
    cosineNewVoice: 0.68,
    productionClusterReuse: 0.74,
    classroomReuseRelax: 0.03,
    classroomNewVoiceRelax: 0.04,
    classroomLastSpeakerSwitchMargin: 0.06,
    soloNewVoiceFactor: 0.82,
    switchRelax: 0.45,
    turnBoundaryClusterReabsorbMargin: 0.035,
    cosineMatch: 0.76,
    cosineRegisteredMatch: 0.72,
    continuityBoundaryFactor: 0.82,
    newVoiceBoundaryFactor: 0.88,
    turnBoundaryNewVoiceMultiFactor: 0.72,
    turnBoundaryVoicedFactor: 0.55,
    turnBoundaryLastTurnFactor: 0.48,
    stickyClusterReidentifyMargin: 0.025,
    stickyMatchFactor: 0.92,
    lastClusterMatchFactor: 0.95,
    strictNewVoiceAtCapFactor: 0.88,
    strictNewVoiceStickySoftCapFactor: 0.82,
} as const;

// -----------------------------------------------------------
// Helpers puros (compartidos cliente/servidor)
// -----------------------------------------------------------

/**
 * Detecta si una URL de API de texto apunta a un endpoint local
 * (Ollama, LM Studio, vLLM, etc.) que NO requiere API key.
 */
export function isLocalTextEndpoint(url: string): boolean {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    } catch {
        console.warn('[catch] src/core/config/sharedConfig.ts');
        return /localhost|127\.0\.0\.1|::1/i.test(url);
    }
}

/**
 * Une una base URL con un endpoint (limpia slashes de ambos extremos).
 */
export function joinApiUrl(baseUrl: string, endpoint: string): string {
    const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${cleanBase}${cleanEndpoint}`;
}

/**
 * Construye la URL de generación de imagen de Pollinations.
 */
export function buildPollinationsImageUrl(baseUrl: string, prompt: string): string {
    const encoded = encodeURIComponent(prompt);
    return `${baseUrl}/${encoded}?width=${POLLINATIONS_DEFAULTS.DEFAULT_WIDTH}&height=${POLLINATIONS_DEFAULTS.DEFAULT_HEIGHT}&${POLLINATIONS_DEFAULTS.DEFAULT_PARAMS}`;
}

/**
 * Prioridad ÚNICA de la key de texto: VITE_OPENROUTER > VITE_GEMINI > VITE_DEEPSEEK.
 * El cliente pasa `import.meta.env` (estático); el servidor pasa el env
 * inyectado/process.env. Una sola fuente para la prioridad.
 */
export function resolveTextApiKeyFromEnv(env: EnvRecord): string {
    return String(
        env.VITE_OPENROUTER_API_KEY || env.VITE_GEMINI_API_KEY || env.VITE_DEEPSEEK_API_KEY || '',
    ).trim();
}

// -----------------------------------------------------------
// Resolutores server-side (env inyectado + process.env + default)
// -----------------------------------------------------------

/** Key de texto resuelta server-side (env > process.env > vacío). */
export function resolveServerTextApiKey(): string {
    return resolveTextApiKeyFromEnv({
        VITE_OPENROUTER_API_KEY: readServerEnv('VITE_OPENROUTER_API_KEY'),
        VITE_GEMINI_API_KEY: readServerEnv('VITE_GEMINI_API_KEY'),
        VITE_DEEPSEEK_API_KEY: readServerEnv('VITE_DEEPSEEK_API_KEY'),
    });
}

/** URL base del motor de texto resuelta server-side (env > default). */
export function resolveServerTextApiUrl(): string {
    return String(readServerEnv('VITE_OPENROUTER_URL') || '').trim() || OPENROUTER_DEFAULTS.API_URL;
}

/** Modelo de texto resuelto server-side (env > default). */
export function resolveServerTextModel(): string {
    return String(readServerEnv('VITE_OPENROUTER_MODEL') || '').trim() || OPENROUTER_DEFAULTS.MODEL;
}

/** URL base de Pollinations resuelta server-side (env > default). */
export function resolveServerPollinationsUrl(): string {
    return String(readServerEnv('VITE_POLLINATIONS_URL') || '').trim() || POLLINATIONS_DEFAULTS.BASE_URL;
}

// -----------------------------------------------------------
// FLU Configurator — Valores por defecto (datos puros)
// -----------------------------------------------------------

/**
 * Valores por defecto para la configuración avanzada.
 * NOTE: Uses inline literals to avoid hoisting issues with const enums
 * defined later in the config. The canonical values are in the individual
 * config objects (USER_EMOTION_CONFIG, THEORY_OF_MIND_CONFIG, SYSTEM_EVENT_CONFIG).
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

/** Rasgos de personalidad disponibles para selección. */
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

/** Tonos de voz disponibles. */
export const AVAILABLE_TONES = [
    'friendly',
    'formal',
    'playful',
    'calm',
] as const;

/**
 * Perfiles predefinidos de FLU.
 * Array — no hardcodeado como N objetos fijos.
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
