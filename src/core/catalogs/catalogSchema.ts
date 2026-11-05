// ============================================================
// Catalog Schema — Validadores por tipo de catálogo dinámico
// ------------------------------------------------------------
// Validación de payloads antes de persistir (Regla #1: sin
// hardcode; cada catálogo declara su esquema y sus ids reservados).
// ============================================================

import {
    ENVIRONMENT_CSS_VAR_KEYS,
    ENVIRONMENT_DECORATIONS,
    ENVIRONMENT_TAB_IDS,
    ENVIRONMENTS,
    type EnvironmentDefinition,
    type EnvironmentTabId,
} from '../environments/environmentRegistry';
import { PALETTE_COLOR_KEYS, PALETTES, type PaletteDefinition } from '../branding/seasonalPalettes';
import {
    BUILTIN_SEARCH_SITES,
    SEARCH_SITE_CATEGORY_KEYS,
    SEARCH_SITE_LANGUAGES,
    SEARCH_SITE_LEVELS,
    type SearchSite,
} from '../search/searchSiteTypes';
import type { CatalogSchema } from './catalogRegistry';

// ------------------------------------------------------------
// Validadores base
// ------------------------------------------------------------

/** Slug: minúsculas, dígitos y guiones simples (sin guiones al inicio/fin). */
export function isSlug(value: unknown): value is string {
    return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

/** Color CSS: hex (#rgb/#rgba/#rrggbb/#rrggbbaa) o rgb()/rgba(). */
export function isCssColor(value: unknown): value is string {
    if (typeof value !== 'string' || !value.trim()) return false;
    const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
    const rgb = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/.test(value);
    return hex || rgb;
}

/** Color hex estricto: solo #RGB/#RRGGBB/#RRGGBBAA (spec de paletas #RRGGBB). */
export function isHexColor(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value.trim())
    );
}

/** Texto no vacío (trim). */
export function isNonEmptyText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

/** Host válido: etiquetas separadas por punto (dominios normalizados). */
export function isHost(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(value.trim())
    );
}

/** Lista no vacía de pestañas de la shell (⊆ ENVIRONMENT_TAB_IDS). */
export function isTabIdList(value: unknown): value is EnvironmentTabId[] {
    return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((v) => (ENVIRONMENT_TAB_IDS as readonly string[]).includes(v as string))
    );
}

/** Decoración: null (la temporada estacional decide) o una decoración soportada. */
export function isDecorationKey(value: unknown): boolean {
    return (
        value === null ||
        (typeof value === 'string' && (ENVIRONMENT_DECORATIONS as readonly string[]).includes(value))
    );
}

// ------------------------------------------------------------
// Esquema de ambientes (1A)
// ------------------------------------------------------------

export const ambienteSchema: CatalogSchema<EnvironmentDefinition> = {
    idOf: (data) => data.id,
    reservedIds: new Set(ENVIRONMENTS.map((ambiente) => ambiente.id)),
    validate: (data) => {
        if (!data || typeof data !== 'object') return 'payload inválido';
        if (!isSlug(data.id)) return 'id debe ser un slug (minúsculas, dígitos y guiones)';
        if (!isNonEmptyText(data.nombre)) return 'nombre es obligatorio';
        if (!isNonEmptyText(data.tagline)) return 'tagline es obligatorio';
        if (!isNonEmptyText(data.icono)) return 'icono es obligatorio';

        if (!data.bienvenida || !isNonEmptyText(data.bienvenida.es) || !isNonEmptyText(data.bienvenida.en)) {
            return 'bienvenida.es y bienvenida.en son obligatorias';
        }
        if (
            !data.frasesActivacion ||
            !Array.isArray(data.frasesActivacion.es) ||
            data.frasesActivacion.es.length === 0 ||
            !data.frasesActivacion.es.every(isNonEmptyText) ||
            !Array.isArray(data.frasesActivacion.en) ||
            data.frasesActivacion.en.length === 0 ||
            !data.frasesActivacion.en.every(isNonEmptyText)
        ) {
            return 'frasesActivacion.es y frasesActivacion.en deben contener al menos una frase';
        }

        if (!data.tema || typeof data.tema !== 'object' || !data.tema.vars || typeof data.tema.vars !== 'object') {
            return 'tema.vars es obligatorio';
        }
        const vars = data.tema.vars as Record<string, unknown>;
        for (const [key, value] of Object.entries(vars)) {
            if (!(ENVIRONMENT_CSS_VAR_KEYS as readonly string[]).includes(key)) {
                return `tema.vars contiene clave no permitida: ${key}`;
            }
            if (!isCssColor(value)) return `tema.vars.${key} debe ser un color CSS válido`;
        }
        if (!isDecorationKey(data.tema.decoracion)) {
            return 'tema.decoracion debe ser null o una decoración soportada';
        }
        if (typeof data.tema.capVisible !== 'boolean') return 'tema.capVisible debe ser booleano';

        if (!data.pestanas || !isTabIdList(data.pestanas.mostrar)) {
            return 'pestanas.mostrar debe ser una lista no vacía de pestañas válidas';
        }

        if (!data.voz || typeof data.voz !== 'object' || typeof data.voz.instrucciones !== 'string') {
            return 'voz.instrucciones debe ser texto (vacío = sin instrucciones de rol)';
        }
        if (!data.voz.frases || !Array.isArray(data.voz.frases.es) || !Array.isArray(data.voz.frases.en)) {
            return 'voz.frases.es y voz.frases.en son obligatorias';
        }
        return null;
    },
};

// ------------------------------------------------------------
// Esquema de paletas (1B)
// ------------------------------------------------------------

export const paletaSchema: CatalogSchema<PaletteDefinition> = {
    idOf: (data) => data.id,
    reservedIds: new Set(Object.keys(PALETTES)),
    validate: (data) => {
        if (!data || typeof data !== 'object') return 'payload inválido';
        if (!isSlug(data.id)) return 'id debe ser un slug (minúsculas, dígitos y guiones)';
        if (!isNonEmptyText(data.name)) return 'name es obligatorio';

        if (!data.colors || typeof data.colors !== 'object') return 'colors es obligatorio';
        const colors = data.colors as Record<string, unknown>;
        const colorKeys = PALETTE_COLOR_KEYS as readonly string[];
        const presentKeys = Object.keys(colors);
        if (presentKeys.length !== colorKeys.length) {
            return 'colors debe contener exactamente las claves CSS de una paleta';
        }
        for (const key of colorKeys) {
            if (!(key in colors)) return 'colors debe contener exactamente las claves CSS de una paleta';
            if (!isHexColor(colors[key])) return `colors.${key} debe ser un color #RRGGBB válido`;
        }
        for (const key of presentKeys) {
            if (!colorKeys.includes(key)) return 'colors debe contener exactamente las claves CSS de una paleta';
        }

        if (data.decoration !== undefined && !isNonEmptyText(data.decoration)) {
            return 'decoration debe ser un texto no vacío';
        }
        if (data.cssClass !== undefined && !isNonEmptyText(data.cssClass)) {
            return 'cssClass debe ser un texto no vacío';
        }
        return null;
    },
};

// ------------------------------------------------------------
// Esquema de sitios de búsqueda (F2)
// ------------------------------------------------------------

export const searchSiteSchema: CatalogSchema<SearchSite> = {
    idOf: (data) => data.dominio,
    reservedIds: new Set(BUILTIN_SEARCH_SITES.map((site) => site.dominio)),
    validate: (data) => {
        if (!data || typeof data !== 'object') return 'payload inválido';
        if (!isHost(data.dominio)) return 'dominio debe ser un host válido (ej. wikipedia.org)';
        if (!isNonEmptyText(data.label)) return 'label es obligatorio';

        if (!data.categorias || !Array.isArray(data.categorias) || data.categorias.length === 0) {
            return 'categorias debe contener al menos una categoría';
        }
        for (const cat of data.categorias) {
            if (!(SEARCH_SITE_CATEGORY_KEYS as readonly string[]).includes(cat)) {
                return `categorias contiene una categoría no válida: ${cat}`;
            }
        }

        if (!data.idiomas || !Array.isArray(data.idiomas)) return 'idiomas debe ser un arreglo';
        for (const lang of data.idiomas) {
            if (!(SEARCH_SITE_LANGUAGES as readonly string[]).includes(lang)) {
                return `idiomas contiene un idioma no válido: ${lang}`;
            }
        }

        if (!(SEARCH_SITE_LEVELS as readonly string[]).includes(data.nivel)) {
            return `nivel debe ser uno de: ${SEARCH_SITE_LEVELS.join(', ')}`;
        }
        if (typeof data.aprobado !== 'boolean') return 'aprobado debe ser booleano';
        return null;
    },
};
