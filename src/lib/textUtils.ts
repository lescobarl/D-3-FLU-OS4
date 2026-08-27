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
