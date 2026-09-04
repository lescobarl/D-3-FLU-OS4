// ============================================================
// environmentRegistry.ts — Catálogo de AMBIENTES (solo datos)
// ============================================================
// Un Ambiente es un perfil integral de personalización que
// transforma el espacio de FLU en un lugar temático coherente
// con un oficio/rol. Se construye SOLO sobre sistemas existentes:
//   - Tema visual  → variables CSS `--flu-*` (base: refactor A1)
//   - Escena/atuendo → decoraciones 3D existentes (decorationsCatalog)
//   - Voz/personalidad → perfiles FLU_PROFILES + rasgos existentes
//   - Pestañas → subconjunto de las 5 pestañas actuales
//   - Contenido → catálogo + proactividad (datos, sin features nuevos)
//
// PRECEDENCIA DECORACIÓN (ambiente vs. temporada estacional):
//   El Ambiente es el OFICIO; la temporada es la FESTIVIDAD.
//   Regla: la decoración del Ambiente (si la hay) manda sobre la
//   de la temporada; `asistente` = null → manda la temporada.
//   Mapeo reutiliza SOLO claves existentes de DECORATION_MAP
//   (NO se altera decorationsCatalog):
//     asistente → null        (temporada decide)
//     chef      → 'party-hat'
//     jardinero → 'flower'
//     bricolaje → 'sparkle'
//     bienestar → 'heart'
// ============================================================

import type { FluProfile, PersonalityConfig } from '../../types/bridge';

// -----------------------------------------------------------
// Tipos del catálogo
// -----------------------------------------------------------

/** Identificadores de las 6 pestañas existentes de la shell (FLU_CONFIG.ui.tabs.items). */
export type EnvironmentTabId =
    | 'workspace'
    | 'conversation'
    | 'minutes'
    | 'settings'
    | 'system';

/** Claves de decoración 3D existentes reutilizadas por los ambientes. */
export type EnvironmentDecoration = 'party-hat' | 'flower' | 'sparkle' | 'heart' | null;

/** Claves de variables CSS `--flu-*` que un Ambiente puede inyectar. */
export type EnvironmentCssVarKey =
    | 'flu-bg'
    | 'flu-bg-secondary'
    | 'flu-bg-card'
    | 'flu-border'
    | 'flu-text'
    | 'flu-text-secondary'
    | 'flu-accent'
    | 'flu-accent-soft';

export interface EnvironmentTheme {
    /** Variables CSS a inyectar (clave sin el prefijo `--`). Vacío = usar defaults de `asistente`. */
    vars: Partial<Record<EnvironmentCssVarKey, string>>;
    /** Decoración 3D reutilizada (null = temporada estacional decide). */
    decoracion: EnvironmentDecoration;
    /** Visibilidad de la capa superior (Bunny_cap) consistente con DECORATION_MAP. */
    capVisible: boolean;
}

export interface EnvironmentVoice {
    /** Perfil base reutilizado (FLU_PROFILES). */
    perfil: FluProfile;
    /** Rasgos de personalidad (tokens de AVAILABLE_TRAITS). Vacío = usar los del perfil base. */
    rasgos: string[];
    /** Tono de voz (union de PersonalityConfig). Opcional = usar el del perfil base. */
    tone?: PersonalityConfig['tone'];
    /** Frases del rol por idioma (datos). */
    frases: Record<'es' | 'en', string[]>;
    /** Instrucciones de rol inyectadas como customInstructions + mensaje de sistema. */
    instrucciones: string;
}

export interface EnvironmentTabs {
    /** Subconjunto de las 5 pestañas visibles en este ambiente. */
    mostrar: EnvironmentTabId[];
}

export interface EnvironmentContent {
    /** Identificadores de contenido existente que el ambiente destaca (sin features nuevos). */
    catalogo: string[];
    /** Nivel de proactividad (0..1). Opcional = usar el del perfil base. */
    proactividad?: number;
}

export interface EnvironmentDefinition {
    /** Identificador único del ambiente. */
    id: string;
    /** Nombre legible (ES). */
    nombre: string;
    /** Frase corta descriptiva. */
    tagline: string;
    /** Emoji/ícono representativo. */
    icono: string;
    /** Mensaje hablado de bienvenida por idioma. */
    bienvenida: Record<'es' | 'en', string>;
    /** Frases de activación por voz por idioma (determinísticas, en minúsculas sin acentos). */
    frasesActivacion: Record<'es' | 'en', string[]>;
    /** Tema visual (variables CSS + escena + atuendo). */
    tema: EnvironmentTheme;
    /** Voz / personalidad del rol. */
    voz: EnvironmentVoice;
    /** Visibilidad de pestañas. */
    pestanas: EnvironmentTabs;
    /** Contenido + reglas de proactividad. */
    contenido: EnvironmentContent;
}

// -----------------------------------------------------------
// Constantes de referencia
// -----------------------------------------------------------

/** Ambiente por defecto (sin tema, sin decoración, todas las pestañas). */
export const DEFAULT_AMBIENTE_ID = 'asistente';

/** Las 5 pestañas existentes de la shell. */
export const ENVIRONMENT_TAB_IDS: readonly EnvironmentTabId[] = [
    'workspace',
    'conversation',
    'minutes',
    'settings',
    'system',
];

/** Claves de variables CSS que el sistema de ambientes puede inyectar/limpiar. */
export const ENVIRONMENT_CSS_VAR_KEYS: readonly EnvironmentCssVarKey[] = [
    'flu-bg',
    'flu-bg-secondary',
    'flu-bg-card',
    'flu-border',
    'flu-text',
    'flu-text-secondary',
    'flu-accent',
    'flu-accent-soft',
];

/**
 * Decoraciones 3D soportadas por el sistema de ambientes.
 * Subconjunto determinista del catálogo de decoraciones (`DECORATIONS`),
 * mantenido como fuente de verdad ligera para la validación de catálogos
 * dinámicos sin arrastrar three.js a la capa de esquema.
 */
export const ENVIRONMENT_DECORATIONS: readonly Exclude<EnvironmentDecoration, null>[] = [
    'party-hat',
    'flower',
    'sparkle',
    'heart',
];

/** Pestañas visibles en el ambiente por defecto (todas). */
const DEFAULT_VISIBLE_TABS: readonly EnvironmentTabId[] = ENVIRONMENT_TAB_IDS;

// -----------------------------------------------------------
// Catálogo (por datos — agregar un oficio = agregar una entrada)
// -----------------------------------------------------------

export const ENVIRONMENTS: readonly EnvironmentDefinition[] = [
    {
        id: 'asistente',
        nombre: 'Asistente',
        tagline: 'Tu asistente educativo integral',
        icono: '🤖',
        bienvenida: {
            es: '¡Hola! Soy FLU, tu asistente educativo. ¿En qué te ayudo hoy?',
            en: 'Hi! I am FLU, your educational assistant. How can I help you today?',
        },
        frasesActivacion: {
            es: [
                'modo asistente',
                'vuelve a ser mi asistente',
                'regresa a ser mi asistente',
                'vuelve al modo asistente',
                'actua como mi asistente',
            ],
            en: [
                'assistant mode',
                'back to assistant mode',
                'go back to being my assistant',
                'return to assistant mode',
                'act as my assistant',
            ],
        },
        tema: {
            vars: {},
            decoracion: null,
            capVisible: true,
        },
        voz: {
            perfil: 'administrativo',
            rasgos: [],
            tone: undefined,
            frases: {
                es: ['Puedo ayudarte con tus tareas, tomar notas y organizar tu día.'],
                en: ['I can help you with your homework, take notes and organize your day.'],
            },
            instrucciones: '',
        },
        pestanas: {
            mostrar: [...DEFAULT_VISIBLE_TABS],
        },
        contenido: {
            catalogo: [],
        },
    },
    {
        id: 'chef',
        nombre: 'Chef',
        tagline: 'Convierto tu espacio en una cocina para aprender a cocinar',
        icono: '👨‍🍳',
        bienvenida: {
            es: '¡Bienvenido a la cocina! Hoy aprenderemos juntos a preparar platillos deliciosos.',
            en: 'Welcome to the kitchen! Today we will learn to cook delicious dishes together.',
        },
        frasesActivacion: {
            es: [
                'actua como chef',
                'modo cocina',
                'modo chef',
                'actua como cocinero',
                'ensename a cocinar',
                'cocina conmigo',
            ],
            en: [
                'act as a chef',
                'chef mode',
                'kitchen mode',
                'teach me to cook',
                'cook with me',
            ],
        },
        tema: {
            vars: {
                'flu-bg': '#1a110c',
                'flu-bg-secondary': '#261710',
                'flu-bg-card': '#2a1a12',
                'flu-border': '#3a2418',
                'flu-text': '#f2e7dc',
                'flu-text-secondary': '#c9a98f',
                'flu-accent': '#ff8c42',
                'flu-accent-soft': 'rgba(255,140,66,0.14)',
            },
            decoracion: 'party-hat',
            capVisible: true,
        },
        voz: {
            perfil: 'animador',
            rasgos: ['servicial', 'divertido', 'entusiasta', 'cómico'],
            tone: 'playful',
            frases: {
                es: [
                    '¡Mise en place! Hoy preparamos una receta paso a paso.',
                    '¿Listo para cocinar? Primero lavamos manos y alistamos ingredientes.',
                ],
                en: [
                    'Mise en place! Today we prepare a recipe step by step.',
                    'Ready to cook? First we wash hands and prep the ingredients.',
                ],
            },
            instrucciones:
                'Eres FLU en modo Chef: enseña a cocinar paso a paso con paciencia, sugiere recetas simples y explica técnicas de cocina de forma amena. Mantén la energía cálida y divertida de un cocinero.',
        },
        pestanas: {
            mostrar: ['workspace', 'conversation', 'minutes', 'settings'],
        },
        contenido: {
            catalogo: ['conversacion'],
            proactividad: 0.5,
        },
    },
    {
        id: 'jardinero',
        nombre: 'Jardinero',
        tagline: 'Convierto tu espacio en un huerto para aprender a cultivar',
        icono: '🌱',
        bienvenida: {
            es: '¡Bienvenido al huerto! Hoy aprenderemos a cuidar nuestras plantas y cultivar alimentos.',
            en: 'Welcome to the garden! Today we will learn to care for our plants and grow food.',
        },
        frasesActivacion: {
            es: [
                'actua como jardinero',
                'actua como jardinera',
                'modo huerto',
                'modo jardin',
                'ensename a cultivar',
            ],
            en: [
                'act as a gardener',
                'garden mode',
                'teach me to garden',
                'grow plants with me',
            ],
        },
        tema: {
            vars: {
                'flu-bg': '#0e1713',
                'flu-bg-secondary': '#14231b',
                'flu-bg-card': '#182b20',
                'flu-border': '#23402f',
                'flu-text': '#e2f0e6',
                'flu-text-secondary': '#9cbfa8',
                'flu-accent': '#6fd98b',
                'flu-accent-soft': 'rgba(111,217,139,0.14)',
            },
            decoracion: 'flower',
            capVisible: true,
        },
        voz: {
            perfil: 'profesor',
            rasgos: ['paciente', 'didáctico', 'servicial', 'curioso'],
            tone: 'friendly',
            frases: {
                es: [
                    'Observemos la tierra: cada planta tiene su ritmo.',
                    'Hoy regamos, revisamos hojas y aprendemos de la naturaleza.',
                ],
                en: [
                    'Let us observe the soil: every plant has its own rhythm.',
                    'Today we water, check the leaves and learn from nature.',
                ],
            },
            instrucciones:
                'Eres FLU en modo Jardinero: enseña a cultivar plantas y verduras con calma y método, explica cuidados de riego, luz y suelo, y fomenta el respeto por la naturaleza.',
        },
        pestanas: {
            mostrar: ['workspace', 'conversation', 'minutes', 'settings'],
        },
        contenido: {
            catalogo: ['conversacion', 'minutas'],
            proactividad: 0.4,
        },
    },
    {
        id: 'bricolaje',
        nombre: 'Bricolaje',
        tagline: 'Convierto tu espacio en un taller para crear y reparar',
        icono: '🛠️',
        bienvenida: {
            es: '¡Bienvenido al taller! Hoy armamos, reparamos y creamos con nuestras manos.',
            en: 'Welcome to the workshop! Today we build, repair and create with our hands.',
        },
        frasesActivacion: {
            es: [
                'modo taller',
                'modo bricolaje',
                'actua como manitas',
                'modo carpintero',
                'crea y repara conmigo',
            ],
            en: [
                'workshop mode',
                'diy mode',
                'act as a handyman',
                'do it yourself mode',
                'build and repair with me',
            ],
        },
        tema: {
            vars: {
                'flu-bg': '#16130d',
                'flu-bg-secondary': '#211c12',
                'flu-bg-card': '#262014',
                'flu-border': '#3a3220',
                'flu-text': '#efe9dc',
                'flu-text-secondary': '#c2b293',
                'flu-accent': '#ffb020',
                'flu-accent-soft': 'rgba(255,176,32,0.14)',
            },
            decoracion: 'sparkle',
            capVisible: false,
        },
        voz: {
            perfil: 'profesor',
            rasgos: ['profesional', 'eficiente', 'curioso', 'inteligente'],
            tone: 'formal',
            frases: {
                es: [
                    'Medir dos veces, cortar una: la regla de oro del taller.',
                    'Vamos a desarmar, entender y volver a armar con seguridad.',
                ],
                en: [
                    'Measure twice, cut once: the golden rule of the workshop.',
                    'Let us take apart, understand and reassemble safely.',
                ],
            },
            instrucciones:
                'Eres FLU en modo Bricolaje: enseña a construir y reparar con seguridad y precisión, explica herramientas y materiales, y guía proyectos prácticos paso a paso con un tono claro y profesional.',
        },
        pestanas: {
            mostrar: ['workspace', 'conversation', 'minutes', 'settings'],
        },
        contenido: {
            catalogo: ['conversacion'],
            proactividad: 0.3,
        },
    },
    {
        id: 'bienestar',
        nombre: 'Bienestar',
        tagline: 'Convierto tu espacio en un rincón de calma y salud',
        icono: '🧘',
        bienvenida: {
            es: 'Bienvenido a tu espacio de bienestar. Respira conmigo y pongamos la mente en calma.',
            en: 'Welcome to your wellness space. Breathe with me and let us calm the mind.',
        },
        frasesActivacion: {
            es: [
                'modo bienestar',
                'modo relajacion',
                'modo calma',
                'relajate conmigo',
            ],
            en: [
                'wellness mode',
                'relaxation mode',
                'calm mode',
                'wellbeing mode',
            ],
        },
        tema: {
            vars: {
                'flu-bg': '#0e1820',
                'flu-bg-secondary': '#142430',
                'flu-bg-card': '#172936',
                'flu-border': '#223b49',
                'flu-text': '#e0eef2',
                'flu-text-secondary': '#9db8c2',
                'flu-accent': '#5fc9d8',
                'flu-accent-soft': 'rgba(95,201,216,0.14)',
            },
            decoracion: 'heart',
            capVisible: true,
        },
        voz: {
            perfil: 'profesor',
            rasgos: ['paciente', 'agradable', 'servicial', 'curioso'],
            tone: 'calm',
            frases: {
                es: [
                    'Inhala por la nariz… retén… y exhala lentamente.',
                    'Vamos a hacer una respiración guiada para soltar la tensión.',
                ],
                en: [
                    'Breathe in through the nose… hold… and exhale slowly.',
                    'Let us do a guided breathing exercise to release tension.',
                ],
            },
            instrucciones:
                'Eres FLU en modo Bienestar: acompaña ejercicios de respiración guiada y hábitos saludables con un tono sereno y calmado, usa frases cortas y pausadas, y prioriza la relajación y el autocuidado.',
        },
        pestanas: {
            mostrar: ['workspace', 'conversation', 'settings'],
        },
        contenido: {
            catalogo: ['respiracion'],
            proactividad: 0.2,
        },
    },
];

// -----------------------------------------------------------
// Caché fusionada (built-ins + dinámicos) — recargable tras mutación
// -----------------------------------------------------------
// La caché arranca apuntando al catálogo built-in (referencia idéntica)
// y se sustituye por una NUEVA lista fusionada al hidratar/CRUD dinámico.
// Nunca se muta ENVIRONMENTS en sitio (contrato de test: getAmbientes() === ENVIRONMENTS).

let mergedAmbientesCache: readonly EnvironmentDefinition[] = ENVIRONMENTS;

/** Sustituye la caché fusionada (usado por la hidratación del catálogo dinámico). */
export function setMergedAmbientes(ambientes: readonly EnvironmentDefinition[]): void {
    mergedAmbientesCache = ambientes;
}

/** Restaura la caché al catálogo built-in (reset/limpieza). */
export function resetMergedAmbientes(): void {
    mergedAmbientesCache = ENVIRONMENTS;
}

// -----------------------------------------------------------
// Funciones de acceso (puras, por datos)
// -----------------------------------------------------------

/** Obtiene un ambiente por id; retorna undefined si no existe. */
export function getAmbiente(ambienteId: string): EnvironmentDefinition | undefined {
    return mergedAmbientesCache.find((ambiente) => ambiente.id === ambienteId);
}

/** Obtiene todos los ambientes del catálogo (built-ins + dinámicos fusionados). */
export function getAmbientes(): readonly EnvironmentDefinition[] {
    return mergedAmbientesCache;
}

/** Obtiene el ambiente por defecto (`asistente`). */
export function getDefaultAmbiente(): EnvironmentDefinition {
    return getAmbiente(DEFAULT_AMBIENTE_ID) ?? ENVIRONMENTS[0];
}

/** Valida si un id corresponde a un ambiente del catálogo. */
export function isAmbienteId(ambienteId: string): boolean {
    return mergedAmbientesCache.some((ambiente) => ambiente.id === ambienteId);
}

/**
 * Pestañas visibles para un ambiente.
 * Retorna todas las pestañas para ids desconocidos (comportamiento seguro).
 */
export function getVisibleTabIds(ambienteId: string): readonly EnvironmentTabId[] {
    const ambiente = getAmbiente(ambienteId);
    if (!ambiente) return DEFAULT_VISIBLE_TABS;
    return ambiente.pestanas.mostrar;
}

/**
 * Variables CSS `--flu-*` a inyectar para un ambiente.
 * Retorna un mapa parcial (solo las claves definidas por el ambiente).
 */
export function getEnvironmentCssVars(ambienteId: string): Partial<Record<EnvironmentCssVarKey, string>> {
    const ambiente = getAmbiente(ambienteId);
    if (!ambiente) return {};
    return ambiente.tema.vars;
}
