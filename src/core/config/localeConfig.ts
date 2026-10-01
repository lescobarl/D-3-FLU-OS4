// ============================================================
// localeConfig — locales de voz/escucha (FUENTE ÚNICA, C47)
// ============================================================
// Ningún otro módulo declara literales 'es-MX'/'en-US': todos los leen
// de aquí. Módulo HOJA (sin imports) para poder usarse desde librerías de
// voz de bajo nivel sin crear ciclos.
// ============================================================

/** Locale BCP-47 por variante de idioma (lenguas indígenas caen a es-MX). */
export const SPEECH_LOCALES = {
    es: 'es-MX',
    en: 'en-US',
    nah: 'es-MX',
    yua: 'es-MX',
    mix: 'es-MX',
    zap: 'es-MX',
} as const;

export type SpeechLocale = (typeof SPEECH_LOCALES)[keyof typeof SPEECH_LOCALES];

/** Locale por defecto cuando el idioma no está determinado. */
export const DEFAULT_SPEECH_LOCALE: SpeechLocale = SPEECH_LOCALES.es;

/** Locales del modo bilingüe (la escucha alterna según el idioma detectado). */
export const BILINGUAL_LOCALES: readonly SpeechLocale[] = [SPEECH_LOCALES.es, SPEECH_LOCALES.en];

/**
 * Codigos de idioma BASE del producto (no son locales BCP-47; esos son
 * SPEECH_LOCALES). Dueno unico de la regla "idioma -> codigo base": antes la
 * misma decision (`language === 'en' ? 'en' : 'es'`) estaba copiada en una
 * decena de modulos, cada uno decidiendo por su cuenta cuando un idioma cae a
 * 'es'. Aqui se declara una vez.
 */
export const BASE_LANGS = { es: 'es', en: 'en' } as const;

export type BaseLang = (typeof BASE_LANGS)[keyof typeof BASE_LANGS];

/** Normaliza cualquier idioma al codigo base: solo 'en' no cae a 'es'. */
export function normalizeLang(language?: string | null): BaseLang {
    return language === BASE_LANGS.en ? BASE_LANGS.en : BASE_LANGS.es;
}

/** Locale BCP-47 por alfabeto detectado (voz fuera del catalogo base). */
export const SCRIPT_SPEECH_LOCALES = {
    japanese: 'ja-JP',
    chinese: 'zh-CN',
    korean: 'ko-KR',
    cyrillic: 'ru-RU',
    arabic: 'ar-SA',
    greek: 'el-GR',
} as const
