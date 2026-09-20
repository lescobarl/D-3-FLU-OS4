// ============================================================
// searchLanguage.ts — Idioma de navegación y búsqueda (Fase 1)
// ------------------------------------------------------------
// Capa pura (sin DOM ni red) para:
//   - detectar el idioma pedido por voz en una frase
//   - resolver el idioma efectivo (frase > perfil > default)
//   - quitar los marcadores de idioma del candidato de sitio
//   - aplicar el subdominio por idioma (Wikipedia es/en)
//   - construir el header Accept-Language para el proxy
// Regla #1: sin hardcode — los marcadores de idioma y el mapeo
// idioma→subdominio llegan desde FLU_CONFIG.browser.languageWords
// y FLU_CONFIG.browser.languageHosts (config-driven).
// ============================================================
import { normalizeHost } from '../browser/browserSession';
import { stripDiacritics } from '../../lib/textUtils';

export type ResolvedLanguage = 'es' | 'en';

/** Marcadores por idioma: config-driven (browser.languageWords). */
export interface LanguageWordGroup {
    es: string[];
    en: string[];
}

/** Mapeo idioma→subdominio por host: config-driven (browser.languageHosts). */
export type LanguageHostMap = Record<string, Record<string, string>>;

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasMarker(text: string, markers: string[]): boolean {
    const haystack = ` ${stripDiacritics(text.trim().toLowerCase())} `;
    return markers.some((marker) => {
        const needle = stripDiacritics(String(marker).trim().toLowerCase());
        return needle.length > 0 && haystack.includes(needle);
    });
}

/**
 * Detecta el idioma solicitado en una frase por voz.
 * Devuelve 'es' | 'en' o null si no se menciona idioma.
 */
export function extractLanguageFromPhrase(
    phrase: string,
    languageWords: Partial<LanguageWordGroup> = {},
): 'es' | 'en' | null {
    if (!phrase || !phrase.trim()) return null;
    const es = Array.isArray(languageWords.es) ? languageWords.es : [];
    const en = Array.isArray(languageWords.en) ? languageWords.en : [];
    if (es.length && hasMarker(phrase, es)) return 'es';
    if (en.length && hasMarker(phrase, en)) return 'en';
    return null;
}

/**
 * Resuelve el idioma efectivo de una búsqueda/navegación:
 * 1. El idioma explícito mencionado en la frase gana.
 * 2. Si no se menciona, se usa el idioma del perfil (config).
 * 3. Fuera de es/en se normaliza a 'es' (default configurable).
 */
export function resolveSearchLanguage(
    phrase: string,
    profileLang: string,
    languageWords: Partial<LanguageWordGroup> = {},
): ResolvedLanguage {
    const detected = extractLanguageFromPhrase(phrase, languageWords);
    if (detected) return detected;
    return profileLang === 'en' ? 'en' : 'es';
}

/**
 * Quita los marcadores de idioma de una frase para que no se cuelen en el
 * candidato de sitio: "navega en wikipedia en inglés" → "navega wikipedia".
 * Los marcadores multi-palabra se eliminan por substring (insensible a
 * mayúsculas y tildes), respetando el resto de la frase.
 */
export function stripLanguageWords(
    phrase: string,
    languageWords: Partial<LanguageWordGroup> = {},
): string {
    const raw = (phrase || '').trim();
    if (!raw) return '';
    const markers = [...(languageWords.es || []), ...(languageWords.en || [])]
        .map((marker) => String(marker).trim().toLowerCase())
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
    if (!markers.length) return raw;
    let result = raw;
    for (const marker of markers) {
        result = result.replace(new RegExp(escapeRegExp(marker), 'gi'), ' ');
    }
    return result.replace(/\s+/g, ' ').trim();
}

/**
 * Aplica el prefijo de idioma al host cuando está configurado.
 * Ej.: host "wikipedia.org" + lang "es" + languageHosts
 * { 'wikipedia.org': { es: 'es', en: 'en' } } → "es.wikipedia.org".
 * Acepta un host desnudo o una URL completa y devuelve la entrada
 * sin cambios si el host no está mapeado o el idioma no tiene prefijo.
 */
export function applyLanguageToHost(
    input: string,
    lang: string,
    languageHosts: LanguageHostMap = {},
): string {
    const raw = (input || '').trim();
    if (!raw) return raw;
    let scheme = '';
    let rest = raw;
    const schemeMatch = raw.match(/^([a-z][a-z0-9+.-]*):\/\//i);
    if (schemeMatch) {
        scheme = schemeMatch[1].toLowerCase();
        rest = raw.slice(schemeMatch[0].length);
    }
    const slashIndex = rest.indexOf('/');
    const hostPart = slashIndex >= 0 ? rest.slice(0, slashIndex) : rest;
    const pathPart = slashIndex >= 0 ? rest.slice(slashIndex) : '';
    const host = normalizeHost(hostPart);
    if (!host) return raw;
    const prefixes = languageHosts[host];
    const prefix = prefixes && lang ? prefixes[lang] : undefined;
    if (!prefix || !String(prefix).trim()) return raw;
    const prefixed = `${String(prefix).trim()}.${host}`;
    return `${scheme ? `${scheme}://` : ''}${prefixed}${pathPart}`;
}

/**
 * Construye el header Accept-Language para el proxy server-side.
 * 'en' → "en, en-US;q=0.9, es;q=0.7"; cualquier otro → "es, es-419;q=0.9, en;q=0.7".
 */
export function acceptLanguageHeader(lang: string): string {
    if (lang === 'en') return 'en, en-US;q=0.9, es;q=0.7';
    return 'es, es-419;q=0.9, en;q=0.7';
}
