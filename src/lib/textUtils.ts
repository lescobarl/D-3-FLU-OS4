// ============================================================
// textUtils — Utilidades compartidas de texto
// ============================================================
// Canonical TS de normalizeSpaces / cleanForSpeech.
// Parity de src/voice/lib/audioMath.js (OS2) pero con coerción
// defensiva String(s || '') → nunca inyecta "null"/"undefined"
// en speech ni en prompts (antiguas copias locales de
// App.tsx, minuteKnowledgeHelpers.ts y dailyAgenda.ts).
// ============================================================

/**
 * Normalizar espacios en blanco (OS2 audioMath.js parity).
 * Coerción defensiva: null/undefined/0 → ''.
 */
export function normalizeSpaces(s: string): string {
    return String(s || '').replace(/\s+/g, ' ').trim();
}

/**
 * Limpiar texto para speech (OS2 cleanForSpeech parity).
 */
export function cleanForSpeech(s: string): string {
    return normalizeSpaces(
        String(s || '')
            .replace(/[\n\r]+/g, ' ')
            .replace(/[*_`~>#-]+/g, ' ')
            .replace(/\s+/g, ' '),
    );
}

/**
 * Quita diacríticos (descomposición NFD + marcas combinantes) sin alterar
 * mayúsculas. Fuente única de la normalización de acentos del proyecto.
 */
export function stripDiacritics(s: string): string {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normaliza texto para comparación: sin diacríticos, minúsculas y espacios
 * colapsados. Fuente única (antes duplicada en 7 archivos).
 */
export function normalizeForMatch(s = ''): string {
    return stripDiacritics(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Resolver un rótulo bilingüe { es, en } según el idioma activo, con
 * fallback final. Fuente única de verdad: antes existían 4 copias
 * locales (App.tsx, WorkspaceHub, HoyPanel, ResultFeed).
 */
export function pickLabel(
    labels: { es?: string; en?: string } | undefined,
    language: string,
    fallback: string,
): string {
    if (!labels) return fallback;
    return labels[language === 'en' ? 'en' : 'es'] || labels.es || fallback;
}
