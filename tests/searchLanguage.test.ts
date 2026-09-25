// ============================================================
// searchLanguage.test.ts — Idioma de navegación/búsqueda (F1)
// ------------------------------------------------------------
// Cubre la capa pura (sin DOM ni red):
//   - extractLanguageFromPhrase (marcadores es/en, tildes)
//   - resolveSearchLanguage (frase > perfil > default)
//   - stripLanguageWords (quita marcadores del candidato de sitio)
//   - applyLanguageToHost (subdominio por idioma: Wikipedia es/en)
//   - acceptLanguageHeader (Accept-Language para el proxy)
// ============================================================
import { describe, expect, it } from 'vitest';

import {
    acceptLanguageHeader,
    applyLanguageToHost,
    extractLanguageFromPhrase,
    resolveSearchLanguage,
    stripLanguageWords,
} from '../src/core/search/searchLanguage';

const LANGUAGE_WORDS = {
    es: ['en español', 'en castellano', 'español', 'castellano'],
    en: ['in english', 'english please', 'english', 'en inglés', 'en ingles'],
};

const LANGUAGE_HOSTS = {
    'wikipedia.org': { es: 'es', en: 'en' },
};

describe('searchLanguage — extractLanguageFromPhrase', () => {
    it('detecta español por marcador de voz', () => {
        expect(extractLanguageFromPhrase('busca en wikipedia en español', LANGUAGE_WORDS)).toBe('es');
        expect(extractLanguageFromPhrase('explora wikipedia en castellano', LANGUAGE_WORDS)).toBe('es');
    });

    it('detecta inglés por marcador de voz (con y sin tilde)', () => {
        expect(extractLanguageFromPhrase('search wikipedia in english', LANGUAGE_WORDS)).toBe('en');
        expect(extractLanguageFromPhrase('busca en wikipedia en inglés', LANGUAGE_WORDS)).toBe('en');
        expect(extractLanguageFromPhrase('busca en wikipedia en ingles', LANGUAGE_WORDS)).toBe('en');
    });

    it('es insensible a mayúsculas y tildes', () => {
        expect(extractLanguageFromPhrase('NAVEGA EN WIKIPEDIA EN ESPAÑOL', LANGUAGE_WORDS)).toBe('es');
    });

    it('devuelve null si no se menciona idioma', () => {
        expect(extractLanguageFromPhrase('navega en wikipedia', LANGUAGE_WORDS)).toBeNull();
        expect(extractLanguageFromPhrase('', LANGUAGE_WORDS)).toBeNull();
        expect(extractLanguageFromPhrase('   ', LANGUAGE_WORDS)).toBeNull();
    });
});

describe('searchLanguage — resolveSearchLanguage', () => {
    it('el idioma de la frase gana sobre el del perfil', () => {
        expect(resolveSearchLanguage('busca en wikipedia en inglés', 'es', LANGUAGE_WORDS)).toBe('en');
        expect(resolveSearchLanguage('search wikipedia in english', 'es', LANGUAGE_WORDS)).toBe('en');
        expect(resolveSearchLanguage('busca en wikipedia en español', 'en', LANGUAGE_WORDS)).toBe('es');
    });

    it('sin marcador usa el idioma del perfil', () => {
        expect(resolveSearchLanguage('navega en wikipedia', 'es', LANGUAGE_WORDS)).toBe('es');
        expect(resolveSearchLanguage('navega en wikipedia', 'en', LANGUAGE_WORDS)).toBe('en');
    });

    it('por defecto (sin perfil) normaliza a español', () => {
        expect(resolveSearchLanguage('navega en wikipedia', '', LANGUAGE_WORDS)).toBe('es');
        expect(resolveSearchLanguage('navega en wikipedia', 'fr', LANGUAGE_WORDS)).toBe('es');
    });
});

describe('searchLanguage — stripLanguageWords', () => {
    it('quita los marcadores de idioma del candidato de sitio', () => {
        // Solo se quitan los marcadores de idioma ("en inglés"). El "en"
        // preposición de "navega en wikipedia" NO es un marcador y se conserva;
        // extractSiteFromPhrase se encarga de descartarlo como stopword inicial.
        expect(stripLanguageWords('navega en wikipedia en inglés', LANGUAGE_WORDS)).toBe('navega en wikipedia');
        expect(stripLanguageWords('open youtube in english', LANGUAGE_WORDS)).toBe('open youtube');
        expect(stripLanguageWords('busca en wikipedia en español', LANGUAGE_WORDS)).toBe('busca en wikipedia');
    });

    it('devuelve la frase tal cual si no hay marcador', () => {
        expect(stripLanguageWords('navega en wikipedia', LANGUAGE_WORDS)).toBe('navega en wikipedia');
        expect(stripLanguageWords('', LANGUAGE_WORDS)).toBe('');
    });
});

describe('searchLanguage — applyLanguageToHost', () => {
    it('prefija el host desnudo según el idioma configurado', () => {
        expect(applyLanguageToHost('wikipedia.org', 'es', LANGUAGE_HOSTS)).toBe('es.wikipedia.org');
        expect(applyLanguageToHost('wikipedia.org', 'en', LANGUAGE_HOSTS)).toBe('en.wikipedia.org');
    });

    it('prefija URLs completas conservando esquema y ruta', () => {
        expect(applyLanguageToHost('https://wikipedia.org/wiki/FLU', 'es', LANGUAGE_HOSTS)).toBe(
            'https://es.wikipedia.org/wiki/FLU',
        );
        expect(applyLanguageToHost('http://wikipedia.org/', 'en', LANGUAGE_HOSTS)).toBe(
            'http://en.wikipedia.org/',
        );
    });

    it('deja intacto un host sin mapeo o idioma sin prefijo', () => {
        expect(applyLanguageToHost('educ.ar', 'es', LANGUAGE_HOSTS)).toBe('educ.ar');
        expect(applyLanguageToHost('wikipedia.org', 'fr', LANGUAGE_HOSTS)).toBe('wikipedia.org');
        expect(applyLanguageToHost('', 'es', LANGUAGE_HOSTS)).toBe('');
    });

    it('es idempotente cuando el subdominio ya existe en el mapeo', () => {
        expect(applyLanguageToHost('es.wikipedia.org', 'es', LANGUAGE_HOSTS)).toBe('es.wikipedia.org');
    });
});

describe('searchLanguage — acceptLanguageHeader', () => {
    it('prefiere el idioma solicitado con q-values', () => {
        expect(acceptLanguageHeader('es')).toBe('es, es-419;q=0.9, en;q=0.7');
        expect(acceptLanguageHeader('en')).toBe('en, en-US;q=0.9, es;q=0.7');
    });

    it('normaliza a español cualquier idioma no soportado', () => {
        expect(acceptLanguageHeader('fr')).toBe('es, es-419;q=0.9, en;q=0.7');
    });
});
