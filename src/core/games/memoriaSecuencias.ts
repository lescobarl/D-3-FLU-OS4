// ============================================================
// src/core/games/memoriaSecuencias.ts
// Memoria de secuencias (plan-juegos §Fase 3, Riesgo 3).
// Motor puro sin I/O, estilo simonDice pero con letras.
//
// FLU anuncia una secuencia de letras (A B C) que crece cada
// ronda; el jugador la repite en orden. Validación por
// subsecuencia ordenada (transcripción ruidosa).
//
// Controles:
//   "pista" / "ayuda"     → repite la secuencia
//   "paso" / "siguiente"  → salta la ronda sin puntuar
// Fin al completar `rounds` rondas.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';
import {
    clamp, normalizeForMatch, hasToken, hasAnyToken,
} from './gameUtils';

export const MEMORY_LETTERS: readonly string[] = Object.freeze([
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H',
]);

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = 6;
const DEFAULT_LONG_MAX = 6;
const MAX_LONG_MAX = MEMORY_LETTERS.length;

const HINT_FRAMES: readonly string[] = Object.freeze([
    'pista', 'ayuda', 'ayudame', 'repite', 'no escuche', 'no escuché',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'siguiente', 'otra', 'sigo', 'no se', 'no sé',
]);

const END_FRAMES: readonly string[] = Object.freeze([
    'salir del juego',
    'terminar el juego',
    'dejar de jugar',
    'ya no quiero jugar',
    'cerrar el juego',
]);

type RandomSource = () => number;

interface MemoriaSecuenciasState {
    sequence: string[];
    cursor: number;
    maxRounds: number;
    longMax: number;
    phase: 'announce' | 'done';
}

function buildSequence(length: number, rng: RandomSource): string[] {
    const seq: string[] = [];
    for (let i = 0; i < length; i += 1) {
        seq.push(MEMORY_LETTERS[Math.floor(rng() * MEMORY_LETTERS.length)]);
    }
    return seq;
}

function sequencePrompt(sequence: readonly string[]): string {
    return sequence.join(' ');
}

/**
 * Nombres hablados de las letras del juego (A–H) → letra. El ASR transcribe
 * "be", "efe", "hache"… no "b", "f", "h"; sin este mapeo una secuencia dicha
 * correctamente se rechazaba.
 */
const LETTER_NAME_TO_LETTER: Readonly<Record<string, string>> = Object.freeze({
    a: 'A', be: 'B', ce: 'C', de: 'D', e: 'E', efe: 'F', ge: 'G', hache: 'H',
});

function extractLetters(normalized: string): string[] {
    const out: string[] = [];
    for (const raw of normalized.split(/\s+/)) {
        const clean = raw.replace(/[^a-z]/g, '');
        if (!clean) continue;
        if (clean.length === 1) {
            const upper = clean.toUpperCase();
            if (MEMORY_LETTERS.includes(upper)) out.push(upper);
            continue;
        }
        const mapped = LETTER_NAME_TO_LETTER[clean];
        if (mapped && MEMORY_LETTERS.includes(mapped)) out.push(mapped);
    }
    return out;
}

function isOrderedMatch(sub: readonly string[], seq: readonly string[]): boolean {
    let cursor = 0;
    for (const item of sub) {
        if (item === seq[cursor]) cursor += 1;
        if (cursor >= seq.length) return true;
    }
    return cursor >= seq.length;
}

export function createMemoriaSecuenciasEngine(options?: { random?: RandomSource }): GameEngine {
    let rng: RandomSource = options?.random ?? Math.random;

    const adoptRandom = (cfg: Record<string, unknown> | undefined): void => {
        if (cfg && typeof cfg.random === 'function') {
            rng = cfg.random as RandomSource;
        }
    };

    const readRounds = (cfg: Record<string, unknown> | undefined): number => {
        const rounds = Number(cfg?.rounds) || Number(cfg?.defaultRounds) || DEFAULT_ROUNDS;
        return clamp(rounds, 1, MAX_ROUNDS);
    };

    const readLongMax = (cfg: Record<string, unknown> | undefined): number => {
        const longMax = Number(cfg?.longMax) || Number(cfg?.longitudMax) || DEFAULT_LONG_MAX;
        return clamp(longMax, 1, MAX_LONG_MAX);
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): MemoriaSecuenciasState => {
        adoptRandom(cfg);
        const state: MemoriaSecuenciasState = {
            sequence: buildSequence(2, rng),
            cursor: 0,
            maxRounds: readRounds(cfg),
            longMax: readLongMax(cfg),
            phase: 'announce',
        };
        session.state = state as unknown as Record<string, unknown>;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'memoria_secuencias',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession {
            adoptRandom(optionsConfig);
            return {
                id: 'memoria_secuencias',
                state: {
                    sequence: buildSequence(2, rng),
                    cursor: 0,
                    maxRounds: readRounds(optionsConfig),
                    longMax: readLongMax(optionsConfig),
                    phase: 'announce',
                },
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as unknown as MemoriaSecuenciasState;
            return {
                prompt: `¡Vamos a entrenar la memoria! Memoriza esta secuencia: ${sequencePrompt(state.sequence)}. Repítela en orden.`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'excited',
            };
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as unknown as MemoriaSecuenciasState;

            if (state.phase === 'done') {
                return {
                    prompt: 'Ya terminamos con la memoria. ¿Jugamos otra vez?',
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'happy',
                };
            }

            const normalized = normalizeForMatch(text);
            const finish = (prompt: string, valid: boolean, emotion: string): GameTurnResult => {
                state.phase = 'done';
                return {
                    prompt,
                    valid,
                    gameOver: true,
                    score: session.score,
                    animation: 'Dance',
                    emotion,
                };
            };

            // ¿Pide pista?
            if (hasAnyToken(normalized, HINT_FRAMES)) {
                return {
                    prompt: `La secuencia es: ${sequencePrompt(state.sequence)}. Repítela en orden.`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'thinking',
                };
            }

            const letters = extractLetters(normalized);

            // ¿Repite la secuencia correctamente?
            if (letters.length > 0 && isOrderedMatch(letters, state.sequence)) {
                session.score += 1;
                session.round += 1;
                const nextLength = Math.min(state.sequence.length + 1, state.longMax);
                if (session.round > state.maxRounds) {
                    return finish(`¡Memoria de elefante! Completaste ${state.maxRounds} rondas con ${session.score} puntos. ¡Eres muy listo!`, true, 'happy');
                }
                state.sequence = buildSequence(nextLength, rng);
                return {
                    prompt: `¡Exacto! ${sequencePrompt(letters)}. Siguiente secuencia: ${sequencePrompt(state.sequence)}. Repítela.`,
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
                if (session.round > state.maxRounds) {
                    return finish(`Terminamos con ${session.score} puntos. ¡Muy bien jugado!`, false, 'happy');
                }
                const nextLength = Math.min(state.sequence.length + 1, state.longMax);
                state.sequence = buildSequence(nextLength, rng);
                return {
                    prompt: `¡Claro! Siguiente secuencia: ${sequencePrompt(state.sequence)}. Repítela.`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                };
            }

            // Intentó pero falló → reintenta la misma secuencia.
            if (letters.length > 0) {
                return {
                    prompt: `Casi. La secuencia era ${sequencePrompt(state.sequence)}. Inténtalo de nuevo.`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'encouraging',
                    error: 'secuencia incorrecta',
                };
            }

            return {
                prompt: `No te escuché bien. Repite la secuencia: ${sequencePrompt(state.sequence)}.`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'neutral',
                error: 'sin letras reconocidas',
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
