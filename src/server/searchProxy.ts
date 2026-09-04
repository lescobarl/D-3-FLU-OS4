// ============================================================
// searchProxy.ts — Proxy del Buscador (F3 web + IA; F4 imágenes/vídeo)
// Mismo patrón que browserProxy:
//  1. Recibe q, lang, allowlist y los proveedores (config-driven)
//  2. Hace fetch server-side a cada proveedor (evita CORS)
//  3. Normaliza a SearchResult[], filtra por allowlist curada (solo web)
//     y aplica el tope por tipo (maxResultsByType.<tipo>)
// Registrado como:
//  /api/search/web    (GET) — búsqueda web + IA
//  /api/search/images (GET) — cuadrícula de imágenes (F4)
//  /api/search/video  (GET) — cuadrícula de vídeo (F4)
// ============================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  buildProviderRequest,
  capResults,
  filterNavigable,
  normalizeResults,
  resolveSearchProviders,
  type SearchConfig,
  type SearchResult,
  type SearchResultType,
} from '../core/search/searchSession';
import type { ResolvedLanguage } from '../core/search/searchLanguage';
import { acceptLanguageHeader } from '../core/search/searchLanguage';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RESULTS = 8;
const USER_AGENT = 'FLU-OS4-Curaduria/1.0 (modo lectura curada)';

function sendJson(res: ServerResponse, status: number, data: unknown) {
  try {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  } catch (err: any) {
    console.warn('[searchProxy] sendJson failed:', err?.message || err);
  }
}

function parseAllowlist(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Parsea los proveedores enviados por el cliente (JSON).
 * Acepta un array de SearchProviderConfig o { web: [...] }.
 * Devuelve undefined si no viene o es inválido (→ sin proveedores).
 */
function parseProviders(raw: string | null): SearchConfig['providers'] {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { web: parsed };
    if (parsed && typeof parsed === 'object') {
      return {
        web: Array.isArray(parsed.web) ? parsed.web : undefined,
        images: Array.isArray(parsed.images) ? parsed.images : undefined,
        video: Array.isArray(parsed.video) ? parsed.video : undefined,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

interface FetchOk {
  ok: true;
  json: unknown;
}

interface FetchError {
  ok: false;
  reason: 'fetch_error' | 'timeout';
  status?: number;
  detail?: string;
}

async function fetchProviderJson(
  url: string,
  timeoutMs: number,
  lang: string,
): Promise<FetchOk | FetchError> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        // F1 — Idioma: el proveedor recibe el idioma en el header para que
        // devuelva resultados en el idioma pedido (Wikipedia la usa).
        'Accept-Language': acceptLanguageHeader(lang),
      },
    });
    if (!response.ok) {
      return { ok: false, reason: 'fetch_error', status: response.status };
    }
    const json = await response.json();
    return { ok: true, json };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'fetch_error', detail: err?.message || 'Unknown error' };
  } finally {
    clearTimeout(timer);
  }
}

async function handleSearch(
  req: IncomingMessage,
  res: ServerResponse,
  type: SearchResultType = 'web',
): Promise<void> {
  const rawUrl = req.url || '';
  let parsed: URL;
  try {
    parsed = new URL(rawUrl, 'http://localhost');
  } catch {
    sendJson(res, 400, { ok: false, reason: 'invalid' });
    return;
  }

  const query = (parsed.searchParams.get('q') || '').trim();
  const lang = parsed.searchParams.get('lang') || 'es';
  const allowlist = parseAllowlist(parsed.searchParams.get('allowlist'));
  const timeoutMs = Number(parsed.searchParams.get('timeout')) || DEFAULT_TIMEOUT_MS;
  const maxResults = Number(parsed.searchParams.get('max')) || DEFAULT_MAX_RESULTS;
  const providersCfg = parseProviders(parsed.searchParams.get('providers'));
  // F5 — Modo seguro (safeSearch / supervisado): solo resultados permitidos.
  const safe = parsed.searchParams.get('safe') === '1';

  if (!query) {
    sendJson(res, 400, { ok: false, reason: 'invalid' });
    return;
  }

  const config: SearchConfig = {
    providers: providersCfg || { [type]: [] },
    maxResultsByType: { [type]: maxResults },
  };
  const providers = resolveSearchProviders(config, type);
  if (!providers.length) {
    sendJson(res, 200, { ok: true, query, lang, results: [] });
    return;
  }

  const requests = providers.map((provider) =>
    buildProviderRequest(provider, query, lang as ResolvedLanguage),
  );

  const settled = await Promise.all(
    requests.map(async (item) => {
      const fetched = await fetchProviderJson(
        item.url,
        item.timeoutMs ?? timeoutMs,
        lang,
      );
      if (!fetched.ok) {
        return { providerId: item.providerId, ok: false as const, reason: fetched.reason };
      }
      return { providerId: item.providerId, ok: true as const, json: fetched.json };
    }),
  );

  const results: SearchResult[] = [];
  for (const item of settled) {
    if (!item.ok) continue;
    const provider = providers.find((p) => p.id === item.providerId);
    const normalized = normalizeResults(item.json, item.providerId, lang as ResolvedLanguage, provider);
    const perMax = provider?.maxResults;
    results.push(...(perMax && perMax > 0 ? normalized.slice(0, perMax) : normalized));
  }

  // F4 — La allowlist curada solo restringe la navegación web; las
  // cuadrículas de imágenes/vídeo muestran todos los resultados.
  // F5 — En modo seguro (safeSearch / supervisado) se conservan SOLO los
  // resultados marcados como permitidos por la allowlist, en todos los tipos.
  const navigable = type === 'web' ? filterNavigable(results, allowlist) : results;
  const safeFiltered = safe
    ? filterNavigable(results, allowlist).filter((r) => r.allowed === true)
    : navigable;
  const capped = capResults(safeFiltered, maxResults);

  sendJson(res, 200, { ok: true, query, lang, results: capped });
}

export function createSearchProxy({ env = {} }: { env?: Record<string, string> } = {}) {
  void env;
  return {
    name: 'search-proxy',
    configureServer(server: any) {
      // F4 — Registro de las tres rutas (web, imágenes, vídeo) con el mismo
      // manejador parametrizado por tipo.
      const register = (path: string, type: SearchResultType) => {
        server.middlewares.use(path, async (req: any, res: any, next: any) => {
          if (req.method !== 'GET') return next();
          try {
            await handleSearch(req, res, type);
          } catch (err: any) {
            console.error(`[searchProxy] ${path} failed:`, err);
            sendJson(res, 500, {
              ok: false,
              reason: 'internal_error',
              detail: err?.message || 'Unknown error',
            });
          }
        });
      };
      register('/api/search/web', 'web');
      register('/api/search/images', 'images');
      register('/api/search/video', 'video');
    },
  };
}
