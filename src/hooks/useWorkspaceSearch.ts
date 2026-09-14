// ============================================================
// useWorkspaceSearch.ts — Búsqueda web + IA en el Pizarrón (F3/F4)
// ------------------------------------------------------------
// Estado y flujo del buscador del workspace:
//   1. `search()` dispara EN PARALELO los tres proxies de búsqueda
//      (/api/search/web, /api/search/images, /api/search/video) y
//      la IA (resumen "Puntos clave" vía /api/gemini/contract en
//      modo response con apiKey:'').
//   2. Si la IA falla o devuelve vacío, cae a un resumen
//      determinista construido desde los primeros resultados
//      (sin dummies, sin estados vacíos fantasma).
//   3. F4 — Las cuadrículas de imágenes y vídeo se llenan en
//      paralelo; solo la web alimenta el overview de IA.
// Regla #1: sin hardcode — endpoints, proveedores, tope y etiquetas
// viven en FLU_CONFIG.browser.search (config-driven).
// ============================================================
import { useCallback, useState } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import type {
    SearchResult,
    SearchProviderConfig,
    SearchResultType,
} from '../core/search/searchSession';
import {
    evalDailyUsage,
    loadDailyUsage,
    mergeSearchConfig,
    saveDailyUsage,
    type MergedSearchConfig,
    type SearchConfigOverrides,
    type SearchRuntimeConfig,
} from '../core/search/searchConfigOverrides';
import { dayKey } from '../core/browser/browserSession';

export type SearchLevel = 'simple' | 'detallado' | 'avanzado';

export interface WorkspaceSearchState {
    query: string;
    lang: 'es' | 'en';
    level: SearchLevel;
    loading: boolean;
    results: SearchResult[];
    /** F4 — Resultados de la cuadrícula de imágenes. */
    images: SearchResult[];
    /** F4 — Resultados de la cuadrícula de vídeo. */
    video: SearchResult[];
    aiOverview: string;
    error: string;
}

export interface UseWorkspaceSearchOptions {
    allowlist?: string[];
    /** F5 — Overrides del Centro de Control (proveedores, seguridad, límite). */
    overrides?: SearchConfigOverrides;
}

export interface UseWorkspaceSearchResult {
    state: WorkspaceSearchState;
    setQuery: (q: string) => void;
    setLang: (lang: 'es' | 'en') => void;
    setLevel: (level: SearchLevel) => void;
    /**
     * Ejecuta una búsqueda. Acepta una consulta override (string) o un objeto
     * `{ query?, lang? }` para inyectar consulta e idioma de forma atómica
     * (p.ej. desde un comando de voz NAVEGAR/BUSCAR que llega a la pestaña
     * Buscar). Si no se pasa nada, usa el estado actual.
     */
    search: (
        override?: string | { query?: string; lang?: 'es' | 'en' },
    ) => Promise<void>;
    reset: () => void;
}

/** Config de búsqueda base desde FLU_CONFIG.browser.search (sin hardcode). */
export function buildRuntimeConfig(): SearchRuntimeConfig {
    const cfg = FLU_CONFIG.browser?.search || {};
    const ui = cfg.ui || {};
    const endpoints = cfg.endpoints || {};
    const byType = cfg.maxResultsByType || {};
    const groups = cfg.providers || {};
    return {
        endpoints: {
            web: endpoints.web || cfg.endpoint || '/api/search/web',
            images: endpoints.images || '/api/search/images',
            video: endpoints.video || '/api/search/video',
        },
        timeoutMs: cfg.timeoutMs || 8000,
        maxResultsByType: {
            web: byType.web || 8,
            images: byType.images || 24,
            video: byType.video || 8,
        },
        aiEnabled: cfg.aiOverview?.enabled !== false,
        maxChars: cfg.aiOverview?.maxChars || 2000,
        overviewMaxResults: cfg.aiOverview?.overviewMaxResults || 8,
        // F5 — Proveedores RAW (sin filtrar): mergeSearchConfig los mergea y
        // recién después se filtra por `enabled` + endpoint, para que
        // deshabilitar un proveedor desde el Centro de Control sea efectivo.
        providers: {
            web: Array.isArray(groups.web) ? (groups.web as SearchProviderConfig[]) : [],
            images: Array.isArray(groups.images) ? (groups.images as SearchProviderConfig[]) : [],
            video: Array.isArray(groups.video) ? (groups.video as SearchProviderConfig[]) : [],
        },
        errorState: ui.errorState || 'No pude completar la búsqueda. Inténtalo de nuevo.',
        aiOverviewTitle: ui.aiOverviewTitle || 'Puntos clave',
        dailyLimitMessage:
            ui.dailyLimitMessage || 'Alcanzaste el límite diario de búsquedas. Volvé mañana.',
    };
}

/**
 * F5 — Resuelve la config efectiva: base + overrides del Centro de Control.
 * Aplica el merge sobre proveedores RAW y filtra recién después, de modo
 * que on/off de proveedores, seguridad y límite diario se reflejen siempre.
 */
export function resolveMergedSearchConfig(
    overrides?: SearchConfigOverrides,
): MergedSearchConfig {
    const merged = mergeSearchConfig(buildRuntimeConfig(), overrides);
    const resolve = (list: SearchProviderConfig[]) =>
        (Array.isArray(list) ? list : []).filter(
            (p: SearchProviderConfig) => p.enabled !== false && !!p.endpoint,
        );
    return {
        ...merged,
        providers: {
            web: resolve(merged.providers.web),
            images: resolve(merged.providers.images),
            video: resolve(merged.providers.video),
        },
    };
}

/**
 * Resumen determinista de respaldo (si la IA no está disponible):
 * usa los primeros resultados (título + fragmento) acotados a maxChars.
 */
function buildDeterministicOverview(
    results: SearchResult[],
    maxChars: number,
    maxResults = 8,
): string {
    if (!Array.isArray(results) || !results.length) return '';
    const parts = results.slice(0, maxResults).map((result, index) => {
        const head = result.title || '';
        return result.snippet
            ? `${index + 1}. ${head} — ${result.snippet}`
            : `${index + 1}. ${head}`;
    });
    let text = parts.join('\n');
    if (text.length > maxChars) {
        text = `${text.slice(0, Math.max(0, maxChars - 1))}…`;
    }
    return text;
}

/**
 * Pide a la IA los "Puntos clave" de la búsqueda (modo response, apiKey:'').
 * El servidor inyecta la API key desde .env (resolveServerApiKey) y
 * construye el prompt; devuelve '' si no hay respuesta utilizable.
 */
export async function fetchAiOverview(
    query: string,
    lang: 'es' | 'en',
    maxChars: number,
    title: string,
): Promise<string> {
    const systemPrompt =
        lang === 'en'
            ? `You are FLU. Provide the key points about: "${query}" in English, as short plain-text bullets, max ${maxChars} characters. No markdown.`
            : `Eres FLU. Entrega los ${title} sobre: "${query}" en español, como viñetas cortas en texto plano, máximo ${maxChars} caracteres. Sin markdown.`;
    try {
        const response = await fetch('/api/gemini/contract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mode: 'response',
                apiKey: '',
                transcript: query,
                language: lang,
                role: '',
                theme: 'search',
                history: [],
                personality: null,
                systemPrompt,
                userMessage: query,
                temperature: 0.3,
            }),
        });
        if (!response.ok) return '';
        const data = await response.json();
        return String(data.respuesta_voz || data.text || '').trim();
    } catch {
        return '';
    }
}

export interface ProviderError {
    provider: string;
    reason: string;
    status?: number;
}

export interface TypeFetchResult {
    ok: boolean;
    results: SearchResult[];
    /** Motivos de fallo por proveedor (diagnóstico; vacío si todo fue bien). */
    errors: ProviderError[];
}

/**
 * F4 — Trae un tipo de resultados (web/images/video) al proxy indicado.
 * Devuelve `{ ok, results }`; `ok` distingue el fallo del vacío para que
 * la web pueda marcar el estado de error sin que las cuadrículas rompan.
 *
 * IMPORTANTE (bug de cuadrículas vacías): el proxy `parseProviders` enruta
 * los proveedores por TIPO. Si se envía un array plano, lo interpreta como
 * `web` (parseProviders: `if (Array.isArray(parsed)) return { web: parsed }`),
 * por lo que las peticiones de imágenes/vídeo quedaban vacías. Por eso aquí
 * se envía SIEMPRE un objeto tipado `{ [type]: providers }` para que el proxy
 * los enrute al tipo correcto.
 */
export async function fetchTypeResults(
    endpoint: string,
    type: 'web' | 'images' | 'video',
    providers: SearchProviderConfig[],
    baseParams: URLSearchParams,
    timeoutMs: number,
    maxResults: number,
): Promise<TypeFetchResult> {
    const params = new URLSearchParams(baseParams.toString());
    if (providers.length) params.set('providers', JSON.stringify({ [type]: providers }));
    params.set('timeout', String(timeoutMs));
    params.set('max', String(maxResults));
    try {
        const response = await fetch(`${endpoint}?${params.toString()}`);
        const data = await response.json().catch(() => null);
        if (response.ok && data?.ok && Array.isArray(data.results)) {
            return {
                ok: true,
                results: data.results as SearchResult[],
                errors: Array.isArray(data.errors) ? (data.errors as ProviderError[]) : [],
            };
        }
        return { ok: false, results: [], errors: [] };
    } catch {
        return { ok: false, results: [], errors: [] };
    }
}

export function useWorkspaceSearch(
    options: UseWorkspaceSearchOptions = {},
): UseWorkspaceSearchResult {
    const [query, setQuery] = useState('');
    const [lang, setLang] = useState<'es' | 'en'>('es');
    const [level, setLevel] = useState<SearchLevel>('simple');
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<SearchResult[]>([]);
    const [images, setImages] = useState<SearchResult[]>([]);
    const [video, setVideo] = useState<SearchResult[]>([]);
    const [aiOverview, setAiOverview] = useState('');
    const [error, setError] = useState('');

    const search = useCallback(
        async (override?: string | { query?: string; lang?: 'es' | 'en' }) => {
            const cfg = resolveMergedSearchConfig(options.overrides);
            // Resuelve consulta e idioma de forma atómica: si el override es un
            // objeto, puede inyectar ambos (p.ej. comando de voz NAVEGAR/BUSCAR
            // que llega a la pestaña Buscar). Si no, usa el estado actual.
            const overrideQuery =
                typeof override === 'string' ? override : override?.query;
            const overrideLang =
                typeof override === 'object' && override ? override.lang : undefined;
            const q = String(overrideQuery ?? query).trim();
            const effectiveLang: 'es' | 'en' = overrideLang ?? lang;
            if (!q) return;

            setLoading(true);
            setError('');
            if (overrideQuery !== undefined) setQuery(q);
            if (overrideLang !== undefined) setLang(overrideLang);

            // F5 — Límite diario de búsquedas (0 = sin límite).
            if (cfg.dailyLimit > 0) {
                const usage = evalDailyUsage(loadDailyUsage(), cfg.dailyLimit, dayKey());
                if (usage.locked) {
                    setError(cfg.dailyLimitMessage);
                    setLoading(false);
                    return;
                }
                saveDailyUsage(usage.next);
            }

            const baseParams = new URLSearchParams();
            baseParams.set('q', q);
            baseParams.set('lang', effectiveLang);
            // F5 — Modo seguro (safeSearch / supervisado) → el proxy conserva
            // solo los resultados permitidos por la allowlist.
            if (cfg.effectiveSafe) baseParams.set('safe', '1');
            const allowlist = options.allowlist || [];
            if (allowlist.length) baseParams.set('allowlist', allowlist.join(','));

            // F4 — Los tres tipos se piden EN PARALELO; el overview de IA
            // solo depende de la web (resultados en el idioma pedido).
            const [webResult, imageResult, videoResult] = await Promise.all([
                fetchTypeResults(
                    cfg.endpoints.web,
                    'web',
                    cfg.providers.web,
                    baseParams,
                    cfg.timeoutMs,
                    cfg.maxResultsByType.web,
                ),
                fetchTypeResults(
                    cfg.endpoints.images,
                    'images',
                    cfg.providers.images,
                    baseParams,
                    cfg.timeoutMs,
                    cfg.maxResultsByType.images,
                ),
                fetchTypeResults(
                    cfg.endpoints.video,
                    'video',
                    cfg.providers.video,
                    baseParams,
                    cfg.timeoutMs,
                    cfg.maxResultsByType.video,
                ),
            ]);

            const proxyResults = webResult.results;
            let webError = false;
            if (!webResult.ok) {
                webError = true;
                setError(cfg.errorState);
            }

            // Diagnóstico visible: si algún proveedor falló (clave inválida, sin
            // crédito, modelo inexistente…), mostrarlo en vez de caer en silencio.
            const providerIssues = [
                ...webResult.errors,
                ...imageResult.errors,
                ...videoResult.errors,
            ];
            if (providerIssues.length > 0) {
                const detail = providerIssues
                    .map((e) => `${e.provider}${e.status ? ` ${e.status}` : ` ${e.reason}`}`)
                    .join(', ');
                setError(`Proveedores con error: ${detail}.`);
            }

            let aiText = '';
            if (cfg.aiEnabled && !webError) {
                aiText = await fetchAiOverview(q, effectiveLang, cfg.maxChars, cfg.aiOverviewTitle);
            }

            setResults(proxyResults);
            setImages(imageResult.results);
            setVideo(videoResult.results);
            setAiOverview(
                aiText ||
                    buildDeterministicOverview(
                        proxyResults,
                        cfg.maxChars,
                        cfg.overviewMaxResults,
                    ),
            );
            setLoading(false);
        },
        [query, lang, options.allowlist, options.overrides],
    );

    const reset = useCallback(() => {
        setQuery('');
        setLang('es');
        setLevel('simple');
        setResults([]);
        setImages([]);
        setVideo([]);
        setAiOverview('');
        setError('');
        setLoading(false);
    }, []);

    return {
        state: { query, lang, level, loading, results, images, video, aiOverview, error },
        setQuery,
        setLang,
        setLevel,
        search,
        reset,
    };
}
