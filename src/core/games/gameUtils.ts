// ============================================================
// src/core/games/gameUtils.ts
// Helpers compartidos por todos los motores de juego (plan-juegos §4).
// Copia exacta de los helpers locales ya verificados en simonDice,
// riddles, adivinaNumero, calculoMental, veoVeo, quienSoy y
// palabrasEncadenadas — extraídos aquí para no duplicar lógica en
// los 14 motores nuevos. Módulo puro, sin I/O, sin imports .js.
// ============================================================

export type RandomSource = () => number;

export function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.round(value)));
}

export function stripDiacritics(text: string): string {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeForMatch(text = ''): string {
    return stripDiacritics(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Índice (en el texto normalizado) donde aparece la frase como palabra/token,
 * o `null` si no aparece. Límites: inicio, espacio o puntuación tipográfica
 * (incluido el "¡"/"¿" de apertura española). Fuente única de `hasToken`.
 */
export function findTokenIndex(normalized = '', phrase = ''): number | null {
    if (!phrase) return null;
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|\\s|[.,;!?¡¿])${escaped}($|\\s|[.,;!?¡¿])`);
    const match = pattern.exec(normalized);
    return match ? (match.index ?? 0) + match[1].length : null;
}

export function hasToken(normalized = '', phrase = ''): boolean {
    return findTokenIndex(normalized, phrase) !== null;
}

export function hasAnyToken(normalized: string, phrases: readonly string[]): boolean {
    return phrases.some((phrase) => hasToken(normalized, phrase));
}

/** Elige un elemento al azar (determinista con RNG sembrado). */
export function pickRandom<T>(items: readonly T[], rng: RandomSource): T {
    return items[Math.floor(rng() * items.length)];
}

/** Baraja determinista (Fisher-Yates) de los índices [0..n-1]. */
export function shuffleOrder(rng: RandomSource, length: number): number[] {
    const order = Array.from({ length }, (_, index) => index);
    for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

/** Números en español (0-100) en palabras, para resolver respuestas numéricas. */
export const NUMBER_WORDS_ES: Record<string, number> = Object.freeze({
    cero: 0,
    uno: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    once: 11,
    doce: 12,
    trece: 13,
    catorce: 14,
    quince: 15,
    dieciseis: 16,
    dieciséis: 16,
    diecisiete: 17,
    dieciocho: 18,
    diecinueve: 19,
    veinte: 20,
    veintiuno: 21,
    veintidos: 22,
    veintidós: 22,
    veintitres: 23,
    veintitrés: 23,
    veinticuatro: 24,
    veinticinco: 25,
    veintiseis: 26,
    veintiséis: 26,
    veintisiete: 27,
    veintiocho: 28,
    veintinueve: 29,
    treinta: 30,
    cuarenta: 40,
    cincuenta: 50,
    sesenta: 60,
    setenta: 70,
    ochenta: 80,
    noventa: 90,
    cien: 100,
    ciento: 100,
});

/**
 * Resuelve una respuesta numérica a partir de texto normalizado.
 * Acepta dígitos ("7", "7.5"), palabras 0-100 ("siete", "veinticinco") y
 * compuestos con "y" ("treinta y cinco" → 35). Devuelve el ÚLTIMO número de
 * la frase: el niño suele cerrar con su respuesta ("después del 2 viene el 3").
 */
export function resolveNumericAnswer(normalized: string): number | null {
    const digitMatches = [...normalized.matchAll(/(\d+(?:[.,]\d+)?)/g)];
    if (digitMatches.length > 0) {
        const raw = digitMatches[digitMatches.length - 1][1];
        const value = Number.parseFloat(raw.replace(',', '.'));
        if (Number.isFinite(value)) return Math.round(value);
    }

    const tokens = normalized.split(/\s+/).filter(Boolean);
    const found: number[] = [];
    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (!(token in NUMBER_WORDS_ES)) continue;
        let value = NUMBER_WORDS_ES[token];
        // Decena + "y" + unidad: "treinta y cinco" → 35.
        if (value >= 30 && value % 10 === 0 && tokens[i + 1] === 'y') {
            const unit = NUMBER_WORDS_ES[tokens[i + 2]];
            if (unit >= 1 && unit <= 9) {
                value += unit;
                i += 2;
            }
        }
        found.push(value);
    }
    return found.length > 0 ? found[found.length - 1] : null;
}

/**
 * Lectura data-driven de `rounds` con clamps (misma semántica que los
 * motores existentes): `cfg.rounds` → `cfg.defaultRounds` → DEFAULT.
 */
export function readRounds(
    cfg: Record<string, unknown> | undefined,
    defaultRounds = 3,
    maxRounds = 20,
): number {
    const rounds = Number(cfg?.rounds) || Number(cfg?.defaultRounds) || defaultRounds;
    return clamp(rounds, 1, maxRounds);
}

/** Si el cfg trae una `random` función, la adopta como RNG del motor. */
export function adoptRandom(
    cfg: Record<string, unknown> | undefined,
    rngRef: { current: RandomSource },
): void {
    if (cfg && typeof cfg.random === 'function') {
        rngRef.current = cfg.random as RandomSource;
    }
}
