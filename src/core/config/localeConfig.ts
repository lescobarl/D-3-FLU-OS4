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
