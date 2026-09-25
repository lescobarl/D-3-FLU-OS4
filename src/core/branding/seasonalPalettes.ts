// ============================================================
// FLU OS4 — Paletas de Temporada (Branding Inteligente)
// ============================================================
// Define paletas de colores para cada temporada/festividad.
// Cada paleta sobrescribe las variables CSS del tema oscuro base.
// ============================================================

/**
 * Paleta de colores que sobrescribe las variables CSS del :root.
 * Solo se modifican colores — las variables de tipografía (--text-xs, etc.)
 * y espaciado NO se tocan para mantener consistencia visual.
 */
export interface Palette {
    name: string;
    colors: {
        '--bg-primary': string;
        '--bg-secondary': string;
        '--bg-tertiary'?: string;
        '--bg-card': string;
        '--text-primary': string;
        '--text-secondary': string;
        '--text-muted'?: string;
        '--accent-cyan': string;
        '--accent-green': string;
        '--accent-orange': string;
        '--accent-red': string;
        '--accent-pink': string;
        '--border-color': string;
    };
    /** Decoración del avatar 3D para esta temporada */
    decoration?: string;
    /** Clase CSS adicional para animaciones de temporada */
    cssClass?: string;
}

/**
 * Definición de paleta con id canónico (slug). Es la forma con la que
 * operan los catálogos dinámicos (tabla `paletas`) y la caché fusionada
 * de built-ins + dinámicas (B2).
 */
export type PaletteDefinition = Palette & { id: string };

/**
 * Claves canónicas del set de variables CSS de una paleta (13). Se derivan
 * de Palette y sirven como contrato de validación (B1): una paleta dinámica
 * debe contener EXACTAMENTE estas claves, cada una con valor #RRGGBB.
 */
export const PALETTE_COLOR_KEYS = [
    '--bg-primary',
    '--bg-secondary',
    '--bg-tertiary',
    '--bg-card',
    '--text-primary',
    '--text-secondary',
    '--text-muted',
    '--accent-cyan',
    '--accent-green',
    '--accent-orange',
    '--accent-red',
    '--accent-pink',
    '--border-color',
] as const;

// ============================================================
// Paletas predefinidas
// ============================================================

export const PALETTES: Record<string, Palette> = {
    // -------------------------------------------------------
    // Default — Tema oscuro base (OS4 original)
    // -------------------------------------------------------
    default: {
        name: 'Default',
        colors: {
            '--bg-primary': '#0f0f1a',
            '--bg-secondary': '#1a1a2e',
            '--bg-tertiary': '#16213e',
            '--bg-card': '#1e1e36',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#8888aa',
            '--text-muted': '#555',
            '--accent-cyan': '#00d4ff',
            '--accent-green': '#00ff88',
            '--accent-orange': '#ffaa00',
            '--accent-red': '#ff4444',
            '--accent-pink': '#ff66ff',
            '--border-color': '#2a2a4a',
        },
    },

    // -------------------------------------------------------
    // Navidad — Rojo, verde, dorado, azul hielo
    // -------------------------------------------------------
    navidad: {
        name: 'Navidad',
        colors: {
            '--bg-primary': '#180a0a',
            '--bg-secondary': '#331414',
            '--bg-tertiary': '#123412',
            '--bg-card': '#421d1d',
            '--text-primary': '#f2e6e6',
            '--text-secondary': '#d0abab',
            '--text-muted': '#8a5555',
            '--accent-cyan': '#8fe3ff',
            '--accent-green': '#3dff8f',
            '--accent-orange': '#ffd700',
            '--accent-red': '#ff5252',
            '--accent-pink': '#ff69b4',
            '--border-color': '#6e2f2f',
        },
        decoration: 'santa-hat',
        cssClass: 'season-navidad',
    },

    // -------------------------------------------------------
    // Día de Muertos — Naranja cempasúchil, púrpura, negro
    // -------------------------------------------------------
    muertos: {
        name: 'Día de Muertos',
        colors: {
            '--bg-primary': '#0f0f1a',
            '--bg-secondary': '#2e1a2e',
            '--bg-tertiary': '#1a0f1a',
            '--bg-card': '#362036',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#aa88aa',
            '--text-muted': '#553355',
            '--accent-cyan': '#ff6600',
            '--accent-green': '#ff8800',
            '--accent-orange': '#ffaa00',
            '--accent-red': '#ff4444',
            '--accent-pink': '#ff66ff',
            '--border-color': '#4a2a4a',
        },
        decoration: 'marigold',
        cssClass: 'season-muertos',
    },

    // -------------------------------------------------------
    // 16 de Septiembre / Patrio — Verde, blanco, rojo
    // -------------------------------------------------------
    patrio: {
        name: 'Patrio',
        colors: {
            '--bg-primary': '#0f1a0f',
            '--bg-secondary': '#1a2e1a',
            '--bg-tertiary': '#0f1a0f',
            '--bg-card': '#1e361e',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#88aa88',
            '--text-muted': '#335533',
            '--accent-cyan': '#00ff88',
            '--accent-green': '#ff4444',
            '--accent-orange': '#ffaa00',
            '--accent-red': '#ff4444',
            '--accent-pink': '#ff66ff',
            '--border-color': '#2a4a2a',
        },
        decoration: 'flag',
        cssClass: 'season-patrio',
    },

    // -------------------------------------------------------
    // Día del Niño / Infantil — Colores brillantes y alegres
    // -------------------------------------------------------
    infantil: {
        name: 'Infantil',
        colors: {
            '--bg-primary': '#1a1a2e',
            '--bg-secondary': '#2e2e4a',
            '--bg-tertiary': '#1a1a3e',
            '--bg-card': '#363656',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#aaaacc',
            '--text-muted': '#555577',
            '--accent-cyan': '#00ffcc',
            '--accent-green': '#ffcc00',
            '--accent-orange': '#ff8800',
            '--accent-red': '#ff6666',
            '--accent-pink': '#ff88ff',
            '--border-color': '#4a4a6a',
        },
        decoration: 'party-hat',
        cssClass: 'season-infantil',
    },

    // -------------------------------------------------------
    // Día del Maestro — Tonos académicos, azul y dorado
    // -------------------------------------------------------
    maestro: {
        name: 'Día del Maestro',
        colors: {
            '--bg-primary': '#0f0f1a',
            '--bg-secondary': '#1a1a3e',
            '--bg-tertiary': '#0f1a2e',
            '--bg-card': '#1e1e46',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#8888aa',
            '--text-muted': '#444466',
            '--accent-cyan': '#00aaff',
            '--accent-green': '#ffd700',
            '--accent-orange': '#ffaa00',
            '--accent-red': '#ff4444',
            '--accent-pink': '#ff66ff',
            '--border-color': '#2a2a5a',
        },
        cssClass: 'season-maestro',
    },

    // -------------------------------------------------------
    // Cumpleaños — Rosa, dorado, celebración
    // -------------------------------------------------------
    cumpleanos: {
        name: 'Cumpleaños',
        colors: {
            '--bg-primary': '#1a0f1a',
            '--bg-secondary': '#2e1a2e',
            '--bg-tertiary': '#1a0f2e',
            '--bg-card': '#362046',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#aa88aa',
            '--text-muted': '#553355',
            '--accent-cyan': '#ff69b4',
            '--accent-green': '#ff1493',
            '--accent-orange': '#ffd700',
            '--accent-red': '#ff4444',
            '--accent-pink': '#ff66ff',
            '--border-color': '#4a2a5a',
        },
        decoration: 'party-hat',
        cssClass: 'season-cumpleanos',
    },

    // -------------------------------------------------------
    // Año Nuevo — Dorado, plateado, brillo
    // -------------------------------------------------------
    ano_nuevo: {
        name: 'Año Nuevo',
        colors: {
            '--bg-primary': '#0f0f1a',
            '--bg-secondary': '#1a1a2e',
            '--bg-tertiary': '#1a1a3e',
            '--bg-card': '#1e1e46',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#aaaacc',
            '--text-muted': '#555577',
            '--accent-cyan': '#ffd700',
            '--accent-green': '#c0c0c0',
            '--accent-orange': '#ffaa00',
            '--accent-red': '#ff4444',
            '--accent-pink': '#ff69b4',
            '--border-color': '#2a2a5a',
        },
        decoration: 'sparkle',
        cssClass: 'season-ano-nuevo',
    },

    // -------------------------------------------------------
    // Día de Reyes — Dorado, púrpura real
    // -------------------------------------------------------
    reyes: {
        name: 'Día de Reyes',
        colors: {
            '--bg-primary': '#0f0f1a',
            '--bg-secondary': '#1a1a3e',
            '--bg-tertiary': '#1a0f2e',
            '--bg-card': '#1e1e46',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#8888aa',
            '--text-muted': '#444466',
            '--accent-cyan': '#ffd700',
            '--accent-green': '#aa66ff',
            '--accent-orange': '#ffaa00',
            '--accent-red': '#ff4444',
            '--accent-pink': '#ff66ff',
            '--border-color': '#2a2a5a',
        },
        decoration: 'crown',
        cssClass: 'season-reyes',
    },
    // -------------------------------------------------------
    // San Valentín — Rojo, rosa, corazones
    // -------------------------------------------------------
    san_valentin: {
        name: 'San Valentín',
        colors: {
            '--bg-primary': '#1a0f0f',
            '--bg-secondary': '#2e1a1a',
            '--bg-tertiary': '#1a0f1a',
            '--bg-card': '#362020',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#aa8888',
            '--text-muted': '#663333',
            '--accent-cyan': '#ff6b9d',
            '--accent-green': '#ff1493',
            '--accent-orange': '#ffaa00',
            '--accent-red': '#ff2222',
            '--accent-pink': '#ff69b4',
            '--border-color': '#4a2a2a',
        },
        decoration: 'heart',
        cssClass: 'season-san-valentin',
    },

    // -------------------------------------------------------
    // Primavera — Verde fresco, rosa, amarillo
    // -------------------------------------------------------
    primavera: {
        name: 'Primavera',
        colors: {
            '--bg-primary': '#0f1a0f',
            '--bg-secondary': '#1a2e1a',
            '--bg-tertiary': '#0f1a1a',
            '--bg-card': '#1e361e',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#88aa88',
            '--text-muted': '#335533',
            '--accent-cyan': '#66ff99',
            '--accent-green': '#88ff44',
            '--accent-orange': '#ffcc00',
            '--accent-red': '#ff6666',
            '--accent-pink': '#ff99cc',
            '--border-color': '#2a4a2a',
        },
        decoration: 'flower',
        cssClass: 'season-primavera',
    },

    // -------------------------------------------------------
    // San Patricio — Verde esmeralda, dorado
    // -------------------------------------------------------
    san_patricio: {
        name: 'San Patricio',
        colors: {
            '--bg-primary': '#0f1a0f',
            '--bg-secondary': '#1a2e1a',
            '--bg-tertiary': '#0f1a0f',
            '--bg-card': '#1e361e',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#88aa88',
            '--text-muted': '#335533',
            '--accent-cyan': '#00ff88',
            '--accent-green': '#ffd700',
            '--accent-orange': '#ffaa00',
            '--accent-red': '#ff4444',
            '--accent-pink': '#ff66ff',
            '--border-color': '#2a4a2a',
        },
        decoration: 'clover',
        cssClass: 'season-san-patricio',
    },

    // -------------------------------------------------------
    // Día de la Tierra — Verde naturaleza, azul cielo
    // -------------------------------------------------------
    tierra: {
        name: 'Día de la Tierra',
        colors: {
            '--bg-primary': '#0f1a0f',
            '--bg-secondary': '#1a2e1a',
            '--bg-tertiary': '#0f1a2e',
            '--bg-card': '#1e362e',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#88aa88',
            '--text-muted': '#335533',
            '--accent-cyan': '#00d4ff',
            '--accent-green': '#44cc44',
            '--accent-orange': '#ffaa00',
            '--accent-red': '#ff4444',
            '--accent-pink': '#ff66ff',
            '--border-color': '#2a4a3a',
        },
        decoration: 'leaf',
        cssClass: 'season-tierra',
    },

    // -------------------------------------------------------
    // Día del Trabajo — Rojo, gris, azul acero
    // -------------------------------------------------------
    trabajo: {
        name: 'Día del Trabajo',
        colors: {
            '--bg-primary': '#0f0f1a',
            '--bg-secondary': '#1a1a2e',
            '--bg-tertiary': '#1a1a1a',
            '--bg-card': '#1e1e36',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#8888aa',
            '--text-muted': '#555555',
            '--accent-cyan': '#ff4444',
            '--accent-green': '#00ff88',
            '--accent-orange': '#ffaa00',
            '--accent-red': '#ff2222',
            '--accent-pink': '#ff66ff',
            '--border-color': '#2a2a4a',
        },
        cssClass: 'season-trabajo',
    },

    // -------------------------------------------------------
    // Día de las Madres — Rosa, lila, cálido
    // -------------------------------------------------------
    madres: {
        name: 'Día de las Madres',
        colors: {
            '--bg-primary': '#1a0f1a',
            '--bg-secondary': '#2e1a2e',
            '--bg-tertiary': '#1a0f1a',
            '--bg-card': '#362036',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#aa88aa',
            '--text-muted': '#553355',
            '--accent-cyan': '#ff88cc',
            '--accent-green': '#ff69b4',
            '--accent-orange': '#ffaa00',
            '--accent-red': '#ff4444',
            '--accent-pink': '#ff99ff',
            '--border-color': '#4a2a4a',
        },
        decoration: 'flower',
        cssClass: 'season-madres',
    },

    // -------------------------------------------------------
    // Verano — Cálido, amarillo sol, azul cielo
    // -------------------------------------------------------
    verano: {
        name: 'Verano',
        colors: {
            '--bg-primary': '#1a1a0f',
            '--bg-secondary': '#2e2e1a',
            '--bg-tertiary': '#1a1a0f',
            '--bg-card': '#36361e',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#aaaa88',
            '--text-muted': '#555533',
            '--accent-cyan': '#00d4ff',
            '--accent-green': '#00ff88',
            '--accent-orange': '#ff8800',
            '--accent-red': '#ff4444',
            '--accent-pink': '#ff66ff',
            '--border-color': '#4a4a2a',
        },
        decoration: 'sun',
        cssClass: 'season-verano',
    },

    // -------------------------------------------------------
    // Día del Padre — Azul, gris, tonos varoniles
    // -------------------------------------------------------
    padres: {
        name: 'Día del Padre',
        colors: {
            '--bg-primary': '#0f0f1a',
            '--bg-secondary': '#1a1a2e',
            '--bg-tertiary': '#0f1a2e',
            '--bg-card': '#1e1e36',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#8888aa',
            '--text-muted': '#444466',
            '--accent-cyan': '#4488ff',
            '--accent-green': '#00ff88',
            '--accent-orange': '#ffaa00',
            '--accent-red': '#ff4444',
            '--accent-pink': '#ff66ff',
            '--border-color': '#2a2a4a',
        },
        cssClass: 'season-padres',
    },

    // -------------------------------------------------------
    // Otoño — Naranja, marrón, dorado, hojas secas
    // -------------------------------------------------------
    otono: {
        name: 'Otoño',
        colors: {
            '--bg-primary': '#1a0f0a',
            '--bg-secondary': '#2e1a0f',
            '--bg-tertiary': '#1a0f0a',
            '--bg-card': '#362010',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#aa8866',
            '--text-muted': '#553322',
            '--accent-cyan': '#ff8800',
            '--accent-green': '#cc6600',
            '--accent-orange': '#ff6600',
            '--accent-red': '#ff4444',
            '--accent-pink': '#ff66ff',
            '--border-color': '#4a2a1a',
        },
        decoration: 'leaf',
        cssClass: 'season-otono',
    },

    // -------------------------------------------------------
    // Halloween — Naranja, negro, púrpura
    // -------------------------------------------------------
    halloween: {
        name: 'Halloween',
        colors: {
            '--bg-primary': '#0f0f0f',
            '--bg-secondary': '#1a1a1a',
            '--bg-tertiary': '#0f0f1a',
            '--bg-card': '#1e1e1e',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#888888',
            '--text-muted': '#444444',
            '--accent-cyan': '#ff6600',
            '--accent-green': '#ff8800',
            '--accent-orange': '#ff4400',
            '--accent-red': '#ff0000',
            '--accent-pink': '#aa44ff',
            '--border-color': '#2a2a2a',
        },
        decoration: 'pumpkin',
        cssClass: 'season-halloween',
    },

    // -------------------------------------------------------
    // Invierno — Azul hielo, blanco, plateado
    // -------------------------------------------------------
    invierno: {
        name: 'Invierno',
        colors: {
            '--bg-primary': '#0a0a1a',
            '--bg-secondary': '#0f0f2e',
            '--bg-tertiary': '#0a1a2e',
            '--bg-card': '#101036',
            '--text-primary': '#e0e0e0',
            '--text-secondary': '#8888aa',
            '--text-muted': '#444466',
            '--accent-cyan': '#88ddff',
            '--accent-green': '#aaddff',
            '--accent-orange': '#ffaa00',
            '--accent-red': '#ff4444',
            '--accent-pink': '#ff66ff',
            '--border-color': '#1a1a4a',
        },
        decoration: 'snowflake',
        cssClass: 'season-invierno',
    },

    // -------------------------------------------------------
    // Ecológico / DeepSeek — Verde naturaleza, azul profundo, tierra
    // Celebra la IA ecológica y sostenible
    // -------------------------------------------------------
    ecologico: {
        name: 'Ecológico',
        colors: {
            '--bg-primary': '#0a1a0f',
            '--bg-secondary': '#0d2e1a',
            '--bg-tertiary': '#0a2e15',
            '--bg-card': '#1a3620',
            '--text-primary': '#e0ffe0',
            '--text-secondary': '#88cc88',
            '--text-muted': '#446644',
            '--accent-cyan': '#00ffaa',
            '--accent-green': '#22c55e',
            '--accent-orange': '#ffaa22',
            '--accent-red': '#ff6666',
            '--accent-pink': '#ff88cc',
            '--border-color': '#2a4a2a',
        },
        decoration: 'leaf',
        cssClass: 'season-ecologico',
    },
};

// ============================================================
// Helpers
// ============================================================

// -----------------------------------------------------------
// Caché fusionada (built-ins + dinámicas) — recargable tras mutación
// -----------------------------------------------------------
// PALETTES es un Record<string, Palette> sin id; la caché arranca con una
// lista DERIVADA de entries (id + palette) y se sustituye por una NUEVA
// lista fusionada al hidratar/CRUD dinámico (B2). Nunca se muta PALETTES.

/** Lista de built-ins como PaletteDefinition (derivada de PALETTES, no hardcode). */
const builtinEntries: readonly PaletteDefinition[] = Object.entries(PALETTES).map(([id, palette]) => ({
    id,
    ...palette,
}));

let mergedPalettesCache: readonly PaletteDefinition[] = builtinEntries;

/** Sustituye la caché fusionada (usado por la hidratación del catálogo dinámico). */
export function setMergedPalettes(palettes: readonly PaletteDefinition[]): void {
    mergedPalettesCache = palettes;
}

/** Restaura la caché al catálogo built-in (reset/limpieza). */
export function resetMergedPalettes(): void {
    mergedPalettesCache = builtinEntries;
}

/** Lista completa de paletas (built-ins + dinámicas fusionadas). */
export function getFusedPalettes(): readonly PaletteDefinition[] {
    return mergedPalettesCache;
}

/** Paletas built-in como PaletteDefinition (para mergeCatalog desde el catálogo). */
export function builtinPaletteEntries(): readonly PaletteDefinition[] {
    return builtinEntries;
}

/** Todas las paletas del catálogo (built-ins + dinámicas) en orden canónico. */
export function getAllPalettes(): readonly PaletteDefinition[] {
    return mergedPalettesCache;
}

/** Keys (ids canónicos) de todas las paletas del catálogo fusionado. */
export function getPaletteKeys(): readonly string[] {
    return mergedPalettesCache.map((palette) => palette.id);
}

/**
 * Obtiene una paleta por su key (id). Resuelve contra la caché fusionada
 * (built-ins + dinámicas). Si no existe, devuelve la paleta default.
 */
export function getPalette(key: string): Palette {
    const palette = mergedPalettesCache.find((entry) => entry.id === key);
    return palette ?? PALETTES.default;
}

/**
 * Selector de los contenedores que reciben el branding de temporada.
 * El branding se aplica SOLO dentro del área de FLU (barra de voz + avatar),
 * no a toda la pantalla. Los elementos con esta clase reciben las variables
 * CSS de la paleta; el resto de la app conserva el tema oscuro base del :root.
 */
export const BRANDING_SCOPE_SELECTOR = '.flu-branding-scope';

/**
 * Devuelve los contenedores de branding activos. Si no hay ninguno (por
 * ejemplo, en pruebas unitarias), se usa el :root como respaldo para no
 * romper el comportamiento anterior.
 */
export function getBrandingScopes(): HTMLElement[] {
    const scopes = Array.from(document.querySelectorAll<HTMLElement>(BRANDING_SCOPE_SELECTOR));
    return scopes.length > 0 ? scopes : [document.documentElement];
}

/**
 * Alterna una clase CSS (ej. branding-ecologico) en todos los contenedores
 * de branding activos, de forma que los acentos no se filtren fuera del área
 * de FLU.
 */
export function toggleBrandingClass(className: string, force?: boolean): void {
    for (const scope of getBrandingScopes()) {
        scope.classList.toggle(className, force);
    }
}

/**
 * Aplica una paleta a los contenedores de branding (área de FLU) sobrescribiendo
 * las variables CSS correspondientes. Los contenedores quedan definidos por
 * BRANDING_SCOPE_SELECTOR; si no hay ninguno, se aplica al :root como respaldo.
 * Solo modifica colores — no toca tipografía ni espaciado.
 */
export function applyPaletteToCSS(palette: Palette): void {
    const colors = palette.colors;
    const scopes = getBrandingScopes();

    for (const scope of scopes) {
        for (const [key, value] of Object.entries(colors)) {
            scope.style.setProperty(key, value);
        }
    }

    // Agregar/quitar clase CSS de temporada para animaciones
    if (palette.cssClass) {
        // Remover clases de temporada anteriores
        for (const existing of getFusedPalettes()) {
            if (existing.cssClass) {
                for (const scope of scopes) {
                    scope.classList.remove(existing.cssClass);
                }
            }
        }
        for (const scope of scopes) {
            scope.classList.add(palette.cssClass);
        }
    }
}

/**
 * Restablece las variables CSS a la paleta default en el área de FLU.
 */
export function resetPaletteToDefault(): void {
    applyPaletteToCSS(PALETTES.default);
}
