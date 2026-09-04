// ============================================================
// searchSession.ts — Lógica pura del Buscador (web + IA, F3;
// imágenes y vídeo, F4)
// ------------------------------------------------------------
// Capa sin efectos (ni DOM ni red) para construir peticiones a los
// proveedores (web: Wikipedia + DuckDuckGo; F4: Wikimedia Commons,
// YouTube, Invidious), normalizar sus respuestas a un único SearchResult
// y marcar qué resultados son navegables según la allowlist curada.
// Separada del proxy y de la UI para poder testearse de forma unitaria.
// Regla #1: sin hardcode — los proveedores, etiquetas y límites llegan
// desde FLU_CONFIG.browser.search (config-driven) y las URLs de
// artículo/embed/watch se construyen desde plantillas del proveedor.
// ============================================================
import { isDomainAllowed, normalizeHost } from '../browser/browserSession';
import type { ResolvedLanguage } from './searchLanguage';

/** Resultado unificado de búsqueda (cualquier proveedor). */
export interface SearchResult {
    title: string;
    snippet: string;
    url: string;
    host: string;
    source: string;
    /** ¿El host está dentro de la allowlist curada? (navegable) */
    allowed: boolean;
    /** Tipo del resultado (F4: solo lo fijan las cuadrículas). */
    type?: SearchResultType;
    /** URL de miniatura (imágenes y vídeo). */
    thumbnail?: string;
    /** URL de iframe/embed (vídeo). */
    embedUrl?: string;
    /** URL del archivo original (imágenes). */
    fileUrl?: string;
    width?: number;
    height?: number;
}

/** Tipos de proveedor soportados (F3: web; F4: images/video). */
export type SearchResultType = 'web' | 'images' | 'video';

/** Proveedor de búsqueda configurable (FLU_CONFIG.browser.search.providers). */
export interface SearchProviderConfig {
    id?: string;
    label?: string;
    enabled?: boolean;
    endpoint?: string;
    articleUrlTemplate?: string;
    /** Plantilla de URL embed (F4 vídeo): rellena {id}. */
    embedUrlTemplate?: string;
    /** Plantilla de URL de reproducción (F4 vídeo): rellena {id}. */
    watchUrlTemplate?: string;
    key?: string | null;
    maxResults?: number;
    timeoutMs?: number;
}

/** Etiquetas de la UI del buscador (config-driven, sin hardcode). */
export interface SearchUiLabels {
    searchLabel?: string;
    placeholder?: string;
    languageLabel?: string;
    levelLabel?: string;
    level_simple?: string;
    level_detallado?: string;
    level_avanzado?: string;
    aiOverviewTitle?: string;
    readLabel?: string;
    listenLabel?: string;
    tabAll?: string;
    tabImages?: string;
    tabVideo?: string;
    allowedBadge?: string;
    blockedBadge?: string;
    blockedSuffix?: string;
    openLabel?: string;
    emptyState?: string;
    errorState?: string;
    loadingLabel?: string;
    sourceWikipedia?: string;
    sourceDuckDuckGo?: string;
    resultTitle?: string;
    respuesta_ia_sin_resultados?: string;
    voiceNoQuery?: string;
    voiceResultCount?: string;
    [key: string]: string | undefined;
}

/** Configuración de búsqueda (FLU_CONFIG.browser.search). */
export interface SearchConfig {
    endpoint?: string;
    timeoutMs?: number;
    providers?: {
        web?: SearchProviderConfig[];
        images?: SearchProviderConfig[];
        video?: SearchProviderConfig[];
    };
    maxResultsByType?: Partial<Record<SearchResultType, number>>;
    aiOverview?: { enabled?: boolean; maxChars?: number };
    offlineFallback?: string;
    ui?: SearchUiLabels;
}

/** Petición construida para un proveedor (lista para el proxy). */
export interface ProviderRequest {
    url: string;
    lang: ResolvedLanguage;
    providerId: string;
    maxResults: number;
    timeoutMs?: number;
}

/** Respuesta normalizada de búsqueda. */
export interface SearchResponse {
    ok: boolean;
    query: string;
    lang: ResolvedLanguage;
    results: SearchResult[];
    reason?: 'fetch_error' | 'timeout' | 'internal_error';
    detail?: string;
}

/**
 * Resuelve la lista de proveedores habilitados para un tipo de búsqueda.
 * Filtra los que están deshabilitados o sin endpoint configurado.
 */
export function resolveSearchProviders(
    config: SearchConfig | undefined,
    type: SearchResultType = 'web',
): SearchProviderConfig[] {
    const group = config?.providers?.[type];
    if (!Array.isArray(group)) return [];
    return group.filter(
        (provider) => provider && provider.enabled !== false && !!provider.endpoint,
    );
}

/**
 * Construye la URL de petición reemplazando los placeholders del endpoint:
 * - {q}    → consulta URL-encoded (encodeURIComponent).
 * - {lang} → idioma efectivo (es/en), sin codificar (vale para el
 *            subdominio de Wikipedia y para el parámetro kl de DDG).
 * - {key}  → API key del proveedor (F4: YouTube), URL-encoded.
 * - {n}    → maxResults del proveedor (F4: YouTube).
 */
export function buildProviderRequest(
    provider: SearchProviderConfig,
    query: string,
    lang: ResolvedLanguage,
): ProviderRequest {
    const q = String(query || '').trim();
    const maxResults = typeof provider.maxResults === 'number' ? provider.maxResults : 5;
    const url = String(provider.endpoint || '')
        .replace(/\{q\}/g, encodeURIComponent(q))
        .replace(/\{lang\}/g, lang)
        .replace(/\{key\}/g, encodeURIComponent(String(provider.key || '')))
        .replace(/\{n\}/g, String(maxResults));
    return {
        url,
        lang,
        providerId: String(provider.id || ''),
        maxResults,
        timeoutMs: provider.timeoutMs,
    };
}

/** Elimina etiquetas HTML y decodifica entidades básicas de un snippet. */
function stripHtml(html: string): string {
    return String(html || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#0?39;/gi, "'")
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
        // &amp; al final: evita doble decodificación (p.ej. "&amp;lt;" → "&lt;").
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .replace(/\s+([.,;:!?])/g, '$1')
        .trim();
}

/** Extrae el hostname de una URL (devuelve '' si no se puede parsear). */
function extractHost(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return '';
    }
}

/** Construye la URL de artículo de Wikipedia desde la config del proveedor. */
function buildWikiArticleUrl(
    title: string,
    lang: ResolvedLanguage,
    provider?: SearchProviderConfig,
): string {
    const titlePart = encodeURIComponent(title.replace(/\s+/g, '_'));
    const template = String(provider?.articleUrlTemplate || '').trim();
    if (template) {
        return template.replace(/\{lang\}/g, lang).replace(/\{title\}/g, titlePart);
    }
    // Sin plantilla: deriva el origen desde el endpoint de la API (config-driven).
    const endpoint = String(provider?.endpoint || '').replace(/\{lang\}/g, lang);
    const origin = endpoint.split('/w/api.php')[0];
    return origin ? `${origin}/wiki/${titlePart}` : '';
}

/**
 * Deriva el origen (esquema + host) de un endpoint de proveedor.
 * Config-driven: evita URLs hardcodeadas fuera de la config (Regla #1).
 * Devuelve '' si el endpoint no es una URL parseable.
 */
function deriveOrigin(endpoint: string): string {
    const clean = String(endpoint || '')
        .replace(/\{lang\}/g, 'es')
        .replace(/\{key\}/g, '')
        .split('?')[0];
    try {
        return new URL(clean).origin;
    } catch {
        return '';
    }
}

/**
 * Normaliza la respuesta de la API de Wikimedia Commons (generator=search,
 * prop=imageinfo | videoinfo). Comparte estructura para imágenes y vídeo
 * (F4): lee `query.pages` (objeto por pageid) y el info[0] de cada página.
 */
function normalizeCommonsMedia(
    raw: unknown,
    type: 'images' | 'video',
    provider?: SearchProviderConfig,
): SearchResult[] {
    const pages = (raw as { query?: { pages?: Record<string, unknown> } })?.query?.pages;
    if (!pages || typeof pages !== 'object') return [];
    const results: SearchResult[] = [];
    const infoKey = type === 'images' ? 'imageinfo' : 'videoinfo';
    const origin = deriveOrigin(String(provider?.endpoint || ''));
    for (const pageId of Object.keys(pages)) {
        const page = pages[pageId] as {
            title?: string;
            imageinfo?: Array<Record<string, unknown>>;
            videoinfo?: Array<Record<string, unknown>>;
        };
        if (!page || typeof page !== 'object') continue;
        const info = (page[infoKey] || [])[0];
        if (!info || typeof info !== 'object') continue;
        const fileUrl = String(info.url || '').trim();
        if (!fileUrl) continue;
        const rawTitle = String(page.title || '').trim();
        const title = rawTitle.replace(/^File:\s*/i, '').trim() || fileUrl;
        const pageUrl = origin
            ? `${origin}/wiki/${encodeURIComponent(rawTitle.replace(/\s+/g, '_'))}`
            : '';
        results.push({
            title,
            snippet: String(info.descriptionurl || '').trim(),
            url: pageUrl || fileUrl,
            host: extractHost(pageUrl) || extractHost(fileUrl),
            source: type === 'images' ? 'commons' : 'commons-video',
            allowed: true,
            type,
            thumbnail: String(info.thumburl || info.url || '').trim(),
            fileUrl,
            width: typeof info.width === 'number' ? (info.width as number) : undefined,
            height: typeof info.height === 'number' ? (info.height as number) : undefined,
        });
    }
    return results;
}

/**
 * Normaliza la respuesta de YouTube Data API v3 (search.list).
 * El embed/watch se construyen desde las plantillas del proveedor ({id})
 * o se deriva el origen del endpoint si no hay plantillas.
 */
function normalizeYouTube(raw: unknown, provider?: SearchProviderConfig): SearchResult[] {
    const items = (raw as { items?: unknown[] })?.items;
    if (!Array.isArray(items)) return [];
    const results: SearchResult[] = [];
    const origin = deriveOrigin(String(provider?.endpoint || ''));
    const embedTemplate = String(provider?.embedUrlTemplate || '').trim();
    const watchTemplate = String(provider?.watchUrlTemplate || '').trim();
    for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const record = item as {
            id?: { videoId?: string };
            snippet?: {
                title?: string;
                description?: string;
                thumbnails?: { medium?: { url?: string } };
            };
        };
        const videoId = record.id?.videoId;
        if (!videoId) continue;
        const videoIdEnc = encodeURIComponent(videoId);
        const embedUrl = embedTemplate
            ? embedTemplate.replace(/\{id\}/g, videoIdEnc)
            : origin
                ? `${origin}/embed/${videoIdEnc}`
                : '';
        const watchUrl = watchTemplate
            ? watchTemplate.replace(/\{id\}/g, videoIdEnc)
            : origin
                ? `${origin}/watch?v=${videoIdEnc}`
                : '';
        const title = String(record.snippet?.title || '').trim() || videoId;
        results.push({
            title,
            snippet: stripHtml(String(record.snippet?.description || '')),
            url: watchUrl || embedUrl,
            host: extractHost(watchUrl) || extractHost(embedUrl),
            source: 'youtube',
            allowed: true,
            type: 'video',
            thumbnail: String(record.snippet?.thumbnails?.medium?.url || '').trim(),
            embedUrl,
        });
    }
    return results;
}

/**
 * Normaliza la respuesta de Invidious (/api/v1/search, array de vídeos).
 * Filtra los ítems cuyo type no sea 'video' y construye embed/watch desde
 * las plantillas del proveedor o el origen del endpoint.
 */
function normalizeInvidious(raw: unknown, provider?: SearchProviderConfig): SearchResult[] {
    if (!Array.isArray(raw)) return [];
    const results: SearchResult[] = [];
    const origin = deriveOrigin(String(provider?.endpoint || ''));
    const embedTemplate = String(provider?.embedUrlTemplate || '').trim();
    const watchTemplate = String(provider?.watchUrlTemplate || '').trim();
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const record = item as {
            type?: string;
            videoId?: string;
            title?: string;
            description?: string;
            videoThumbnails?: Array<{ url?: string }>;
        };
        if (record.type && record.type !== 'video') continue;
        const videoId = record.videoId;
        if (!videoId) continue;
        const videoIdEnc = encodeURIComponent(videoId);
        const embedUrl = embedTemplate
            ? embedTemplate.replace(/\{id\}/g, videoIdEnc)
            : origin
                ? `${origin}/embed/${videoIdEnc}`
                : '';
        const watchUrl = watchTemplate
            ? watchTemplate.replace(/\{id\}/g, videoIdEnc)
            : origin
                ? `${origin}/watch?v=${videoIdEnc}`
                : '';
        const title = String(record.title || '').trim() || videoId;
        results.push({
            title,
            snippet: stripHtml(String(record.description || '')),
            url: watchUrl || embedUrl,
            host: extractHost(watchUrl) || extractHost(embedUrl),
            source: 'invidious',
            allowed: true,
            type: 'video',
            thumbnail: String(record.videoThumbnails?.[0]?.url || '').trim(),
            embedUrl,
        });
    }
    return results;
}

/** Normaliza la respuesta de la API de Wikipedia (action=query&list=search). */
function normalizeWikipedia(
    raw: unknown,
    lang: ResolvedLanguage,
    provider?: SearchProviderConfig,
): SearchResult[] {
    const list = (raw as { query?: { search?: unknown[] } })?.query?.search;
    if (!Array.isArray(list)) return [];
    const results: SearchResult[] = [];
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const record = item as { title?: string; snippet?: string };
        const title = String(record.title || '').trim();
        if (!title) continue;
        const url = buildWikiArticleUrl(title, lang, provider);
        results.push({
            title,
            snippet: stripHtml(String(record.snippet || '')),
            url,
            host: extractHost(url) || `${lang}.wikipedia.org`,
            source: 'wikipedia',
            allowed: true,
        });
    }
    return results;
}

/** Empuja un tópico de DDG (directo o sub-tópico) al resultado. */
function pushTopic(out: SearchResult[], topic: unknown): void {
    if (!topic || typeof topic !== 'object') return;
    const record = topic as { FirstURL?: string; Text?: string };
    const url = String(record.FirstURL || '').trim();
    const text = String(record.Text || '').trim();
    if (!url || !text) return;
    const sep = text.indexOf(' - ');
    const title = (sep > 0 ? text.slice(0, sep) : text).trim();
    const snippet = sep > 0 ? text.slice(sep + 3).trim() : '';
    out.push({
        title,
        snippet,
        url,
        host: extractHost(url),
        source: 'duckduckgo',
        allowed: true,
    });
}

/** Normaliza la respuesta de la API IA de DuckDuckGo (Abstract + RelatedTopics). */
function normalizeDuckDuckGo(raw: unknown): SearchResult[] {
    if (!raw || typeof raw !== 'object') return [];
    const record = raw as {
        Heading?: string;
        AbstractText?: string;
        AbstractURL?: string;
        RelatedTopics?: unknown[];
    };
    const results: SearchResult[] = [];
    const abstractTitle = String(record.Heading || '').trim();
    const abstractUrl = String(record.AbstractURL || '').trim();
    const abstractText = stripHtml(String(record.AbstractText || ''));
    if (abstractUrl && (abstractText || abstractTitle)) {
        results.push({
            title: abstractTitle || abstractUrl,
            snippet: abstractText,
            url: abstractUrl,
            host: extractHost(abstractUrl),
            source: 'duckduckgo',
            allowed: true,
        });
    }
    if (Array.isArray(record.RelatedTopics)) {
        for (const topic of record.RelatedTopics) {
            if (topic && typeof topic === 'object' && Array.isArray((topic as { Topics?: unknown[] }).Topics)) {
                for (const sub of (topic as { Topics: unknown[] }).Topics) {
                    pushTopic(results, sub);
                }
            } else {
                pushTopic(results, topic);
            }
        }
    }
    return results;
}

/**
 * Normaliza la respuesta cruda de un proveedor a SearchResult[] unificados.
 * Soporta los proveedores sin clave de F3 (wikipedia + duckduckgo) y los de
 * F4 (Wikimedia Commons imágenes/vídeo, YouTube, Invidious). El proveedor
 * (opcional) aporta plantillas de URL de artículo/embed/watch (config-driven).
 */
export function normalizeResults(
    raw: unknown,
    providerId: string,
    lang: ResolvedLanguage,
    provider?: SearchProviderConfig,
): SearchResult[] {
    if (providerId === 'wikipedia') return normalizeWikipedia(raw, lang, provider);
    if (providerId === 'duckduckgo') return normalizeDuckDuckGo(raw);
    if (providerId === 'commons') return normalizeCommonsMedia(raw, 'images', provider);
    if (providerId === 'commons-video') return normalizeCommonsMedia(raw, 'video', provider);
    if (providerId === 'youtube') return normalizeYouTube(raw, provider);
    if (providerId === 'invidious') return normalizeInvidious(raw, provider);
    return [];
}

/**
 * Marca la navegabilidad de cada resultado contra la allowlist curada.
 * - allowlist vacía → todo se considera navegable (sin restricción).
 * - con allowlist → `allowed` = isDomainAllowed(host, allowlist).
 * Devuelve los mismos resultados con el flag `allowed` actualizado.
 */
export function filterNavigable(
    results: SearchResult[],
    allowlist: string[],
): SearchResult[] {
    const list = (allowlist || [])
        .map((entry) => normalizeHost(String(entry || '')))
        .filter(Boolean);
    if (!list.length) {
        return (results || []).map((r) => ({ ...r, allowed: true }));
    }
    return (results || []).map((r) => ({
        ...r,
        allowed: isDomainAllowed(r.host, list),
    }));
}

/** Solo los resultados navegables (para el flujo por voz curado). */
export function navigableResults(results: SearchResult[]): SearchResult[] {
    return (results || []).filter((r) => r.allowed);
}

/** Aplica el tope de resultados por tipo (maxResultsByType). */
export function capResults(results: SearchResult[], max: number | undefined): SearchResult[] {
    if (!Array.isArray(results) || typeof max !== 'number' || max <= 0) {
        return Array.isArray(results) ? results : [];
    }
    return results.slice(0, max);
}

/** Mensaje offline sin resultados (config-driven, sin hardcode). */
export function buildOfflineFallback(
    query: string,
    lang: ResolvedLanguage,
    labels: SearchUiLabels = {},
): string {
    void query;
    void lang;
    return (
        labels.respuesta_ia_sin_resultados ||
        labels.emptyState ||
        'No encontré resultados para esa búsqueda.'
    );
}
