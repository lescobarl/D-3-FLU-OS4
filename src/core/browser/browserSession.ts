// ============================================================
// browserSession.ts — Lógica pura del Navegador curado (panel)
// ============================================================
// Funciones sin efectos para: construir URLs seguras y validar la
// allowlist. Están separadas del componente para poder testearse de
// forma unitaria.
// Regla #1: sin hardcode — la allowlist y el esquema llegan por
// parámetro desde FLU_CONFIG.browser.
// ============================================================

export type BrowserUrlResult =
    | { ok: true; url: string; host: string }
    | { ok: false; reason: 'invalid' | 'blocked'; host?: string };

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Normaliza un host: minúsculas, sin espacios ni punto final. */
export function normalizeHost(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/\/+$/, '')
        .replace(/\.$/, '');
}

/**
 * ¿El host está permitido? Permite coincidencia exacta o subdominio.
 * Ej: "es.wikipedia.org" coincide con "wikipedia.org";
 * "notwikipedia.org" NO coincide (no termina en ".wikipedia.org").
 */
export function isDomainAllowed(host: string, allowlist: string[]): boolean {
    const h = normalizeHost(host);
    if (!h) return false;
    return allowlist.some((entry) => {
        const e = normalizeHost(entry);
        if (!e) return false;
        return h === e || h.endsWith(`.${e}`);
    });
}

/**
 * Extrae el nombre del sitio de una frase natural de navegación
 * ("navega en wikipedia" → "wikipedia", "open youtube" → "youtube").
 * Los verbos/conectores a eliminar son config-driven (browser.siteStopwords).
 * Si no hay nada que extraer (o la frase es solo el sitio), se devuelve tal cual.
 */
export function extractSiteFromPhrase(phrase: string, stopwords: string[] = []): string {
    const raw = (phrase || '').trim();
    if (!raw) return '';
    const stop = stopwords.map((w) => w.trim().toLowerCase()).filter(Boolean);
    const words = raw.toLowerCase().split(/\s+/).filter(Boolean);
    let start = 0;
    while (start < words.length && stop.includes(words[start])) {
        start += 1;
    }
    const kept = words.slice(start);
    return kept.length ? kept.join(' ') : raw;
}

/**
 * Resuelve un candidato de sitio contra la allowlist para que una frase
 * natural navegue de verdad:
 * - Si el candidato ya es un host permitido (o subdominio), se usa tal cual.
 * - Si es una etiqueta simple sin punto ("wikipedia"), se busca la entrada de
 *   la allowlist cuya primera etiqueta coincida ("wikipedia.org") y se usa esa.
 * Devuelve el dominio resuelto, o el candidato original si no coincide.
 */
export function resolveSiteCandidate(candidate: string, allowlist: string[]): string {
    const clean = (candidate || '').trim();
    if (!clean) return '';
    if (isDomainAllowed(clean, allowlist)) return clean;
    if (/\./.test(clean)) return clean; // tiene punto: no es etiqueta simple
    const label = clean.toLowerCase().split('.')[0];
    for (const entry of allowlist) {
        const e = normalizeHost(entry);
        if (e && e.split('.')[0] === label) return e;
    }
    return clean;
}

/** Construye la URL de un tile a partir de su dominio y esquema. */
export function tileUrl(domain: string, scheme = 'https'): string {
    return `${scheme}://${normalizeHost(domain)}`;
}

/**
 * Convierte la entrada del usuario en una URL permitida.
 * - Sin esquema → se antepone `scheme` (allowlistScheme de la config).
 * - HTTP explícito con esquema https configurado → se reescribe a https.
 * - Host fuera de la allowlist → { ok:false, reason:'blocked' }.
 * - Entrada vacía o URL malformada → { ok:false, reason:'invalid' }.
 */
export function buildBrowserUrl(
    input: string,
    allowlist: string[],
    scheme = 'https',
): BrowserUrlResult {
    const raw = (input || '').trim();
    if (!raw) return { ok: false, reason: 'invalid' };

    let candidate = raw;
    if (!SCHEME_RE.test(raw)) {
        candidate = `${scheme}://${raw}`;
    }

    let parsed: URL;
    try {
        parsed = new URL(candidate);
    } catch {
        return { ok: false, reason: 'invalid' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, reason: 'invalid' };
    }

    // Fuerza https si el esquema configurado lo pide (navegador curado).
    if (parsed.protocol === 'http:' && scheme === 'https') {
        parsed.protocol = 'https:';
    }

    const host = parsed.hostname;
    if (!isDomainAllowed(host, allowlist)) {
        return { ok: false, reason: 'blocked', host };
    }

    return { ok: true, url: parsed.toString(), host };
}

/** Clave de día local (YYYY-MM-DD) para el contador diario. */
export function dayKey(date: Date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
