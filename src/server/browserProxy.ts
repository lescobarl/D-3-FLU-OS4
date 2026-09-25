// ============================================================
// browserProxy.ts — Proxy de lectura curada (modo lectura)
// Mismo patrón que geminiProxy:
//  1. Valida la URL en el servidor con buildBrowserUrl
//  2. Hace fetch server-side (evita CORS del navegador)
//  3. Devuelve { ok, url, host, html } o { ok:false, reason }
// Registrado como /api/browser/fetch (GET)
// ============================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson as sendJsonShared, type MiddlewareHost } from './httpJson';
import { buildBrowserUrl } from '../core/browser/browserSession';
import { acceptLanguageHeader } from '../core/search/searchLanguage';
import { REQUEST_TIMEOUT_DEFAULTS } from '../core/config/sharedConfig';
import { logCaughtError } from '../lib/caughtError';
import { parseAllowlist } from './allowlist';


const defaultProxyMs = REQUEST_TIMEOUT_DEFAULTS.BROWSER_PROXY_MS;
/** Base ficticia solo para parsear el URL del request; el host nunca se usa. */
const PARSE_BASE_URL = 'http://localhost';

/** Envía JSON preservando el prefijo de log de este proxy (dueño único en httpJson). */
const sendJson = (res: ServerResponse, status: number, data: unknown) =>
  sendJsonShared(res, status, data, '[browserProxy] sendJson failed:');


interface FetchOk {
  ok: true;
  url: string;
  html: string;
}

interface FetchError {
  ok: false;
  reason: 'fetch_error' | 'timeout';
  status?: number;
  detail?: string;
}

async function fetchSite(
  url: string,
  timeoutMs: number,
  lang: string = 'es',
): Promise<FetchOk | FetchError> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'FLU-OS4-Curaduria/1.0 (modo lectura curada)',
        // F1 — Idioma: el sitio recibe el idioma en el header para que
        // devuelva el contenido en el idioma pedido (Wikipedia la usa).
        'Accept-Language': acceptLanguageHeader(lang),
      },
    });
    if (!response.ok) {
      return { ok: false, reason: 'fetch_error', status: response.status };
    }
    const html = await response.text();
    return { ok: true, url: response.url || url, html };
  } catch (err: unknown) {
        logCaughtError('[catch] src/server/browserProxy.ts', err);
    if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    const message = err && typeof err === 'object' && 'message' in err ? err.message : undefined;
    return { ok: false, reason: 'fetch_error', detail: String(message || 'Unknown error') };
  } finally {
    clearTimeout(timer);
  }
}

async function handleBrowserFetch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rawUrl = req.url || '';
  let parsed: URL;
  try {
    parsed = new URL(rawUrl, PARSE_BASE_URL);
  } catch (e) {
        logCaughtError('[catch] src/server/browserProxy.ts', e);
    sendJson(res, 400, { ok: false, reason: 'invalid' });
    return;
  }

  const target = parsed.searchParams.get('url') || '';
  const allowlist = parseAllowlist(parsed.searchParams.get('allowlist'));
  const scheme = parsed.searchParams.get('scheme') || 'https';
  const timeoutMs = Number(parsed.searchParams.get('timeout')) || defaultProxyMs;
  // F1 — Idioma: llega por query desde el comando de voz (NAVEGAR) y se
  // aplica como Accept-Language al sitio destino.
  const lang = parsed.searchParams.get('lang') || 'es';

  const validation = buildBrowserUrl(target, allowlist, scheme) as
    | { ok: true; url: string; host: string }
    | { ok: false; reason: 'invalid' | 'blocked'; host?: string };

  if (!validation.ok) {
    sendJson(res, 400, { ok: false, reason: validation.reason, host: validation.host || undefined });
    return;
  }

  const fetched = await fetchSite(validation.url, timeoutMs, lang);
  if (!fetched.ok) {
    sendJson(res, 200, {
      ok: false,
      reason: fetched.reason,
      status: fetched.status,
      detail: fetched.detail,
      host: validation.host,
    });
    return;
  }

  sendJson(res, 200, { ok: true, url: fetched.url, host: validation.host, html: fetched.html });
}

export function createBrowserProxy({ env: _env = {} }: { env?: Record<string, string> } = {}) {
  return {
    name: 'browser-proxy',
    configureServer(server: MiddlewareHost) {
      server.middlewares.use('/api/browser/fetch', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.method !== 'GET') return next();
        try {
          await handleBrowserFetch(req, res);
        } catch (err: unknown) {
          logCaughtError('[browserProxy] /api/browser/fetch failed', err);
          const message = err && typeof err === 'object' && 'message' in err ? err.message : undefined;
          sendJson(res, 500, { ok: false, reason: 'internal_error', detail: String(message || 'Unknown error') });
        }
      });
    },
  };
}
