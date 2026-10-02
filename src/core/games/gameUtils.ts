// ============================================================
// src/core/games/gameUtils.ts
// Helpers compartidos por todos los motores de juego (plan-juegos §4).
// Copia exacta de los helpers locales ya verificados en simonDice,
// riddles, adivinaNumero, calculoMental, veoVeo, quienSoy y
// palabrasEncadenadas — extraídos aquí para no duplicar lógica en
// los 14 motores nuevos. Módulo puro, sin I/O, sin imports .js.
// Los frames de comando son DATO por motor y se exportan con nombre CALIFICADO
// (un HINT_FRAMES por modulo chocaria); la superficie se compone en isGameCommandSurface.
// ============================================================

export type RandomSource = () => number;

import type { AvatarAnimation, GameTurnResult } from './types';

/**
 * EPILOGO de un motor: la forma UNICA de un resultado de fin de partida.
 * Fuente unica de P7.81: antes cada motor re-declaraba el objeto entero
 * (`prompt/valid/gameOver/won/score/animation/emotion`, 73 sitios medidos en 21
 * motores), asi que un cambio de forma habia que hacerlo 21 veces y ya habian
 * divergido. Los valores por defecto son los mayoritarios (valid:false,
 * won:false, animation:'Idle', emotion:'happy'): el motor solo pasa lo que
 * difiere, y lo que no pasa es exactamente lo mismo que antes.
 */
export function gameOverResult(
    prompt: string,
    score: number,
    options: {
        won?: boolean;
        valid?: boolean;
        animation?: AvatarAnimation;
        emotion?: string;
        error?: string;
    } = {},
): GameTurnResult {
    return {
        prompt,
        valid: options.valid ?? false,
        gameOver: true,
        won: options.won ?? false,
        score,
        animation: options.animation ?? 'Idle',
        emotion: options.emotion ?? 'happy',
        ...(options.error === undefined ? {} : { error: options.error }),
    };
}

/**
 * Nucleo COMPARTIDO de "pedir ayuda": un solo dueno (P7.89). Antes cada motor
 * declaraba su propia copia de `['pista','ayuda','ayudame']` (18 medidos), asi
 * que un sinonimo nuevo habia que anadirlo 18 veces y el que se olvidaba hacia
 * que ese juego respondiera distinto. Las COLAS siguen siendo de cada juego
 * (divergen a proposito: "me rindo", "despacio", "no escuche"...) y se componen
 * al lado SIN cambiar el orden, asi que cada lista queda identica a antes.
 */
export const HELP_CORE_FRAMES: readonly string[] = Object.freeze(['pista', 'ayuda', 'ayudame'])

/**
 * Nucleo COMPARTIDO de "pasar / saltar turno": un solo dueno (P7.96). Tres motores
 * (`adivinaCancion`, `memoriaSecuencias`, `repiteTraduce`) declaraban la MISMA copia
 * literal de estos 6 marcos. El resto de motores NO entra aqui a proposito: su lista
 * difiere (anaden "me rindo", "otra palabra", "que sigue"...), asi que la cola propia
 * se compone al lado de este nucleo y cada lista queda igual a antes. Los consumidores
 * son de pertenencia (`hasAnyToken`/`hasToken`/`includes`), no de orden.
 */
export const SKIP_CORE_FRAMES: readonly string[] = Object.freeze(['otra', 'siguiente', 'sigo', 'paso', 'no se', 'no sé'])

/**
 * EPILOGO intermedio de un motor: la forma UNICA de un resultado que NO cierra
 * la partida (`gameOver: false`). Hermano de `gameOverResult`, que solo cubria
 * el final; por eso el turno intermedio seguia escrito a mano en cada motor
 * (107 sitios medidos en 21 motores, P7.90). Defaults = los mayoritarios
 * (valid:false, animation:'Idle', emotion:'neutral'); lo que difiere se pasa.
 * NO emite `won`: un turno que no cierra la partida no declara ganador, y
 * anadirlo cambiaria la forma del objeto.
 */
export function turnResult(
    prompt: string,
    score: number,
    options: {
        valid?: boolean;
        animation?: AvatarAnimation;
        emotion?: string;
        error?: string;
    } = {},
): GameTurnResult {
    return {
        prompt,
        valid: options.valid ?? false,
        gameOver: false,
        score,
        animation: options.animation ?? 'Idle',
        emotion: options.emotion ?? 'neutral',
        ...(options.error === undefined ? {} : { error: options.error }),
    };
}

export function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.round(value)));
}

// Normalización de texto: fuente única en src/lib/textUtils.ts.
// Se importa Y se re-exporta: el binding se usa en este modulo (isExplicitOrderFor).
import { normalizeForMatch } from '../../lib/textUtils';
export { stripDiacritics, normalizeForMatch } from '../../lib/textUtils';

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

/**
 * Devuelve el RNG a adoptar: el de `cfg.random` si es una función, o `current`.
 * Fuente única (C59): antes 16 motores reimplementaban esta lógica.
 */
export function adoptRandom(
    current: RandomSource,
    cfg?: Record<string, unknown>,
): RandomSource {
    return cfg && typeof cfg.random === 'function' ? (cfg.random as RandomSource) : current;
}
// ------------------------------------------------------------
// Concepto "ORDEN DE ARRANQUE de un juego" --- DUENO UNICO.
// Vive en esta hoja (sin imports) para que puedan consultarlo por igual el
// catalogo (matchGameIntent) y los MOTORES (que deben distinguir una orden de
// arranque de una accion de partida). Antes vivia dentro de gameCatalog: los
// motores no podian verlo sin crear un ciclo de imports.
// ------------------------------------------------------------
/** Marcos de intencion de juego. Ninguno aislado dispara un arranque. */
export const PLAY_INTENT_FRAMES: readonly string[] = Object.freeze([
    'vamos a jugar',
    'vamos a jugar a',
    'juguemos',
    'juguemos a',
    'a jugar',
    'quiero jugar',
    'quiero jugar a',
    'juega conmigo',
    'juego de',
    'un juego de',
    'jugar a',
    'empecemos a jugar',
    'quien quiere jugar',
]);
/** Frases negativas que NUNCA deben iniciar un juego (guardia anti-falso-positivo). */
export const NEGATIVE_INTENT_FRAMES: readonly string[] = Object.freeze([
    'no quiero jugar',
    'ya no quiero jugar',
    'no juguemos',
    'ya no juguemos',
    'deja de jugar',
    'parar de jugar',
    'dejemos de jugar',
]);
/**
 * Marcos de CAMBIO de juego ("cambia a <juego>"). Mismo dueno que el arranque:
 * son la misma clase de orden (el usuario pide un juego, no juega un turno).
 * Defecto real (portal): con la loteria abierta, "cambia a trivia" no lo reconocia
 * ningun marco, caia al ultimo paso de `resolveGameCommandFromText` (respuesta
 * abierta del jugador) y se consumia como turno: no habia forma de cambiar de
 * juego con una orden explicita.
 */
export const CHANGE_GAME_FRAMES: readonly string[] = Object.freeze([
    'cambia a',
    'cambia al',
    'cambia el juego',
    'cambia el juego a',
    'cambia de juego',
    'cambia de juego a',
    'cambiar a',
    'cambiar el juego',
    'cambiar de juego',
]);
/** El texto es una ORDEN DE JUEGO: arranque ("vamos a jugar X") o cambio ("cambia a X")? */
export function hasGameOrderFrame(normalized = ''): boolean {
    return hasAnyToken(normalized, PLAY_INTENT_FRAMES) || hasAnyToken(normalized, CHANGE_GAME_FRAMES);
}
// ------------------------------------------------------------
// Concepto "SALIR DE LA PARTIDA" --- DUENO UNICO.
// Vive en esta hoja (sin imports) por el mismo motivo que el orden de arranque:
// lo consultan por igual el fast-path de voz (gameCommands.js) y los 21 motores.
// Antes cada motor tenia su PROPIA copia de la lista y habia divergido (solo la
// loteria conocia las salidas cortas), asi que "alto al juego" no terminaba la
// partida en el resto. Una sola lista: una sola verdad.
// ------------------------------------------------------------
/**
 * Frases de salida de una partida activa. Se comparan con limites de palabra
 * (`hasAnyToken`), no por subcadena: "alto" no debe dispararse dentro de
 * "salto" ni "termina" dentro de "determina".
 */
export const END_GAME_FRAMES: readonly string[] = Object.freeze([
    // Frases explicitas
    'salir del juego',
    'terminar el juego',
    'termina el juego',
    'terminemos',
    'dejar de jugar',
    'deja de jugar',
    'ya no quiero jugar',
    'ya no quiero jugar mas',
    'no quiero jugar',
    'no quiero jugar mas',
    'cerrar el juego',
    'cierra el juego',
    'cancelar el juego',
    'cancela el juego',
    'fin del juego',
    'se acabo',
    'ya basta',
    'basta ya',
    // Peticiones directas de parar (las del reporte: "alto al juego")
    'alto al juego',
    'alto el juego',
    'parar el juego',
    'parar de jugar',
    'para el juego',
    'para de jugar',
    'deten el juego',
    'detener el juego',
    'finalizar el juego',
    'finaliza el juego',
    'acabar el juego',
    'acaba el juego',
    'abortar el juego',
    'aborta el juego',
    // Salidas que vivian SOLO en la copia local de un motor (loteria, cuentacuentos,
    // cuento colaborativo). El motor las declaraba en su superficie y el enrutador
    // -dueno real de la salida- no las conocia: las enviaba al motor como jugada y
    // la frase no cerraba nada (en el cuento, hasta se agregaba a la historia).
    'ya no quiero',
    'fin del cuento',
    // Salidas cortas (antes habia que decir la frase completa y quedaba atrapado).
    'salir',
    'terminar',
    'termina',
    'basta',
    'parar',
    'alto',
    'stop',
]);

// ------------------------------------------------------------
// Conceptos "AFIRMACION SUELTA" y "ORDEN EXPLICITA del motor" --- DUENO UNICO.
// Un "si"/"dale"/"adelante" NO es una ORDEN del motor: es una afirmacion de la
// conversacion. Con la partida EN PAUSA, una orden EXPLICITA del propio motor
// ("siguiente carta", "pista", "paso") la retoma; una afirmacion suelta NO
// (P7.55: en pausa un "si" significaba otra cosa en la conversacion). Esta es la
// clasificacion UNICA: el motor declara QUE acepta (`isGameCommand`) y, si su
// caso lo pide, QUE de eso es una orden (`isExplicitOrder`, p.ej. loteria para
// excluir su grito de victoria); el enrutador NO re-enumera tokens.
// ------------------------------------------------------------
export const BARE_AFFIRMATION_FRAMES: readonly string[] = Object.freeze([
    'si', 'sí', 'ok', 'okey', 'vale', 'dale', 'adelante', 'vamos',
    'yes', 'listo', 'sigue', 'continua', 'continúa', 'continuar',
]);

/** ¿El texto normalizado es (solo) una afirmacion suelta, no una orden del motor? */
export function isBareAffirmation(normalized = ''): boolean {
    return hasAnyToken(normalized, BARE_AFFIRMATION_FRAMES);
}

/** Forma minima del motor que necesita el criterio (sin acoplar a GameEngine). */
interface ExplicitOrderEngine {
    isGameCommand?: (text: string) => boolean;
    isExplicitOrder?: (text: string) => boolean;
}

/**
 * ¿El texto es una ORDEN EXPLICITA del motor (retoma una partida EN PAUSA)?
 * El dueno es el MOTOR: si declara `isExplicitOrder`, manda esa; si no, se
 * deriva de `isGameCommand` menos las afirmaciones sueltas. Un solo criterio.
 */
export function isExplicitOrderFor(
    engine: ExplicitOrderEngine | null | undefined,
    text = '',
): boolean {
    if (!engine) return false;
    if (typeof engine.isExplicitOrder === 'function') return Boolean(engine.isExplicitOrder(text));
    if (typeof engine.isGameCommand !== 'function') return false;
    return Boolean(engine.isGameCommand(text)) && !isBareAffirmation(normalizeForMatch(text));
}

/**
 * ¿El texto normalizado pide TERMINAR la partida? Criterio UNICO de salida:
 * `frames` permite a un motor anadir sus salidas propias sin duplicar la base.
 */
export function matchesEndGameFrames(normalized = '', frames: readonly string[] = END_GAME_FRAMES): boolean {
    return hasAnyToken(normalized, frames);
}

/**
 * Palabras de funcion que NO cuentan como "dije una palabra": sin esto, en
 * juegos de vocabulario ("una palabra que empiece con...") un "el" o un "la"
 * daban acierto gratis. Fuente unica: la usan abecedario y palabras encadenadas.
 */
export const STOPWORDS_ES: ReadonlySet<string> = new Set([
    'el', 'la', 'lo', 'los', 'las', 'un', 'una', 'unos', 'unas', 'al', 'del',
    'es', 'en', 'se', 'si', 'te', 'tu', 'tus', 'me', 'mi', 'mis', 'su', 'sus',
    'no', 'ni', 'por', 'para', 'que', 'con', 'de', 'y', 'o', 'le', 'les',
    'muy', 'ya', 'hay', 'son', 'mas', 'tan', 'sin',
]);

/**
 * ¿Es esta la ultima ronda? `cursor` es 0-based: la ronda termina cuando el cursor
 * es el ultimo (se agotan maxRounds u order). Unico dueno del criterio (antes copiado
 * literal en 9 motores).
 */
export function isLastRound(state: { cursor: number; maxRounds: number; order: readonly unknown[] }): boolean {
    return state.cursor + 1 >= state.maxRounds || state.cursor + 1 >= state.order.length;
}

/**
 * Superficie de comandos de un motor de juego: fin de partida + pista + salto.
 * Dueno unico de la composicion (antes copiada identica en 17 motores, con dos
 * variantes equivalentes hasToken/hasAnyToken). Los frames son por motor.
 */
export function isGameCommandSurface(
    normalized: string,
    frames: { end: readonly string[]; hint: readonly string[]; skip: readonly string[] },
): boolean {
    return (
        matchesEndGameFrames(normalized, frames.end) ||
        hasAnyToken(normalized, frames.hint) ||
        hasAnyToken(normalized, frames.skip)
    );
}

/**
 * Si el cursor esta en la ultima ronda: cierra la partida (phase done) y devuelve
 * el resultado final; si no, null. Unico dueno del mensaje de fin por rondas
 * agotadas (antes copiado literal en 11 motores).
 */
export function finishRoundsIfLast(
    session: { score: number },
    state: { cursor: number; maxRounds: number; order: readonly unknown[]; phase: string },
): GameTurnResult | null {
    if (!isLastRound(state)) return null;
    state.phase = 'done';
    return gameOverResult(roundsOverMessage(session.score), session.score, {
        animation: 'Dance',
    });
}

/** Mensaje unico de fin por rondas agotadas (antes copiado literal en varios motores). */
export function roundsOverMessage(score: number): string {
    return `Terminamos con ${score} puntos. ¡Muy bien jugado!`;
}
