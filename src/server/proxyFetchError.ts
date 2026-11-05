/**
 * Error de un fetch hecho por los proxies del dev-server.
 *
 * Dueño único de la clasificación `timeout` vs `fetch_error`: browserProxy y
 * searchProxy comparten la misma forma y la misma lectura del error de fetch.
 */
export interface ProxyFetchError {
  ok: false;
  reason: 'fetch_error' | 'timeout';
  status?: number;
  detail?: string;
}

/**
 * Traduce un error de fetch al resultado de fallo del proxy.
 * @param err Error capturado por el `catch` del fetch.
 * @returns Fallo de tipo timeout o fetch_error con su detalle.
 */
export function proxyFetchError(err: unknown): ProxyFetchError {
  if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
    return { ok: false, reason: 'timeout' };
  }
  const message = err && typeof err === 'object' && 'message' in err ? err.message : undefined;
  return { ok: false, reason: 'fetch_error', detail: String(message || 'Unknown error') };
}
