// ============================================================
// src/core/games/adivinaNumero.ts
// Adivina el número (plan-juegos §4). Motor puro sin I/O.
//
// FLU piensa un número en [min, max] y el niño adivina. Cada
// intento numérico devuelve mayor/menor con indicador frío/caliente
// (se compara la distancia al número oculto con la del intento
// anterior). Pista a petición revela la paridad hasta `pistasMax`.
//
// Resolución numérica LOCAL (espejo del algoritmo de
// resolveNumberValue de configCommands.js, sin imports .js para
// respetar la convención de módulo autónomo): dígitos "12"/"3.5"
// o números en letras ("quince", "dos").
//
// - Acierto → +1 punto y fin de partida.
// - "paso" / "no sé" → revela el número y termina.
// ============================================================
import type { GameEngine } from './gameEngine.ts';
import type { GameSession, GameTurnResult } from './types.ts';
import { END_GAME_FRAMES, HELP_CORE_FRAMES, adoptRandom, baseSession, clamp, gameOverResult, hasAnyToken, isEngineCommand, normalizeForMatch, resolveNumericAnswer, turnResult } from './gameUtils.ts';

const DEFAULT_MIN = 1;
const DEFAULT_MAX = 20;
const DEFAULT_PISTAS_MAX = 5;
const MAX_RANGE = 100;

const HINT_FRAMES: readonly string[] = Object.freeze([
    ...HELP_CORE_FRAMES,
    'dame una pista', 'otra pista',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'me rindo', 'rendirse', 'no se', 'no sé', 'no se la respuesta',
]);

const END_FRAMES: readonly string[] = END_GAME_FRAMES;

/** Números en letras (0-100) y su resolución: fuente única en gameUtils. */

interface AdivinaNumeroConfig {
    min: number;
    max: number;
    pistasMax: number;
}

interface AdivinaNumeroState {
    number: number;
    min: number;
    max: number;
    pistasUsadas: number;
    pistasMax: number;
    intentos: number;
    lastDistance: number | null;
    phase: 'announce' | 'done';
}

type RandomSource = () => number;

function pickNumber(min: number, max: number, rng: RandomSource): number {
    const range = max - min + 1;
    return min + Math.floor(rng() * range);
}

/**
 * Resolución de respuesta numérica: fuente única en `gameUtils`
 * (dígitos, palabras 0-100 y compuestos "treinta y cinco").
 */

export function createAdivinaNumeroEngine(options?: { random?: RandomSource }): GameEngine<AdivinaNumeroState> {
    let rng: RandomSource = options?.random ?? Math.random;

    const readConfig = (cfg: Record<string, unknown> | undefined): AdivinaNumeroConfig => {
        const min = clamp(Number(cfg?.min) || DEFAULT_MIN, 1, MAX_RANGE);
        const max = clamp(Number(cfg?.max) || DEFAULT_MAX, 1, MAX_RANGE);
        const pistasMax = clamp(Number(cfg?.pistasMax) || DEFAULT_PISTAS_MAX, 0, 10);
        return {
            min: Math.min(min, max),
            max: Math.max(min, max),
            pistasMax,
        };
    };

    const buildState = (cfg: Record<string, unknown> | undefined): AdivinaNumeroState => {
        rng = adoptRandom(rng, cfg);
        const config = readConfig(cfg);
        return {
            number: pickNumber(config.min, config.max, rng),
            min: config.min,
            max: config.max,
            pistasUsadas: 0,
            pistasMax: config.pistasMax,
            intentos: 0,
            lastDistance: null,
            phase: 'announce',
        };
    };

    return {
        id: 'adivina_numero',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<AdivinaNumeroState> {
            return baseSession('adivina_numero', buildState(optionsConfig));
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            const state = buildState(optionsConfig);
            session.state = state;
            session.score = 0;
            session.round = 1;
            return turnResult(`¡Vamos a jugar a adivinar el número! Estoy pensando en un número entre ${state.min} y ${state.max}. ¿Cuál es?`, session.score, { emotion: 'excited' });
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as AdivinaNumeroState;

            if (state.phase === 'done') {
                return gameOverResult('Ya terminamos de adivinar el número. ¿Jugamos otra vez?', session.score);
            }

            const normalized = normalizeForMatch(text);

            // ¿Pide pista? Progresiva: paridad → mayor/menor que el medio →
            // rango cercano. Antes repetía la MISMA paridad hasta `pistasMax`.
            if (hasAnyToken(normalized, HINT_FRAMES)) {
                const half = Math.floor((state.min + state.max) / 2);
                const margin = Math.max(1, Math.round((state.max - state.min) / 4));
                const hints: string[] = [
                    `mi número es ${state.number % 2 === 0 ? 'par' : 'impar'}`,
                    `mi número es ${state.number > (state.min + state.max) / 2 ? 'mayor' : 'menor'} que ${half}`,
                    `mi número está entre ${Math.max(state.min, state.number - margin)} y ${Math.min(state.max, state.number + margin)}`,
                ];
                if (state.pistasUsadas >= state.pistasMax || state.pistasUsadas >= hints.length) {
                    return turnResult('Ya te di todas mis pistas. ¡Sigue adivinando!', session.score);
                }
                const hint = hints[state.pistasUsadas];
                state.pistasUsadas += 1;
                return turnResult(`Te doy una pista: ${hint}.`, session.score, { emotion: 'thinking' });
            }

            // ¿Se rinde / no sabe la respuesta? → derrota (sin grito de victoria).
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                state.phase = 'done';
                return gameOverResult(
                        `¡El número era ${state.number}! Terminamos con ${session.score} puntos. ¡Otra vez será!`,
                        session.score,
                        { emotion: 'encouraging' },
                    );
            }

            // Intento numérico.
            const guess = resolveNumericAnswer(normalized);
            if (guess === null) {
                return turnResult(`No logré reconocer un número. Dime un número entre ${state.min} y ${state.max}.`, session.score, { error: 'no se reconoció ningún número' });
            }
            if (guess < state.min || guess > state.max) {
                return turnResult(`Mi número está entre ${state.min} y ${state.max}. Inténtalo otra vez.`, session.score, { error: 'número fuera de rango' });
            }

            state.intentos += 1;
            const distance = Math.abs(state.number - guess);
            const heat = state.lastDistance === null
                ? (distance <= 3 ? '¡Estás caliente!' : 'Estás frío.')
                : (distance < state.lastDistance ? '¡Estás caliente!' : 'Estás frío.');
            state.lastDistance = distance;

            if (guess === state.number) {
                session.score += 1;
                state.phase = 'done';
                return gameOverResult(
                        `¡Correcto! El número era ${state.number}. Lo adivinaste en ${state.intentos} ${state.intentos === 1 ? 'intento' : 'intentos'}. ¡Eres un genio!`,
                        session.score,
                        { valid: true, won: true, animation: 'Dance' },
                    );
            }
            if (guess < state.number) {
                return turnResult(`Mi número es más grande que ${guess}. ${heat} Sigue intentando.`, session.score, { emotion: 'encouraging' });
            }
            return turnResult(`Mi número es más pequeño que ${guess}. ${heat} Sigue intentando.`, session.score, { emotion: 'encouraging' });
        },

        isGameCommand(text = ''): boolean {
            return isEngineCommand(text, { end: END_FRAMES, hint: HINT_FRAMES, skip: SKIP_FRAMES });
        },
    };
}
export const ADIVINA_NUMERO_COMMAND_FRAMES = Object.freeze({ HINT_FRAMES, SKIP_FRAMES, END_FRAMES })
