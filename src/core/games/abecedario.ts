// ============================================================
// src/core/games/abecedario.ts
// Abecedario (plan-juegos §Fase 3, Riesgo 3).
// Motor puro sin I/O.
//
// FLU propone una letra y el niño dice una palabra que empiece
// con esa letra. Se acepta CUALQUIER palabra que empiece con la
// letra (validación por primera letra de los tokens) o la palabra
// del banco (validación por keyword).
//
// Controles:
//   "pista" / "ayuda"  → revela una palabra del banco
//   "paso" / "siguiente" → pasa a la siguiente letra
// Fin al completar `rounds` letras.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';
import {
    normalizeForMatch, hasAnyToken,
    adoptRandom,
    readRounds,
} from './gameUtils';

export interface AbecedarioItem {
    letra: string;
    palabra: string;
    pista: string;
}

export const ABECEDARIO_BANK: readonly AbecedarioItem[] = Object.freeze([
    { letra: 'a', palabra: 'avión', pista: 'Vuela por el cielo.' },
    { letra: 'b', palabra: 'ballena', pista: 'El animal más grande del mar.' },
    { letra: 'c', palabra: 'casa', pista: 'Donde vives todos los días.' },
    { letra: 'd', palabra: 'delfín', pista: 'Un animal que nada y salta en el mar.' },
    { letra: 'e', palabra: 'elefante', pista: 'Un animal enorme con trompa.' },
    { letra: 'f', palabra: 'fresa', pista: 'Una fruta roja y dulce.' },
    { letra: 'g', palabra: 'gato', pista: 'Un felino que dice miau.' },
    { letra: 'l', palabra: 'luna', pista: 'Brilla en el cielo de noche.' },
    { letra: 'm', palabra: 'mariposa', pista: 'Vuela y tiene alas de colores.' },
    { letra: 'p', palabra: 'pelota', pista: 'La usas para jugar y rebota.' },
    { letra: 's', palabra: 'sol', pista: 'Brilla y da calor de día.' },
    { letra: 't', palabra: 'tortuga', pista: 'Es lenta y lleva caparazón.' },
]);

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = ABECEDARIO_BANK.length;

const HINT_FRAMES: readonly string[] = Object.freeze([
    'pista', 'ayuda', 'ayudame', 'no se', 'no sé', 'dame otra',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'siguiente', 'otra', 'sigo', 'adelante',
]);

const END_FRAMES: readonly string[] = Object.freeze([
    'salir del juego',
    'terminar el juego',
    'dejar de jugar',
    'ya no quiero jugar',
    'cerrar el juego',
    'terminemos',
]);

type RandomSource = () => number;

interface AbecedarioState {
    order: number[];
    cursor: number;
    maxRounds: number;
    phase: 'announce' | 'done';
}

function itemAt(state: AbecedarioState): AbecedarioItem | null {
    const index = state.order[state.cursor];
    return index === undefined ? null : ABECEDARIO_BANK[index];
}

/**
 * Palabras función que NO cuentan como "una palabra que empieza con…":
 * sin esto, "el", "lo", "se", "te", "mi"… daban acierto gratis y se ganaba
 * el juego sin decir una palabra real.
 */
const STOPWORDS_ES: ReadonlySet<string> = new Set([
    'el', 'la', 'lo', 'los', 'las', 'un', 'una', 'unos', 'unas', 'al', 'del',
    'es', 'en', 'se', 'si', 'te', 'tu', 'tus', 'me', 'mi', 'mis', 'su', 'sus',
    'no', 'ni', 'por', 'para', 'que', 'con', 'de', 'y', 'o', 'le', 'les',
    'muy', 'ya', 'hay', 'son', 'mas', 'tan', 'sin',
]);

/** Palabra REAL dicha por el niño que empieza con la letra objetivo, o null. */
function matchedWord(normalized: string, letra: string): string | null {
    const target = letra.toLowerCase();
    for (const token of normalized.split(/\s+/)) {
        if (token.length >= 2 && token.startsWith(target) && !STOPWORDS_ES.has(token)) {
            return token;
        }
    }
    return null;
}

export function createAbecedarioEngine(options?: { random?: RandomSource }): GameEngine<AbecedarioState> {
    let rng: RandomSource = options?.random ?? Math.random;
    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): AbecedarioState => {
        rng = adoptRandom(rng, cfg);
        const order = ABECEDARIO_BANK.map((_, index) => index);
        for (let i = order.length - 1; i > 0; i -= 1) {
            const j = Math.floor(rng() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        const state: AbecedarioState = {
            order,
            cursor: 0,
            maxRounds: readRounds(cfg, DEFAULT_ROUNDS, MAX_ROUNDS),
            phase: 'announce',
        };
        session.state = state;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'abecedario',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<AbecedarioState> {
            rng = adoptRandom(rng, optionsConfig);
            const order = ABECEDARIO_BANK.map((_, index) => index);
            for (let i = order.length - 1; i > 0; i -= 1) {
                const j = Math.floor(rng() * (i + 1));
                [order[i], order[j]] = [order[j], order[i]];
            }
            return {
                id: 'abecedario',
                state: {
                    order,
                    cursor: 0,
                    maxRounds: readRounds(optionsConfig, DEFAULT_ROUNDS, MAX_ROUNDS),
                    phase: 'announce',
                },
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as AbecedarioState;
            const item = itemAt(state);
            return {
                prompt: `¡Vamos a jugar con el abecedario! Dime una palabra que empiece con la letra "${item ? item.letra : ''}".`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'excited',
            };
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as AbecedarioState;

            if (state.phase === 'done') {
                return {
                    prompt: 'Ya terminamos con las letras. ¿Jugamos otra vez?',
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'happy',
                };
            }

            const item = itemAt(state);
            if (!item) {
                state.phase = 'done';
                return {
                    prompt: `¡Se acabaron las letras! Tu puntaje fue ${session.score}. ¡Muy bien!`,
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Dance',
                    emotion: 'happy',
                };
            }

            const normalized = normalizeForMatch(text);

            // ¿Pide pista?
            if (hasAnyToken(normalized, HINT_FRAMES)) {
                return {
                    prompt: `La palabra "${item.palabra}" empieza con la "${item.letra}". ${item.pista} Ahora dime otra que empiece con la "${item.letra}".`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'thinking',
                };
            }

            // ¿Acierta? Una palabra REAL del niño con la letra inicial.
            const word = matchedWord(normalized, item.letra);
            if (word) {
                session.score += 1;
                session.round += 1;
                if (state.cursor + 1 >= state.maxRounds || state.cursor + 1 >= state.order.length) {
                    state.phase = 'done';
                    return {
                        prompt: `¡Muy bien! "${word}" empieza con la "${item.letra}". Completaste ${state.maxRounds} letras con ${session.score} puntos. ¡Conoces el abecedario!`,
                        valid: true,
                        gameOver: true,
                        score: session.score,
                        animation: 'Dance',
                        emotion: 'happy',
                    };
                }
                state.cursor += 1;
                const next = itemAt(state);
                return {
                    prompt: `¡Muy bien! "${word}" empieza con la "${item.letra}". Ahora dime una palabra que empiece con la letra "${next ? next.letra : ''}".`,
                    valid: true,
                    gameOver: false,
                    score: session.score,
                    animation: 'Jump_in_place',
                    emotion: 'happy',
                };
            }

            // ¿Salta?
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                session.round += 1;
                if (state.cursor + 1 >= state.maxRounds || state.cursor + 1 >= state.order.length) {
                    state.phase = 'done';
                    return {
                        prompt: `Terminamos con ${session.score} puntos. ¡Muy bien jugado!`,
                        valid: false,
                        gameOver: true,
                        score: session.score,
                        animation: 'Dance',
                        emotion: 'happy',
                    };
                }
                state.cursor += 1;
                const next = itemAt(state);
                return {
                    prompt: `¡Claro! Ahora dime una palabra que empiece con la letra "${next ? next.letra : ''}".`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                };
            }

            // No acierta → reintenta la misma letra.
            return {
                prompt: `Casi... Dime una palabra que empiece con la letra "${item.letra}".`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'encouraging',
                error: 'palabra incorrecta',
            };
        },

        isGameCommand(text = ''): boolean {
            const normalized = normalizeForMatch(text);
            return END_FRAMES.some((frame) => normalized.includes(frame))
                || HINT_FRAMES.some((frame) => hasAnyToken(normalized, [frame]))
                || SKIP_FRAMES.some((frame) => hasAnyToken(normalized, [frame]));
        },
    };
}
