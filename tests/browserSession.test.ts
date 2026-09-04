// ============================================================
// browserSession.test.ts — Navegador curado (capa pura)
// ------------------------------------------------------------
// Cubre la lógica navegable SIN DOM:
//   - normalizeHost / isDomainAllowed (allowlist con subdominios)
//   - buildBrowserUrl (permitido / bloqueado / inválido / http→https)
//   - tileUrl (enlace del tile desde el dominio)
//   - dayKey (clave diaria del límite de tiempo)
// ============================================================
import { describe, expect, it } from 'vitest';

import {
    buildBrowserUrl,
    dayKey,
    extractSiteFromPhrase,
    isDomainAllowed,
    normalizeHost,
    resolveSiteCandidate,
    tileUrl,
} from '../src/core/browser/browserSession';

const ALLOWLIST = ['wikipedia.org', 'educ.ar'];

describe('browserSession — normalizeHost', () => {
    it('normaliza minúsculas, espacios y barras finales', () => {
        expect(normalizeHost('  Wikipedia.ORG/ ')).toBe('wikipedia.org');
    });

    it('quita el punto final', () => {
        expect(normalizeHost('educ.ar.')).toBe('educ.ar');
    });

    it('vacío o solo espacios devuelve vacío', () => {
        expect(normalizeHost('   ')).toBe('');
        expect(normalizeHost('')).toBe('');
    });
});

describe('browserSession — isDomainAllowed', () => {
    it('acepta coincidencia exacta', () => {
        expect(isDomainAllowed('wikipedia.org', ALLOWLIST)).toBe(true);
        expect(isDomainAllowed('educ.ar', ALLOWLIST)).toBe(true);
    });

    it('acepta subdominios del dominio permitido', () => {
        expect(isDomainAllowed('es.wikipedia.org', ALLOWLIST)).toBe(true);
        expect(isDomainAllowed('kids.educ.ar', ALLOWLIST)).toBe(true);
    });

    it('rechaza dominios fuera de la allowlist y parecidos engañosos', () => {
        expect(isDomainAllowed('example.com', ALLOWLIST)).toBe(false);
        expect(isDomainAllowed('notwikipedia.org', ALLOWLIST)).toBe(false);
        expect(isDomainAllowed('wikipedia.org.evil.com', ALLOWLIST)).toBe(false);
        expect(isDomainAllowed('', ALLOWLIST)).toBe(false);
    });

    it('rechaza cuando la allowlist está vacía', () => {
        expect(isDomainAllowed('wikipedia.org', [])).toBe(false);
    });
});

describe('browserSession — buildBrowserUrl', () => {
    it('acepta un dominio permitido y lo devuelve con https', () => {
        const result = buildBrowserUrl('wikipedia.org', ALLOWLIST);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.url).toBe('https://wikipedia.org/');
            expect(result.host).toBe('wikipedia.org');
        }
    });

    it('acepta subdominios y URLs completas', () => {
        const result = buildBrowserUrl('https://es.wikipedia.org/wiki/FLU', ALLOWLIST);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.host).toBe('es.wikipedia.org');
            expect(result.url).toContain('es.wikipedia.org/wiki/FLU');
        }
    });

    it('bloquea dominios fuera de la allowlist con reason "blocked"', () => {
        const result = buildBrowserUrl('https://example.com', ALLOWLIST);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe('blocked');
            expect(result.host).toBe('example.com');
        }
    });

    it('rechaza entradas vacías o inválidas con reason "invalid"', () => {
        expect(buildBrowserUrl('', ALLOWLIST).ok).toBe(false);
        expect(buildBrowserUrl('   ', ALLOWLIST).ok).toBe(false);
        expect(buildBrowserUrl('not a url', ALLOWLIST).ok).toBe(false);
    });

    it('rechaza esquemas no http(s) (javascript:, file:)', () => {
        const js = buildBrowserUrl('javascript:alert(1)', ALLOWLIST);
        expect(js.ok).toBe(false);
        if (!js.ok) expect(js.reason).toBe('invalid');
    });

    it('reescribe http → https cuando el esquema base es https', () => {
        const result = buildBrowserUrl('http://wikipedia.org', ALLOWLIST, 'https');
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.url).toMatch(/^https:\/\//);
    });
});

describe('browserSession — tileUrl', () => {
    it('construye el enlace del tile con el esquema configurado', () => {
        expect(tileUrl('wikipedia.org', 'https')).toBe('https://wikipedia.org');
    });

    it('respeta un esquema distinto cuando se configura', () => {
        expect(tileUrl('educ.ar', 'http')).toBe('http://educ.ar');
    });
});

describe('browserSession — dayKey', () => {
    it('dayKey produce YYYY-MM-DD local', () => {
        expect(dayKey(new Date(2026, 7, 30))).toBe('2026-08-30');
        expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    });
});

describe('browserSession — extractSiteFromPhrase', () => {
    const STOPWORDS = ['navega', 'navegar', 'en', 'a', 'abre', 'abrir', 'buscar', 'busca', 'open', 'navigate', 'the', 'to'];

    it('extrae el sitio de una frase con verbo en español', () => {
        expect(extractSiteFromPhrase('navega en wikipedia', STOPWORDS)).toBe('wikipedia');
        expect(extractSiteFromPhrase('navegar a wikipedia', STOPWORDS)).toBe('wikipedia');
        expect(extractSiteFromPhrase('abre wikipedia', STOPWORDS)).toBe('wikipedia');
        expect(extractSiteFromPhrase('busca en wikipedia', STOPWORDS)).toBe('wikipedia');
    });

    it('extrae el sitio de una frase en inglés', () => {
        expect(extractSiteFromPhrase('open youtube', STOPWORDS)).toBe('youtube');
        expect(extractSiteFromPhrase('navigate to wikipedia', STOPWORDS)).toBe('wikipedia');
    });

    it('devuelve la frase tal cual si es solo el sitio (o vacía)', () => {
        expect(extractSiteFromPhrase('wikipedia.org', STOPWORDS)).toBe('wikipedia.org');
        expect(extractSiteFromPhrase('', STOPWORDS)).toBe('');
    });
});

describe('browserSession — resolveSiteCandidate', () => {
    it('devuelve el host permitido tal cual', () => {
        expect(resolveSiteCandidate('wikipedia.org', ALLOWLIST)).toBe('wikipedia.org');
        expect(resolveSiteCandidate('es.wikipedia.org', ALLOWLIST)).toBe('es.wikipedia.org');
        expect(resolveSiteCandidate('https://educ.ar/recursos', ALLOWLIST)).toBe('https://educ.ar/recursos');
    });

    it('resuelve una etiqueta simple a su dominio en la allowlist', () => {
        expect(resolveSiteCandidate('wikipedia', ALLOWLIST)).toBe('wikipedia.org');
        expect(resolveSiteCandidate('educ', ALLOWLIST)).toBe('educ.ar');
    });

    it('deja pasar candidatos fuera de la allowlist (el flujo decide blocked)', () => {
        expect(resolveSiteCandidate('facebook.com', ALLOWLIST)).toBe('facebook.com');
        expect(resolveSiteCandidate('unknown', ALLOWLIST)).toBe('unknown');
    });
});

describe('browserSession — frase natural navega de verdad (integración)', () => {
    it('"navega en wikipedia" → buildBrowserUrl resuelve a wikipedia.org permitido', () => {
        const frase = extractSiteFromPhrase('navega en wikipedia', ['navega', 'en']);
        const input = resolveSiteCandidate(frase, ALLOWLIST);
        const result = buildBrowserUrl(input, ALLOWLIST, 'https');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.host).toBe('wikipedia.org');
            expect(result.url).toBe('https://wikipedia.org/');
        }
    });
});
