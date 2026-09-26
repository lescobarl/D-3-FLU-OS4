// ============================================================
// requestUrl.ts — Dueño único del parseo del URL del request.
//
// El defecto no era solo una constante repetida: `PARSE_BASE_URL` viajaba con el
// MISMO bloque de 8 líneas copiado en searchProxy (`handleSearch`) y browserProxy
// (`handleBrowserFetch`) — parsear `req.url` contra una base ficticia, registrar el
// fallo y responder 400. Arreglar una copia no arreglaba la otra.
//
// El patrón de los proxies ya era compartir dueño (`parseAllowlist`, `sendJson`);
// este bloque simplemente se había saltado el criterio.
// ============================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './httpJson';
import { logCaughtError } from '../lib/caughtError';

/** Base ficticia solo para parsear el URL del request; el host nunca se usa. */
const PARSE_BASE_URL = 'http://localhost';

/**
 * Parsea `req.url` y, si es inválido, registra el fallo y responde 400.
 *
 * @param logPrefix prefijo de log del proxy llamante (ej. `[searchProxy]`), para
 *   que el fallo quede atribuido a quien lo provocó y no a este módulo.
 * @returns el URL parseado; `null` si la respuesta 400 ya se envió (salir).
 */
export function parseRequestUrl(
  req: IncomingMessage,
  res: ServerResponse,
  logPrefix: string,
): URL | null {
  try {
    return new URL(req.url || '', PARSE_BASE_URL);
  } catch (e) {
    logCaughtError(`${logPrefix} parseRequestUrl`, e);
    sendJson(res, 400, { ok: false, reason: 'invalid' }, `${logPrefix} sendJson failed:`);
    return null;
  }
}
