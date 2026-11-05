// ============================================================
// browserNavigation.ts — Navegación curada por voz → Pizarrón
// ------------------------------------------------------------
// Capa pura: convierte una petición de navegación en un
// WorkspaceEntry (Pizarrón). No toca la UI, no abre iframes:
// el resultado siempre se entrega como artefacto del Pizarrón.
// Reutiliza buildBrowserUrl de browserSession (misma allowlist).
// ============================================================

import { buildBrowserUrl } from './browserSession';

export interface BrowserNavigationLabels {
    resultTitle: string;
    blockedTitle: string;
    invalidTitle: string;
    pointSite: string;
    pointUrl: string;
    pointQuery: string;
}

export interface BrowserNavigationResult {
    ok: boolean;
    url?: string;
    host?: string;
    reason?: 'invalid' | 'blocked';
    titulo: string;
    contenido: string;
    puntos_clave: string[];
}

/**
 * Resuelve una petición de navegación (por voz) hacia un resultado
 * de Pizarrón. Usa la allowlist configurada y las etiquetas de
 * FLU_CONFIG (Regla #1: sin hardcode).
 */
export function resolveBrowserNavigation(
    input: string,
    allowlist: string[],
    scheme = 'https',
    labels: BrowserNavigationLabels,
): BrowserNavigationResult {
    const resolved = buildBrowserUrl(input, allowlist, scheme);
    if (!resolved.ok) {
        if (resolved.reason === 'blocked') {
            return {
                ok: false,
                reason: 'blocked',
                host: resolved.host,
                titulo: labels.blockedTitle,
                contenido: `${labels.blockedTitle}\n\n${resolved.host || ''}`,
                puntos_clave: resolved.host ? [labels.pointSite + resolved.host] : [],
            };
        }
        return {
            ok: false,
            reason: 'invalid',
            titulo: labels.invalidTitle,
            contenido: labels.invalidTitle,
            puntos_clave: [],
        };
    }
    return {
        ok: true,
        url: resolved.url,
        host: resolved.host,
        titulo: labels.resultTitle,
        contenido: `${labels.resultTitle}\n\n${resolved.url}`,
        puntos_clave: [labels.pointSite + resolved.host, labels.pointUrl + resolved.url],
    };
}
