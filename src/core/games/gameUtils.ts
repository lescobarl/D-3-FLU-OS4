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

import type { AvatarAnimation, GameSession, GameTurnResult } from './types.ts';

/**
 * EPILOGO de un motor: la forma UNICA de un resultado de fin de partida.
 * Fuente unica de P7.81: antes cada motor re-declaraba el objeto entero
 * (`prompt/valid/gameOver/won/score/animation/emotion`, 73 sitios medidos en 21
 * motores), asi que un cambio de forma habia que hacerlo 21 veces y ya habian
 * divergido. Los valores por defecto son los mayoritarios (valid:false,
 * won:false, animation:'Idle', emotion:'happy'): el motor solo pasa lo que
 * difiere, y lo que no pasa es exactamente lo mismo que antes.
 */
/** Opciones de un resultado de turno (dueño único de la forma). */
export interface TurnResultOptions {
    valid?: boolean;
    won?: boolean;
    animation?: AvatarAnimation;
    emotion?: string;
    error?: string;
}

/**
 * Resultado de turno común (dueño único de la forma repetida).
 * @param prompt Texto de FLU.
 * @param score Puntaje.
 * @param options Variantes del turno.
 * @param gameOver ¿Terminó la partida?
 * @param won Desenlace (undefined = no aplica).
 * @param emotionDefault Emoción por defecto.
 * @returns Resultado del turno.
 */
function baseTurnResult(
    prompt: string,
    score: number,
    options: TurnResultOptions,
    gameOver: boolean,
    won: boolean | undefined,
    emotionDefault: string,
): GameTurnResult {
    return {
        prompt,
        valid: options.valid ?? false,
        gameOver,
        ...(won === undefined ? {} : { won }),
        score,
        animation: options.animation ?? 'Idle',
        emotion: options.emotion ?? emotionDefault,
        ...(options.error === undefined ? {} : { error: options.error }),
    };
}

export function gameOverResult(
    prompt: string,
    score: number,
    options: TurnResultOptions = {},
): GameTurnResult {
    return baseTurnResult(prompt, score, options, true, options.won ?? false, 'happy');
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
    options: TurnResultOptions = {},
): GameTurnResult {
    return baseTurnResult(prompt, score, options, false, undefined, 'neutral');
}

export function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.round(value)));
}

// Normalización de texto: fuente única en src/lib/textUtils.ts.
// Se importa Y se re-exporta: el binding se usa en este modulo (isExplicitOrderFor).
import { escapeRegExp, normalizeForMatch } from '../../lib/textUtils.ts';
import { NUMEROS_ES_BASE } from '../../lib/spokenNumbers.ts';
export { stripDiacritics, normalizeForMatch } from '../../lib/textUtils.ts';

/**
 * Índice (en el texto normalizado) donde aparece la frase como palabra/token,
 * o `null` si no aparece. Límites: inicio, espacio o puntuación tipográfica
 * (incluido el "¡"/"¿" de apertura española). Fuente única de `hasToken`.
 */
export function findTokenIndex(normalized = '', phrase = ''): number | null {
    if (!phrase) return null;
    const escaped = escapeRegExp(phrase);
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
    ...NUMEROS_ES_BASE,
    cero: 0,
    dieciséis: 16,
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
    return readNumberCfg(cfg, ['rounds', 'defaultRounds'], defaultRounds, maxRounds);
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
 * Sesion base de un motor: el MISMO contrato para los 22 motores. Antes cada motor
 * re-declaraba el objeto (`{ id, state, score: 0, round: 1 }`, 22 copias medidas):
 * una sola fuente, para que un cambio de forma no haya que hacerlo 22 veces.
 */
export function baseSession<S>(id: GameSession<S>['id'], state: S): GameSession<S> {
    return { id, state, score: 0, round: 1 };
}

/**
 * Superficie de comandos de un motor (`end/hint/skip` son DATO por motor).
 * Un solo dueno del `normalizeForMatch` + `isGameCommandSurface` para los motores que
 * comparten esa forma (los que componen otros frames no la usan).
 */
/**
 * Superficie alternativa de comandos: fin de partida (frames) o cualquiera de los
 * frames de salto. Un solo dueno (P9.35) para los motores que componen asi su superficie
 * en vez de usar frames de pista.
 */
export function isStopOrSkipCommand(text: string, end: readonly string[], skips: readonly string[]): boolean {
    const normalized = normalizeForMatch(text);
    return matchesEndGameFrames(normalized, end) || skips.some((frame) => hasToken(normalized, frame));
}

/**
 * Arranque de una partida: `reset` + el prompt del motor. Un solo dueno de la secuencia
 * (antes copiada en 15 motores: reset, cast del estado, item y turnResult). El prompt es
 * DATO por motor y viaja como callback, asi que el arranque no se re-implementa.
 */
export function beginGame(
    session: GameSession,
    optionsConfig: Record<string, unknown>,
    reset: (session: GameSession, optionsConfig: Record<string, unknown>) => void,
    prompt: (state: unknown) => string,
    options: { valid?: boolean; animation?: AvatarAnimation; emotion?: string; error?: string } = {},
): GameTurnResult {
    reset(session, optionsConfig);
    return turnResult(prompt(session.state), session.score, options);
}

export function isEngineCommand(
    text: string,
    frames: { end: readonly string[]; hint: readonly string[]; skip: readonly string[] },
): boolean {
    return isGameCommandSurface(normalizeForMatch(text), frames);
}

/**
 * Crea el predicado de comandos de un motor con sus frames publicados.
 * Dueño único del literal `isEngineCommand(text, { end, hint, skip })` que
 * repetían los motores.
 * @param frames Frames de fin, ayuda y salto del motor.
 * @returns Predicado `isGameCommand`.
 */
export function engineCommandGuard(
    frames: { end: readonly string[]; hint: readonly string[]; skip: readonly string[] },
): (text?: string) => boolean {
    return (text = '') => isEngineCommand(text, frames);
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

/**
 * Avanza una ronda y, si era la ULTIMA, cierra la partida (phase done).
 *
 * DUENO UNICO (P9.43): la secuencia `session.round += 1` + `finishRoundsIfLast` estaba
 * copiada literal en 9 motores (abecedario, adivinaCancion, ordenaSecuencia, pronunciacion,
 * quienSoy, repiteTraduce, trabalenguas, trivia y el runGuessTurn de este modulo).
 *
 * @param session sesion con `round`
 * @param state estado con cursor/rondas
 * @returns el resultado final si la partida termino, o `null` para seguir jugando
 */
export function advanceRound(
    session: { round: number; score: number },
    state: { cursor: number; maxRounds: number; order: readonly unknown[]; phase: string },
): GameTurnResult | null {
    session.round += 1;
    return finishRoundsIfLast(session, state);
}

/**
 * Avanza ronda y cursor sin rendir prompt: devuelve el cierre si la ronda era la
 * ultima, o null con el cursor ya en el siguiente item. Dueno unico del par
 * `advanceRound + state.cursor += 1` (antes copiado en los motores de item).
 * @param session sesion con ronda y score
 * @param state estado con cursor/rondas
 * @returns el resultado final si la partida termino, o null para seguir
 */
export function advanceCursorAfterSkip(
    session: { round: number; score: number },
    state: { cursor: number; maxRounds: number; order: readonly unknown[]; phase: string },
): GameTurnResult | null {
    const final = advanceRound(session, state);
    if (final) return final;
    state.cursor += 1;
    return null;
}

/**
 * Salto de turno completo: avanza ronda y cursor y rinde el prompt del motor.
 * Dueno unico del flujo `advanceRound + cursor++ + turnResult`; el texto es DATO
 * del motor y viaja como callback.
 * @param session sesion con ronda y score
 * @param state estado con cursor/rondas
 * @param render prompt del siguiente item
 * @returns el resultado final (cierre) o el turno con el siguiente prompt
 */
export function skipTurn<S extends { cursor: number; maxRounds: number; order: readonly unknown[]; phase: string }>(
    session: { round: number; score: number },
    state: S,
    render: (state: S) => string,
): GameTurnResult {
    const final = advanceCursorAfterSkip(session, state);
    if (final) return final;
    return turnResult(render(state), session.score);
}

/**
 * Prompt de salto compartido por los motores que dicen "aquí va otra". Dueno
 * unico del literal: antes repetido en `repiteTraduce` y `trivia`.
 * @param prompt prompt del siguiente item
 */
export function skipNextPrompt(prompt: string): string {
    return `¡Claro! Aquí va otra: ${prompt}`;
}

/**
 * Compuerta de turno: cierra si la partida ya termino y, si el banco se agoto,
 * marca `done` y devuelve el game over de agotamiento. Dueno unico del par
 * `phase === 'done'` + `!item` (antes copiado en los motores de item). El item
 * se resuelve con un thunk para no tocar el banco cuando la partida ya cerro.
 * @param session sesion con score
 * @param state estado con phase
 * @param item resolvedor del item del cursor (null si no hay)
 * @param messages textos de fin por partida cerrada y por banco agotado
 * @returns `{ ok: true, item }` o `{ ok: false, result }`
 */
export function openTurn<S extends { phase: string }, T>(
    session: { score: number },
    state: S,
    item: () => T | null,
    messages: { done: string; exhausted: string },
): { ok: true; item: T } | { ok: false; result: GameTurnResult } {
    if (state.phase === 'done') {
        return { ok: false, result: gameOverResult(messages.done, session.score) };
    }
    const value = item();
    if (!value) {
        state.phase = 'done';
        return { ok: false, result: gameOverResult(messages.exhausted, session.score, { animation: 'Dance' }) };
    }
    return { ok: true, item: value };
}

/**
 * Item del banco que apunta el cursor del estado. DUENO UNICO (auditoria
 * 2026-10-02): estaba copiado con el mismo cuerpo en 6 motores.
 */
export function bankItemAt<S extends { order: readonly number[]; cursor: number }, T>(
    state: S,
    bank: readonly T[],
): T | null {
    const index = state.order[state.cursor];
    return index === undefined ? null : bank[index];
}

/**
 * Prompt del turno: rinde el item elegido o el mensaje de fin. DUENO UNICO:
 * el mismo esqueleto estaba copiado en 4 motores.
 */
export function gamePrompt<S, T>(
    state: S,
    pick: (state: S) => T | null | undefined,
    render: (item: T) => string,
    empty: string,
): string {
    const item = pick(state);
    if (!item) return empty;
    return render(item);
}

/** Mensajes por paso del turno de adivinanza; el item y el siguiente son DATO del motor. */
export interface GuessTurnMessages<I> {
    done: string;
    exhausted: (ctx: { score: number }) => string;
    hint: (item: I) => string;
    won: (item: I, ctx: { score: number; maxRounds: number }) => string;
    correct: (item: I, next: I | null) => string;
    skipped: (item: I, next: I | null) => string;
    retry: (item: I) => string;
}

/**
 * Turno de un motor de adivinanza: fin de partida, item agotado, pista, acierto (con
 * ronda final y avance de cursor), salto y reintento. Un solo dueno del FLUJO (P9.35):
 * riddles y veoVeo lo tenian copiado entero; lo unico propio era el predicado de acierto
 * y los textos.
 */
export function runGuessTurn<S extends { phase: string; cursor: number; maxRounds: number; order: readonly number[] }, I>(spec: {
    session: GameSession;
    state: S;
    text: string;
    itemAt: (state: S) => I | null;
    matches: (normalized: string, item: I) => boolean;
    hintFrames: readonly string[];
    skipFrames: readonly string[];
    message: GuessTurnMessages<I>;
}): GameTurnResult {
    const { session, state, text, message } = spec;
    if (state.phase === 'done') {
        return gameOverResult(message.done, session.score);
    }

    const item = spec.itemAt(state);
    if (!item) {
        state.phase = 'done';
        return gameOverResult(message.exhausted({ score: session.score }), session.score, { animation: 'Dance' });
    }

    const normalized = normalizeForMatch(text);
    if (hasAnyToken(normalized, spec.hintFrames)) {
        return turnResult(message.hint(item), session.score, { emotion: 'thinking' });
    }

    if (spec.matches(normalized, item)) {
        session.score += 1;
        session.round += 1;
        if (isLastRound(state)) {
            state.phase = 'done';
            return gameOverResult(message.won(item, { score: session.score, maxRounds: state.maxRounds }), session.score, {
                valid: true,
                won: true,
                animation: 'Dance',
            });
        }
        state.cursor += 1;
        const next = spec.itemAt(state);
        return turnResult(message.correct(item, next), session.score, { valid: true, animation: 'Jump_in_place', emotion: 'happy' });
    }

    if (hasAnyToken(normalized, spec.skipFrames)) {
        const finRonda = advanceRound(session, state);
        if (finRonda) return finRonda;
        state.cursor += 1;
        const next = spec.itemAt(state);
        return turnResult(message.skipped(item, next), session.score);
    }

    return turnResult(message.retry(item), session.score, { emotion: 'encouraging', error: 'respuesta incorrecta' });
}

/** Estado inicial con orden barajado, cursor 0, rondas y fase: el arranque comun. */
export function buildShuffledState<S>(spec: {
    cfg: Record<string, unknown> | undefined;
    bankLength: number;
    defaultRounds: number;
    maxRounds: number;
    /** Adopta el RNG (lo guarda el motor) y lo devuelve. */
    adopt: (cfg: Record<string, unknown> | undefined) => RandomSource;
    /** Construye el estado del motor desde la base comun. */
    build: (base: { order: number[]; maxRounds: number }) => S;
}): S {
    const rng = spec.adopt(spec.cfg);
    return spec.build({
        order: shuffleOrder(rng, spec.bankLength),
        maxRounds: readRounds(spec.cfg, spec.defaultRounds, spec.maxRounds),
    });
}

/** Estado base de un motor barajado en fase de anuncio. */
export type ShuffledAnnounceState = Readonly<{
    order: number[];
    cursor: number;
    maxRounds: number;
    phase: 'announce' | 'done';
}>;

/**
 * Construye el estado inicial barajado de un motor de anuncio.
 * Dueño único del bloque cfg/adopt/build/createState que repetían los motores.
 * @param spec Banco, rondas y adopción del RNG.
 * @returns Constructor de estado para `createSession` y `reset`.
 */
export function createShuffledAnnounceStateBuilder(spec: {
    bankLength: number;
    defaultRounds: number;
    maxRounds: number;
    adopt: (cfg: Record<string, unknown> | undefined) => RandomSource;
}): (cfg: Record<string, unknown> | undefined) => ShuffledAnnounceState {
    return (cfg) =>
        buildShuffledState({
            cfg,
            bankLength: spec.bankLength,
            defaultRounds: spec.defaultRounds,
            maxRounds: spec.maxRounds,
            adopt: spec.adopt,
            build: ({ order, maxRounds }) => ({ order, cursor: 0, maxRounds, phase: 'announce' }),
        });
}

/** Reinicia la sesion: estado nuevo del motor + score 0 + ronda 1. Un solo dueno. */
export function resetGameSession<S>(
    session: GameSession,
    cfg: Record<string, unknown> | undefined,
    build: (cfg: Record<string, unknown> | undefined) => S,
): S {
    const state = build(cfg);
    session.state = state;
    session.score = 0;
    session.round = 1;
    return state;
}

/** Superficie base de sesión de un motor barajado. */
export type ShuffledSurfaceBase<S extends ShuffledAnnounceState> = {
    id: GameSession<S>['id'];
    reset: (session: GameSession, cfg: Record<string, unknown> | undefined) => S;
    createSession: (options?: Record<string, unknown>) => GameSession<S>;
};

/** Superficie base de sesión de un motor barajado, sin `start` propio. */
export function createShuffledAnnounceSurfaceBase<S extends ShuffledAnnounceState>(
    id: GameSession<S>['id'],
    buildState: (cfg: Record<string, unknown> | undefined) => S,
): ShuffledSurfaceBase<S> {
    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): S =>
        resetGameSession(session, cfg, buildState);
    return {
        id,
        reset,
        createSession: (options = {}) => baseSession(id, buildState(options)),
    };
}

/** Superficie completa: base + `start` narrado (dueño único de ese pegamento). */
export function createShuffledAnnounceSurface<S extends ShuffledAnnounceState>(
    id: GameSession<S>['id'],
    buildState: (cfg: Record<string, unknown> | undefined) => S,
    narrate: (state: S) => string,
): ShuffledSurfaceBase<S> & {
    start: (session: GameSession, optionsConfig?: Record<string, unknown>) => GameTurnResult;
} {
    const base = createShuffledAnnounceSurfaceBase(id, buildState);
    return {
        ...base,
        start: (session: GameSession, optionsConfig: Record<string, unknown> = {}) =>
            beginGame(session, optionsConfig, base.reset, (raw) => narrate(raw as S), {
                emotion: 'excited',
            }),
    };
}

/** Lee el maximo de longitud (cfg.longMax / cfg.longitudMax) con fallback y techo. */
/** Lee el numero de config de la primera clave presente, con fallback y techo. Dueno unico. */
export function readNumberCfg(
    cfg: Record<string, unknown> | undefined,
    keys: readonly string[],
    fallback: number,
    ceiling: number,
    floor = 1,
): number {
    let value = Number.NaN;
    for (const key of keys) {
        const candidate = Number(cfg?.[key]);
        if (Number.isFinite(candidate) && candidate !== 0) {
            value = candidate;
            break;
        }
    }
    return clamp(Number.isFinite(value) ? value : fallback, floor, ceiling);
}

/** Lee el maximo de longitud (cfg.longMax / cfg.longitudMax) con fallback y techo. */
export function readLongMaxCfg(
    cfg: Record<string, unknown> | undefined,
    fallback: number,
    ceiling: number,
): number {
    return readNumberCfg(cfg, ['longMax', 'longitudMax'], fallback, ceiling);
}
