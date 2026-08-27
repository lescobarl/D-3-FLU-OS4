// ============================================================
// src/core/games/calculoMental.ts
// Cálculo mental (plan-juegos §4). Motor puro sin I/O.
//
// FLU propone una operación (suma/resta) acotada por `maxSuma` y el
// niño responde el resultado. Sin pista (el fallo reintenta la misma
// operación) y "paso"/"no sé" revela el resultado y salta.
//
// Resolución numérica LOCAL (espejo del algoritmo de
// resolveNumberValue de configCommands.js, sin imports .js):
// dígitos "12" o números en letras ("quince", "dos").
//
// - Acierto → +1 punto, siguiente operación.
// - Fin al alcanzar `rounds` operaciones.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = 10;
const DEFAULT_MAX_SUMA = 10;
const MAX_SUMA = 50;

const OP_WORD: Record<string, string> = Object.freeze({
    '+': 'más',
    '-': 'menos',
});

const DEFAULT_OPERACIONES: readonly string[] = Object.freeze(['+', '-']);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'otra', 'siguiente', 'no se', 'no sé', 'me rindo',
]);

const END_FRAMES: readonly string[] = Object.freeze([
    'salir del juego',
    'terminar el juego',
    'dejar de jugar',
    'ya no quiero jugar',
    'cerrar el juego',
]);

/** Números en letras (0-20) para robustez de ASR en voz. */
const NUMBER_WORDS_ES: Record<string, number> = Object.freeze({
    cero: 0, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
    siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
    trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
    dieciocho: 18, diecinueve: 19, veinte: 20,
});

interface CalculoMentalConfig {
    maxSuma: number;
    operaciones: string[];
}

interface CalculoMentalState {
    a: number;
    b: number;
    op: string;
    answer: number;
    maxSuma: number;
    operaciones: string[];
    maxRounds: number;
    phase: 'announce' | 'done';
}

type RandomSource = () => number;

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.round(value)));
}

function stripDiacritics(text: string): string {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeForMatch(text = ''): string {
    return stripDiacritics(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasToken(normalized = '', phrase = ''): boolean {
    if (!phrase) return false;
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|\\s)${escaped}($|\\s|[.,;!?¡¿])`);
    return pattern.test(normalized);
}

function hasAnyToken(normalized: string, phrases: readonly string[]): boolean {
    return phrases.some((phrase) => hasToken(normalized, phrase));
}

function pickRandom<T>(items: readonly T[], rng: RandomSource): T {
    return items[Math.floor(rng() * items.length)];
}

/**
 * Genera una operación determinista: suma acotada por maxSuma
 * (a + b ≤ maxSuma) o resta con resultado ≥ 0.
 */
function generateOperation(
    operaciones: readonly string[],
    maxSuma: number,
    rng: RandomSource
): { a: number; b: number; op: string; answer: number } {
    const op = pickRandom(operaciones, rng);
    if (op === '+') {
        const a = 1 + Math.floor(rng() * Math.max(1, maxSuma - 1));
        const b = 1 + Math.floor(rng() * Math.max(1, maxSuma - a));
        return { a, b, op, answer: a + b };
    }
    const a = 1 + Math.floor(rng() * Math.max(1, maxSuma));
    const b = 1 + Math.floor(rng() * a);
    return { a, b, op, answer: a - b };
}

function operationPrompt(state: CalculoMentalState): string {
    return `¿Cuánto es ${state.a} ${OP_WORD[state.op]} ${state.b}?`;
}

/**
 * Resuelve una respuesta numérica a partir del texto normalizado.
 * Espejo local del algoritmo de resolveNumberValue: primero dígitos
 * ("12", "3.5") y, si no, un número escrito en letras.
 */
function resolveNumericAnswer(normalized: string): number | null {
    const digits = normalized.match(/(\d+(?:[.,]\d+)?)/);
    if (digits) {
        const value = Number.parseFloat(digits[1].replace(',', '.'));
        if (Number.isFinite(value)) return Math.round(value);
    }
    for (const token of normalized.split(/\s+/)) {
        if (token in NUMBER_WORDS_ES) return NUMBER_WORDS_ES[token];
    }
    return null;
}

export function createCalculoMentalEngine(options?: { random?: RandomSource }): GameEngine {
    let rng: RandomSource = options?.random ?? Math.random;

    const readConfig = (cfg: Record<string, unknown> | undefined): CalculoMentalConfig => {
        const maxSuma = clamp(Number(cfg?.maxSuma) || DEFAULT_MAX_SUMA, 2, MAX_SUMA);
        const operaciones = Array.isArray(cfg?.operaciones)
            ? (cfg.operaciones as unknown[]).filter((op): op is string =>
                  typeof op === 'string' && op in OP_WORD)
            : [...DEFAULT_OPERACIONES];
        return {
            maxSuma,
            operaciones: operaciones.length > 0 ? operaciones : [...DEFAULT_OPERACIONES],
        };
    };

    const readRounds = (cfg: Record<string, unknown> | undefined): number => {
        const rounds = Number(cfg?.rounds) || Number(cfg?.defaultRounds) || DEFAULT_ROUNDS;
        return clamp(rounds, 1, MAX_ROUNDS);
    };

    const adoptRandom = (cfg: Record<string, unknown> | undefined): void => {
        if (cfg && typeof cfg.random === 'function') {
            rng = cfg.random as RandomSource;
        }
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): CalculoMentalState => {
        adoptRandom(cfg);
        const config = readConfig(cfg);
        const state: CalculoMentalState = {
            ...generateOperation(config.operaciones, config.maxSuma, rng),
            maxSuma: config.maxSuma,
            operaciones: config.operaciones,
            maxRounds: readRounds(cfg),
            phase: 'announce',
        };
        session.state = state as unknown as Record<string, unknown>;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'calculo_mental',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession {
            adoptRandom(optionsConfig);
            const config = readConfig(optionsConfig);
            return {
                id: 'calculo_mental',
                state: {
                    ...generateOperation(config.operaciones, config.maxSuma, rng),
                    maxSuma: config.maxSuma,
                    operaciones: config.operaciones,
                    maxRounds: readRounds(optionsConfig),
                    phase: 'announce',
                },
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as unknown as CalculoMentalState;
            return {
                prompt: `¡Vamos a jugar a cálculo mental! ${operationPrompt(state)}`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'excited',
            };
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as unknown as CalculoMentalState;

            if (state.phase === 'done') {
                return {
                    prompt: 'Ya terminamos de jugar cálculo mental. ¿Jugamos otra vez?',
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'happy',
                };
            }

            const normalized = normalizeForMatch(text);

            // ¿Salta a la siguiente operación?
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                session.round += 1;
                const prevAnswer = state.answer;
                if (session.round > state.maxRounds) {
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
                const next = generateOperation(state.operaciones, state.maxSuma, rng);
                Object.assign(state, next);
                return {
                    prompt: `Era ${prevAnswer}. ${operationPrompt(state)}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                };
            }

            // Intento numérico.
            const answer = resolveNumericAnswer(normalized);
            if (answer === null) {
                return {
                    prompt: `No logré reconocer un número. ${operationPrompt(state)}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                    error: 'no se reconoció ningún número',
                };
            }

            if (answer === state.answer) {
                const a = state.a;
                const b = state.b;
                const op = state.op;
                const result = state.answer;
                session.score += 1;
                session.round += 1;
                if (session.round > state.maxRounds) {
                    state.phase = 'done';
                    return {
                        prompt: `¡Perfecto! Completaste ${state.maxRounds} operaciones con ${session.score} puntos. ¡Eres una calculadora humana!`,
                        valid: true,
                        gameOver: true,
                        score: session.score,
                        animation: 'Dance',
                        emotion: 'happy',
                    };
                }
                const next = generateOperation(state.operaciones, state.maxSuma, rng);
                Object.assign(state, next);
                return {
                    prompt: `¡Correcto! ${a} ${OP_WORD[op]} ${b} es ${result}. Siguiente: ${operationPrompt(state)}`,
                    valid: true,
                    gameOver: false,
                    score: session.score,
                    animation: 'Jump_in_place',
                    emotion: 'happy',
                };
            }

            // Respuesta incorrecta → reintenta la misma operación.
            return {
                prompt: `¡Casi! Inténtalo otra vez. ${operationPrompt(state)}`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'encouraging',
                error: 'respuesta incorrecta',
            };
        },

        isGameCommand(text = ''): boolean {
            const normalized = normalizeForMatch(text);
            return END_FRAMES.some((frame) => normalized.includes(frame))
                || SKIP_FRAMES.some((frame) => hasToken(normalized, frame));
        },
    };
}
