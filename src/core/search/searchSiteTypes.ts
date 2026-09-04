// ============================================================
// Search Site Types — Catálogo de sitios del Buscador (F2)
// ------------------------------------------------------------
// Tipos y funciones puras del catálogo de sitios de búsqueda.
// Regla #1: sin hardcode — los sitios built-in se derivan de
// FLU_CONFIG.browser.panel.tiles (única fuente de verdad), y los
// niveles/idiomas/categorías válidos también viven en la config.
// Las funciones puras (deriveAllowlist / deriveTiles) reemplazan
// las listas fijas: agregar un sitio al catálogo = aparece en voz,
// barra, tiles y resultados sin tocar código.
// ============================================================

import { FLU_CONFIG } from '../../voice/lib/fluConfig';
import { normalizeHost } from '../browser/browserSession';

/** Nivel de lectura de un sitio (equivalente a browser.readingLevels). */
export type SearchSiteLevel = 'simple' | 'detallado' | 'avanzado';

/** Idiomas en los que un sitio puede servirse (equivalente a browser.languages). */
export type SearchSiteLanguage = 'es' | 'en' | 'both';

/**
 * Sitio del catálogo de búsqueda.
 * El id canónico es `dominio` (normalizado) — no usa `id` para poder
 * fusionarse con mergeCatalog vía keyOf (F2).
 */
export interface SearchSite {
    dominio: string;
    label: string;
    categorias: string[];
    idiomas: SearchSiteLanguage[];
    nivel: SearchSiteLevel;
    aprobado: boolean;
}

/** Tile de inicio derivado del catálogo (mismo contrato que browser.panel.tiles). */
export interface SearchSiteTile {
    id: string;
    label: string;
    domain: string;
    category: string;
}

const browserConfig = ((FLU_CONFIG as any).browser || {}) as {
    readingLevels?: string[];
    languages?: string[];
    categories?: Record<string, string>;
    panel?: {
        tiles?: Array<{ id?: string; label?: string; domain?: string; category?: string }>;
    };
};

/** Niveles de lectura válidos (config-driven, con fallback seguro). */
export const SEARCH_SITE_LEVELS: readonly SearchSiteLevel[] = (browserConfig.readingLevels ??
    ['simple', 'detallado', 'avanzado']) as SearchSiteLevel[];

/** Idiomas válidos (config-driven, con fallback seguro). */
export const SEARCH_SITE_LANGUAGES: readonly SearchSiteLanguage[] = (browserConfig.languages ??
    ['es', 'en', 'both']) as SearchSiteLanguage[];

/** Claves de categoría válidas (config-driven). */
export const SEARCH_SITE_CATEGORY_KEYS: readonly string[] = Object.keys(browserConfig.categories ?? {});

/**
 * Sitios built-in derivados de FLU_CONFIG.browser.panel.tiles.
 * Única fuente de verdad: agregar un tile en config hace que el sitio
 * aparezca en el catálogo (voz, barra, tiles y resultados).
 */
export const BUILTIN_SEARCH_SITES: readonly SearchSite[] = (
    (browserConfig.panel?.tiles ?? []) as Array<{
        id?: string;
        label?: string;
        domain?: string;
        category?: string;
    }>
)
    .filter((tile) => tile && typeof tile.domain === 'string' && tile.domain.trim().length > 0)
    .map((tile) => ({
        dominio: normalizeHost(tile.domain as string),
        label: tile.label && tile.label.trim().length > 0 ? tile.label.trim() : (tile.domain as string),
        categorias: tile.category ? [tile.category] : [],
        idiomas: [],
        nivel: 'simple' as SearchSiteLevel,
        aprobado: true,
    }));

/** Filtra los sitios aprobados del catálogo que pertenecen a alguna categoría activa. */
export function filterApprovedSites(categorias: readonly string[], catalogo: readonly SearchSite[]): SearchSite[] {
    const active = new Set(categorias);
    return catalogo.filter((site) => site.aprobado && site.categorias.some((cat) => active.has(cat)));
}

/** Deriva la allowlist desde el catálogo: sitios aprobados de las categorías activas. */
export function deriveAllowlist(categorias: readonly string[], catalogo: readonly SearchSite[]): string[] {
    return filterApprovedSites(categorias, catalogo).map((site) => normalizeHost(site.dominio));
}

/** Deriva los tiles de inicio desde el catálogo (mismo contrato que panel.tiles). */
export function deriveTiles(categorias: readonly string[], catalogo: readonly SearchSite[]): SearchSiteTile[] {
    return filterApprovedSites(categorias, catalogo).map((site) => ({
        id: normalizeHost(site.dominio),
        label: site.label,
        domain: normalizeHost(site.dominio),
        category: site.categorias[0] || '',
    }));
}
