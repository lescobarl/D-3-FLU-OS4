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
import { sendJson as sendJsonShared, type MiddlewareHost } from './httpJson';
import {
  buildProviderRequest,
  capResults,
  filterNavigable,
  normalizeResults,
  resolveSearchProviders,
  type ProviderRequest,
  type SearchConfig,
  type SearchProviderConfig,
  type SearchResult,
  type SearchResultType,
} from '../core/search/searchSession';
import type { ResolvedLanguage } from '../core/search/searchLanguage';
import { acceptLanguageHeader } from '../core/search/searchLanguage';
import { REQUEST_TIMEOUT_DEFAULTS } from '../core/config/sharedConfig';
import { logCaughtError } from '../lib/caughtError';


const defaultProxyMs = REQUEST_TIMEOUT_DEFAULTS.SEARCH_PROXY_MS;
const DEFAULT_MAX_RESULTS = 8;
const USER_AGENT = 'FLU-OS4-Curaduria/1.0 (modo lectura curada)';

/** Envía JSON preservando el prefijo de log de este proxy (dueño único en httpJson). */
const sendJson = (res: ServerResponse, status: number, data: unknown) =>
  sendJsonShared(res, status, data, '[searchProxy] sendJson failed:');

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
        logCaughtError('[catch] src/server/searchProxy.ts');
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
  request: ProviderRequest,
  timeoutMs: number,
  lang: string,
): Promise<FetchOk | FetchError> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      // F1 — Idioma: el proveedor recibe el idioma en el header para que
      // devuelva resultados en el idioma pedido (Wikipedia la usa).
      'Accept-Language': acceptLanguageHeader(lang),
      ...(request.headers || {}),
    };
    const init: RequestInit = {
      redirect: 'follow',
      signal: controller.signal,
      method: request.method,
      headers,
    };
    if (request.method === 'POST' && request.body !== undefined) {
      const hasContentType = Object.keys(headers).some(
        (name) => name.toLowerCase() === 'content-type',
      );
      if (!hasContentType) headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(request.body);
    }
    const response = await fetch(request.url, init);
    if (!response.ok) {
      // Motivo real del fallo (401 clave inválida, 402 sin crédito, 404 modelo,
      // 429 límite…). Se registra y se devuelve para no fallar en silencio.
      let detail = '';
      try {
        detail = (await response.text()).slice(0, 300);
      } catch {
        logCaughtError('[catch] src/server/searchProxy.ts');
        detail = '';
      }
      return { ok: false, reason: 'fetch_error', status: response.status, detail };
    }
    const json = await response.json();
    return { ok: true, json };
  } catch (err: unknown) {
        logCaughtError('[catch] src/server/searchProxy.ts', err);
    if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    const message = err && typeof err === 'object' && 'message' in err ? err.message : undefined;
    return { ok: false, reason: 'fetch_error', detail: String(message || 'Unknown error') };
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
        logCaughtError('[catch] src/server/searchProxy.ts');
    sendJson(res, 400, { ok: false, reason: 'invalid' });
    return;
  }

  const query = (parsed.searchParams.get('q') || '').trim();
  const lang = parsed.searchParams.get('lang') || 'es';
  const allowlist = parseAllowlist(parsed.searchParams.get('allowlist'));
  const timeoutMs = Number(parsed.searchParams.get('timeout')) || defaultProxyMs;
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
    sendJson(res, 200, { ok: true, query, lang, results: [], errors: [] });
    return;
  }

  // Cadena de respaldo por prioridad: los proveedores con la MISMA prioridad
  // se consultan en paralelo y se fusionan; si un escalón no devuelve
  // resultados, se pasa al siguiente. Sin `priority` todos comparten el 0
  // (comportamiento de fusión paralela previo).
  const entries: Array<{ provider: SearchProviderConfig; request: ProviderRequest }> =
    providers.map((provider) => ({
      provider,
      request: buildProviderRequest(provider, query, lang as ResolvedLanguage),
    }));

  const byPriority = new Map<number, typeof entries>();
  for (const entry of entries) {
    const priority = typeof entry.provider.priority === 'number' ? entry.provider.priority : 0;
    const group = byPriority.get(priority);
    if (group) {
      group.push(entry);
    } else {
      byPriority.set(priority, [entry]);
    }
  }

  let results: SearchResult[] = [];
  const providerErrors: Array<{ provider: string; reason: string; status?: number; detail?: string }> = [];
  const ordered = [...byPriority.entries()].sort((a, b) => a[0] - b[0]);
  for (const [, group] of ordered) {
    const settled = await Promise.all(
      group.map(async (entry) => {
        const fetched = await fetchProviderJson(
          entry.request,
          entry.request.timeoutMs ?? timeoutMs,
          lang,
        );
        if (!fetched.ok) {
          return { providerId: entry.request.providerId, ok: false as const, fetched };
        }
        return { providerId: entry.request.providerId, ok: true as const, json: fetched.json };
      }),
    );

    const groupResults: SearchResult[] = [];
    for (const item of settled) {
      if (!item.ok) {
        providerErrors.push({
          provider: item.providerId,
          reason: item.fetched.reason,
          status: item.fetched.status,
          detail: item.fetched.detail,
        });
        console.warn(
          `[searchProxy] proveedor "${item.providerId}" falló: ${item.fetched.reason}` +
            `${item.fetched.status ? ` ${item.fetched.status}` : ''}` +
            `${item.fetched.detail ? ` :: ${item.fetched.detail}` : ''}`,
        );
        continue;
      }
      const provider = group.find((entry) => entry.request.providerId === item.providerId)?.provider;
      const normalized = normalizeResults(item.json, item.providerId, lang as ResolvedLanguage, provider);
      const perMax = provider?.maxResults;
      groupResults.push(...(perMax && perMax > 0 ? normalized.slice(0, perMax) : normalized));
    }

    if (groupResults.length > 0) {
      results = groupResults;
      break;
    }
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

  sendJson(res, 200, { ok: true, query, lang, results: capped, errors: providerErrors });
}

export function createSearchProxy({ env = {} }: { env?: Record<string, string> } = {}) {
  void env;
  return {
    name: 'search-proxy',
    configureServer(server: MiddlewareHost) {
      // F4 — Registro de las tres rutas (web, imágenes, vídeo) con el mismo
      // manejador parametrizado por tipo.
      const register = (path: string, type: SearchResultType) => {
        server.middlewares.use(path, async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          if (req.method !== 'GET') return next();
          try {
            await handleSearch(req, res, type);
          } catch (err: unknown) {
            logCaughtError(`[searchProxy] ${path} failed:`, err);
            const message = err && typeof err === 'object' && 'message' in err ? err.message : undefined;
            sendJson(res, 500, {
              ok: false,
              reason: 'internal_error',
              detail: String(message || 'Unknown error'),
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
