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
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';

const DEFAULT_MIN = 1;
const DEFAULT_MAX = 20;
const DEFAULT_PISTAS_MAX = 5;
const MAX_RANGE = 100;

const HINT_FRAMES: readonly string[] = Object.freeze([
    'pista', 'ayuda', 'ayudame', 'dame una pista', 'otra pista',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'me rindo', 'rendirse', 'no se', 'no sé', 'no se la respuesta',
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

function pickNumber(min: number, max: number, rng: RandomSource): number {
    const range = max - min + 1;
    return min + Math.floor(rng() * range);
}

/**
 * Resuelve una respuesta numérica a partir del texto normalizado.
 * Espejo local del algoritmo de resolveNumberValue: primero dígitos
 * ("12", "3.5", "1,5") y, si no hay, un número escrito en letras.
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

export function createAdivinaNumeroEngine(options?: { random?: RandomSource }): GameEngine {
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

    const adoptRandom = (cfg: Record<string, unknown> | undefined): void => {
        if (cfg && typeof cfg.random === 'function') {
            rng = cfg.random as RandomSource;
        }
    };

    return {
        id: 'adivina_numero',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession {
            adoptRandom(optionsConfig);
            const cfg = readConfig(optionsConfig);
            return {
                id: 'adivina_numero',
                state: {
                    number: pickNumber(cfg.min, cfg.max, rng),
                    min: cfg.min,
                    max: cfg.max,
                    pistasUsadas: 0,
                    pistasMax: cfg.pistasMax,
                    intentos: 0,
                    lastDistance: null,
                    phase: 'announce',
                },
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            adoptRandom(optionsConfig);
            const cfg = readConfig(optionsConfig);
            const state = session.state as unknown as AdivinaNumeroState;
            state.number = pickNumber(cfg.min, cfg.max, rng);
            state.min = cfg.min;
            state.max = cfg.max;
            state.pistasUsadas = 0;
            state.pistasMax = cfg.pistasMax;
            state.intentos = 0;
            state.lastDistance = null;
            state.phase = 'announce';
            session.score = 0;
            session.round = 1;
            return {
                prompt: `¡Vamos a jugar a adivinar el número! Estoy pensando en un número entre ${state.min} y ${state.max}. ¿Cuál es?`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'excited',
            };
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as unknown as AdivinaNumeroState;

            if (state.phase === 'done') {
                return {
                    prompt: 'Ya terminamos de adivinar el número. ¿Jugamos otra vez?',
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'happy',
                };
            }

            const normalized = normalizeForMatch(text);

            // ¿Pide pista (paridad)?
            if (hasAnyToken(normalized, HINT_FRAMES)) {
                if (state.pistasUsadas >= state.pistasMax) {
                    return {
                        prompt: 'Ya te di todas mis pistas. ¡Sigue adivinando!',
                        valid: false,
                        gameOver: false,
                        score: session.score,
                        animation: 'Idle',
                        emotion: 'neutral',
                    };
                }
                state.pistasUsadas += 1;
                const par = state.number % 2 === 0 ? 'par' : 'impar';
                return {
                    prompt: `Te doy una pista: mi número es ${par}.`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'thinking',
                };
            }

            // ¿Se rinde / no sabe la respuesta?
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                state.phase = 'done';
                return {
                    prompt: `¡El número era ${state.number}! Terminamos con ${session.score} puntos. ¡Muy bien jugado!`,
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'happy',
                };
            }

            // Intento numérico.
            const guess = resolveNumericAnswer(normalized);
            if (guess === null) {
                return {
                    prompt: `No logré reconocer un número. Dime un número entre ${state.min} y ${state.max}.`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                    error: 'no se reconoció ningún número',
                };
            }
            if (guess < state.min || guess > state.max) {
                return {
                    prompt: `Mi número está entre ${state.min} y ${state.max}. Inténtalo otra vez.`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                    error: 'número fuera de rango',
                };
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
                return {
                    prompt: `¡Correcto! El número era ${state.number}. Lo adivinaste en ${state.intentos} ${state.intentos === 1 ? 'intento' : 'intentos'}. ¡Eres un genio!`,
                    valid: true,
                    gameOver: true,
                    score: session.score,
                    animation: 'Dance',
                    emotion: 'happy',
                };
            }
            if (guess < state.number) {
                return {
                    prompt: `Mi número es más grande que ${guess}. ${heat} Sigue intentando.`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'encouraging',
                };
            }
            return {
                prompt: `Mi número es más pequeño que ${guess}. ${heat} Sigue intentando.`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'encouraging',
            };
        },

        isGameCommand(text = ''): boolean {
            const normalized = normalizeForMatch(text);
            return END_FRAMES.some((frame) => normalized.includes(frame))
                || HINT_FRAMES.some((frame) => hasToken(normalized, frame))
                || SKIP_FRAMES.some((frame) => hasToken(normalized, frame));
        },
    };
}
