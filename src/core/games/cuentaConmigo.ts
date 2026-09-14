// ============================================================
// src/core/games/cuentaConmigo.ts
// Cuenta conmigo (plan-juegos §Fase 3, Riesgo 3).
// Motor puro sin I/O.
//
// FLU empieza a contar del 1 al `hasta` y el niño dice el número
// siguiente. Validación numérica: dígitos ("7") o palabras en
// español ("siete") vía resolveNumericAnswer.
//
// Controles:
//   "pista" / "ayuda"       → revela el número que sigue
//   "paso" / "siguiente"    → pasa al siguiente número sin puntuar
// Fin al llegar a `hasta`.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';
import {
    clamp, normalizeForMatch, hasAnyToken, resolveNumericAnswer,
} from './gameUtils';

const DEFAULT_HASTA = 10;
const MAX_HASTA = 20;

const HINT_FRAMES: readonly string[] = Object.freeze([
    'pista', 'ayuda', 'ayudame', 'no se', 'no sé', 'cual sigue',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'siguiente', 'sigue tu', 'tu sigue', 'adelante',
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

interface CuentaConmigoState {
    siguiente: number;
    hasta: number;
    phase: 'announce' | 'done';
}

export function createCuentaConmigoEngine(_options?: { random?: RandomSource }): GameEngine {
    const adoptRandom = (cfg: Record<string, unknown> | undefined): void => {
        if (cfg && typeof cfg.random === 'function') {
        }
    };

    const readHasta = (cfg: Record<string, unknown> | undefined): number => {
        const hasta = Number(cfg?.hasta) || DEFAULT_HASTA;
        return clamp(hasta, 3, MAX_HASTA);
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): CuentaConmigoState => {
        adoptRandom(cfg);
        const state: CuentaConmigoState = {
            siguiente: 2,
            hasta: readHasta(cfg),
            phase: 'announce',
        };
        session.state = state as unknown as Record<string, unknown>;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'cuenta_conmigo',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession {
            adoptRandom(optionsConfig);
            return {
                id: 'cuenta_conmigo',
                state: {
                    siguiente: 2,
                    hasta: readHasta(optionsConfig),
                    phase: 'announce',
                },
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as unknown as CuentaConmigoState;
            return {
                prompt: `¡Vamos a contar juntos del 1 al ${state.hasta}! Yo digo 1. ¿Qué número sigue?`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'excited',
            };
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as unknown as CuentaConmigoState;

            if (state.phase === 'done') {
                return {
                    prompt: 'Ya terminamos de contar. ¿Contamos otra vez?',
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'happy',
                };
            }

            const normalized = normalizeForMatch(text);

            // ¿Pide pista?
            if (hasAnyToken(normalized, HINT_FRAMES)) {
                return {
                    prompt: `El número que sigue es el ${state.siguiente}. Dilo para seguir contando.`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'thinking',
                };
            }

            const numero = resolveNumericAnswer(normalized);

            // ¿Dice el número correcto?
            if (numero === state.siguiente) {
                session.score += 1;
                session.round += 1;
                state.siguiente += 1;
                if (state.siguiente > state.hasta) {
                    state.phase = 'done';
                    return {
                        prompt: `¡Contamos del 1 al ${state.hasta}! Dijiste ${session.score} números seguidos. ¡Eres un gran contador!`,
                        valid: true,
                        gameOver: true,
                        score: session.score,
                        animation: 'Dance',
                        emotion: 'happy',
                    };
                }
                return {
                    prompt: `¡Sí, el ${state.siguiente - 1}! Ahora dime: ¿qué número sigue después del ${state.siguiente - 1}?`,
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
                state.siguiente += 1;
                if (state.siguiente > state.hasta) {
                    state.phase = 'done';
                    return {
                        prompt: `Terminamos de contar hasta ${state.hasta}. ¡Muy bien jugado!`,
                        valid: false,
                        gameOver: true,
                        score: session.score,
                        animation: 'Dance',
                        emotion: 'happy',
                    };
                }
                return {
                    prompt: `El ${state.siguiente - 1}. Ahora dime el que sigue.`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                };
            }

            // Número incorrecto o no reconocido → reintenta.
            return {
                prompt: `Casi... Estamos en el ${state.siguiente - 1}. ¿Qué número va después?`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'encouraging',
                error: 'número incorrecto',
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
