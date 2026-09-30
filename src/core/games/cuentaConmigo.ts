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
import { END_GAME_FRAMES, HELP_CORE_FRAMES, clamp, gameOverResult, hasAnyToken, matchesEndGameFrames, normalizeForMatch, resolveNumericAnswer, turnResult } from './gameUtils';

const DEFAULT_HASTA = 10;
const MAX_HASTA = 20;

const HINT_FRAMES: readonly string[] = Object.freeze([
    ...HELP_CORE_FRAMES,
    'no se', 'no sé', 'cual sigue',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'siguiente', 'sigue', 'sigue tu', 'tu sigue', 'adelante',
]);

const END_FRAMES: readonly string[] = END_GAME_FRAMES;

type RandomSource = () => number;

interface CuentaConmigoState {
    siguiente: number;
    hasta: number;
    phase: 'announce' | 'done';
}

export function createCuentaConmigoEngine(_options?: { random?: RandomSource }): GameEngine<CuentaConmigoState> {
    const readHasta = (cfg: Record<string, unknown> | undefined): number => {
        const hasta = Number(cfg?.hasta) || DEFAULT_HASTA;
        return clamp(hasta, 3, MAX_HASTA);
    };

    const buildState = (cfg: Record<string, unknown> | undefined): CuentaConmigoState => {
        return {
            siguiente: 2,
            hasta: readHasta(cfg),
            phase: 'announce',
        };
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): CuentaConmigoState => {
        const state: CuentaConmigoState = buildState(cfg);
        session.state = state;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'cuenta_conmigo',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<CuentaConmigoState> {
            return {
                id: 'cuenta_conmigo',
                state: buildState(optionsConfig),
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as CuentaConmigoState;
            return turnResult(`¡Vamos a contar juntos del 1 al ${state.hasta}! Yo digo 1. ¿Qué número sigue?`, session.score, { emotion: 'excited' });
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as CuentaConmigoState;

            if (state.phase === 'done') {
                return gameOverResult('Ya terminamos de contar. ¿Contamos otra vez?', session.score);
            }

            const normalized = normalizeForMatch(text);

            // ¿Pide pista?
            if (hasAnyToken(normalized, HINT_FRAMES)) {
                return turnResult(`El número que sigue es el ${state.siguiente}. Dilo para seguir contando.`, session.score, { emotion: 'thinking' });
            }

            const numero = resolveNumericAnswer(normalized);

            // ¿Dice el número correcto?
            if (numero === state.siguiente) {
                session.score += 1;
                session.round += 1;
                state.siguiente += 1;
                if (state.siguiente > state.hasta) {
                    state.phase = 'done';
                    return gameOverResult(
                            `¡Contamos del 1 al ${state.hasta}! Dijiste ${session.score} números seguidos. ¡Eres un gran contador!`,
                            session.score,
                            { valid: true, won: true, animation: 'Dance' },
                        );
                }
                return turnResult(`¡Sí, el ${state.siguiente - 1}! Ahora dime: ¿qué número sigue después del ${state.siguiente - 1}?`, session.score, { valid: true, animation: 'Jump_in_place', emotion: 'happy' });
            }

            // ¿Salta?
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                session.round += 1;
                state.siguiente += 1;
                if (state.siguiente > state.hasta) {
                    state.phase = 'done';
                    return gameOverResult(
                            `Terminamos de contar hasta ${state.hasta}. ¡Muy bien jugado!`,
                            session.score,
                            { animation: 'Dance' },
                        );
                }
                return turnResult(`El ${state.siguiente - 1}. Ahora dime el que sigue.`, session.score);
            }

            // Número incorrecto o no reconocido → reintenta.
            return turnResult(`Casi... Estamos en el ${state.siguiente - 1}. ¿Qué número va después?`, session.score, { emotion: 'encouraging', error: 'número incorrecto' });
        },

        isGameCommand(text = ''): boolean {
            const normalized = normalizeForMatch(text);
            return matchesEndGameFrames(normalized, END_FRAMES)
                || HINT_FRAMES.some((frame) => hasAnyToken(normalized, [frame]))
                || SKIP_FRAMES.some((frame) => hasAnyToken(normalized, [frame]));
        },
    };
}
// Superficie de comandos PUBLICADA como dato, con nombre CALIFICADO por motor:
// los simbolos exportados deben ser unicos (un `HINT_FRAMES` por modulo choca).
export const CUENTA_CONMIGO_COMMAND_FRAMES = Object.freeze({ HINT_FRAMES, SKIP_FRAMES, END_FRAMES })
