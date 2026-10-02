// ============================================================
// src/core/games/respiracion.ts
// Respiración guiada (plan-juegos §Fase 3, Riesgo 3).
// Motor puro sin I/O.
//
// FLU guía ciclos de respiración: inhala (pasos pares) y exhala
// (pasos impares). El niño avanza cuando dice "listo" / "sigue"
// o cuando cuenta 1-4 (dígitos o palabras). Es un juego de
// calma: NO hay respuestas incorrectas, solo recordatorios.
//
// Controles:
//   "pista" / "ayuda"  → repite la instrucción actual
//   "listo" / "sigue" / contar 1-4 → pasa al siguiente paso
// Fin al completar `rondas` ciclos (rondas × 2 pasos).
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';
import { isGameCommandSurface, END_GAME_FRAMES, HELP_CORE_FRAMES, clamp, gameOverResult, hasAnyToken, normalizeForMatch, resolveNumericAnswer, turnResult } from './gameUtils';

const DEFAULT_RONDAS = 4;
const MAX_RONDAS = 6;

const HINT_FRAMES: readonly string[] = Object.freeze([
    ...HELP_CORE_FRAMES,
    'otra vez', 'no entendi', 'no entendí',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'sigue', 'listo', 'ok', 'hecho', 'continuemos', 'adelante', 'ya',
]);

const END_FRAMES: readonly string[] = END_GAME_FRAMES;

type RandomSource = () => number;

interface RespiracionState {
    step: number;
    totalSteps: number;
    phase: 'announce' | 'breathing' | 'done';
}

function stepPrompt(step: number): string {
    return step % 2 === 0
        ? 'Inhala por la nariz contando hasta 4. Aguanta un segundo.'
        : 'Exhala por la boca contando hasta 4. Suelta todo el aire poco a poco.';
}

export function createRespiracionEngine(_options?: { random?: RandomSource }): GameEngine<RespiracionState> {
    const readRondas = (cfg: Record<string, unknown> | undefined): number => {
        const rondas = Number(cfg?.rondas) || Number(cfg?.defaultRondas) || DEFAULT_RONDAS;
        return clamp(rondas, 1, MAX_RONDAS);
    };

    const buildState = (cfg: Record<string, unknown> | undefined): RespiracionState => {
        return {
            step: 0,
            totalSteps: readRondas(cfg) * 2,
            phase: 'breathing',
        };
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): RespiracionState => {
        const state: RespiracionState = buildState(cfg);
        session.state = state;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'respiracion',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<RespiracionState> {
            const state = buildState(optionsConfig);
            return {
                id: 'respiracion',
                state,
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as RespiracionState;
            return turnResult(`Vamos a calmarnos respirando juntos. ${stepPrompt(state.step)} Dime "listo" cuando termines.`, session.score, { emotion: 'excited' });
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as RespiracionState;

            if (state.phase === 'done') {
                return gameOverResult('Ya respiramos tranquilos. ¿Quieres hacer otro ejercicio?', session.score);
            }

            const normalized = normalizeForMatch(text);

            // ¿Pide repetir la instrucción?
            if (hasAnyToken(normalized, HINT_FRAMES)) {
                return turnResult(`Claro, te repito: ${stepPrompt(state.step)} Dime "listo" cuando termines.`, session.score, { emotion: 'thinking' });
            }

            // Avanza si dice "listo"/"sigue" o si cuenta 1-4 (respiró al ritmo).
            const numero = resolveNumericAnswer(normalized);
            const avanza = hasAnyToken(normalized, SKIP_FRAMES)
                || (numero !== null && numero >= 1 && numero <= 4);
            if (avanza) {
                state.step += 1;
                if (state.step >= state.totalSteps) {
                    state.phase = 'done';
                    return gameOverResult(
                            `¡Muy bien! Respíramos ${state.totalSteps / 2} veces. Ahora te sientes más tranquilo, ¿verdad?`,
                            session.score,
                            { valid: true, won: true, animation: 'Dance' },
                        );
                }
                return turnResult(`¡Sigue respirando! ${stepPrompt(state.step)} Dime "listo" cuando termines.`, session.score, { valid: true, emotion: 'happy' });
            }

            // Recordatorio amable (nunca hay error real en un ejercicio de calma).
            return turnResult(`Concéntrate en tu respiración. ${stepPrompt(state.step)} Dime "listo" cuando termines.`, session.score, { emotion: 'encouraging' });
        },

        isGameCommand(text = ''): boolean {
            const normalized = normalizeForMatch(text);
            return isGameCommandSurface(normalized, { end: END_FRAMES, hint: HINT_FRAMES, skip: SKIP_FRAMES });
        },
    };
}
export const RESPIRACION_COMMAND_FRAMES = Object.freeze({ HINT_FRAMES, SKIP_FRAMES, END_FRAMES })
