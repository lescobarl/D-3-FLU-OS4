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
import { END_GAME_FRAMES, adoptRandom, baseSession, beginGame, clamp, gameOverResult, hasAnyToken, isStopOrSkipCommand, normalizeForMatch, pickRandom, readRounds, resolveNumericAnswer, roundsOverMessage, turnResult } from './gameUtils';

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

const END_FRAMES: readonly string[] = END_GAME_FRAMES;

/** Números en letras y su resolución: fuente única en `gameUtils`. */

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

export function createCalculoMentalEngine(options?: { random?: RandomSource }): GameEngine<CalculoMentalState> {
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
    const buildState = (cfg: Record<string, unknown> | undefined): CalculoMentalState => {
        rng = adoptRandom(rng, cfg);
        const config = readConfig(cfg);
        return {
            ...generateOperation(config.operaciones, config.maxSuma, rng),
            maxSuma: config.maxSuma,
            operaciones: config.operaciones,
            maxRounds: readRounds(cfg, DEFAULT_ROUNDS, MAX_ROUNDS),
            phase: 'announce',
        };
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): CalculoMentalState => {
        const state: CalculoMentalState = buildState(cfg);
        session.state = state;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'calculo_mental',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<CalculoMentalState> {
            return baseSession('calculo_mental', buildState(optionsConfig));
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            return beginGame(session, optionsConfig, reset, (raw) => {
                const state = raw as CalculoMentalState;
                return `¡Vamos a jugar a cálculo mental! ${operationPrompt(state)}`;
            }, { emotion: 'excited' });
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as CalculoMentalState;

            if (state.phase === 'done') {
                return gameOverResult('Ya terminamos de jugar cálculo mental. ¿Jugamos otra vez?', session.score);
            }

            const normalized = normalizeForMatch(text);

            // ¿Salta a la siguiente operación?
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                session.round += 1;
                const prevAnswer = state.answer;
                if (session.round > state.maxRounds) {
                    state.phase = 'done';
                    return gameOverResult(
                            roundsOverMessage(session.score),
                            session.score,
                            { animation: 'Dance' },
                        );
                }
                const next = generateOperation(state.operaciones, state.maxSuma, rng);
                Object.assign(state, next);
                return turnResult(`Era ${prevAnswer}. ${operationPrompt(state)}`, session.score);
            }

            // Intento numérico.
            const answer = resolveNumericAnswer(normalized);
            if (answer === null) {
                return turnResult(`No logré reconocer un número. ${operationPrompt(state)}`, session.score, { error: 'no se reconoció ningún número' });
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
                    return gameOverResult(
                            `¡Perfecto! Completaste ${state.maxRounds} operaciones con ${session.score} puntos. ¡Eres una calculadora humana!`,
                            session.score,
                            { valid: true, won: true, animation: 'Dance' },
                        );
                }
                const next = generateOperation(state.operaciones, state.maxSuma, rng);
                Object.assign(state, next);
                return turnResult(`¡Correcto! ${a} ${OP_WORD[op]} ${b} es ${result}. Siguiente: ${operationPrompt(state)}`, session.score, { valid: true, animation: 'Jump_in_place', emotion: 'happy' });
            }

            // Respuesta incorrecta → reintenta la misma operación.
            return turnResult(`¡Casi! Inténtalo otra vez. ${operationPrompt(state)}`, session.score, { emotion: 'encouraging', error: 'respuesta incorrecta' });
        },

        isGameCommand(text = ''): boolean {
            return isStopOrSkipCommand(text, END_FRAMES, SKIP_FRAMES);
        },
    };
}
export const CALCULO_MENTAL_COMMAND_FRAMES = Object.freeze({ SKIP_FRAMES, END_FRAMES })
