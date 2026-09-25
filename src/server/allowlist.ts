/**
 * Parseo de allowlists de los proxies del servidor: una sola implementacion.
 * Estaba copiada linea a linea en searchProxy y browserProxy.
 */
export function parseAllowlist(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}
