// ============================================================
// src/core/games/simonDice.ts
// Simón dice (plan-juegos §4). Motor puro sin I/O.
//
// FLU anuncia la secuencia completa (que crece cada ronda) y el
// niño la repite. Validación por subsecuencia ordenada y tolerante
// a palabras de relleno: "baila y luego salta" → ['Dance','Jump'].
//
// - Éxito exacto (hizo toda la secuencia en orden) → avanza ronda.
// - Prefix (empezó bien pero incompleto) → "sigue".
// - Desorden / no coincidencia → reintento con la misma secuencia.
// - Fin al alcanzar `rounds` (o `longMax` verbos).
//
// El RNG es inyectable vía options.random para tests deterministas.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { AvatarAnimation, GameSession, GameTurnResult } from './types';

export const VERB_ALIASES: Record<AvatarAnimation, readonly string[]> = {
    Dance: ['baila', 'bailar', 'baile', 'dance', 'bailemos'],
    Run: ['corre', 'correr', 'corri', 'run'],
    Walk: ['camina', 'caminar', 'camino', 'walk'],
    Jump_in_place: ['salta', 'saltar', 'salto', 'brinca', 'brincar', 'jump'],
    Idle: ['quieto', 'detente', 'parate', 'idle'],
};

const VERB_DISPLAY: Record<AvatarAnimation, string> = {
    Dance: 'baila',
    Run: 'corre',
    Walk: 'camina',
    Jump_in_place: 'salta',
    Idle: 'quédate quieto',
};

const DEFAULT_VERBOS: readonly AvatarAnimation[] = ['Dance', 'Run', 'Walk', 'Jump_in_place'];
const DEFAULT_ROUNDS = 3;
const DEFAULT_LONG_MAX = 5;
const MAX_ROUNDS = 12;
const MAX_LONG = 10;

const END_FRAMES: readonly string[] = Object.freeze([
    'salir del juego',
    'terminar el juego',
    'dejar de jugar',
    'ya no quiero jugar',
    'cerrar el juego',
]);

const CONTINUE_FRAMES: readonly string[] = Object.freeze([
    'sigo jugando',
    'sigamos',
    'continua',
    'continua jugando',
    'otra vez',
    'repite',
    'no entendi',
]);

interface SimonDiceConfig {
    verbos: AvatarAnimation[];
    rounds: number;
    longMax: number;
}

interface SimonDiceState {
    verbos: AvatarAnimation[];
    sequence: AvatarAnimation[];
    maxRounds: number;
    longMax: number;
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

function pickRandom<T>(items: readonly T[], rng: RandomSource): T {
    return items[Math.floor(rng() * items.length)];
}

/** Extrae los verbos mencionados en el texto, en orden, ignorando relleno. */
function extractOrderedVerbs(normalized: string, verbos: readonly AvatarAnimation[]): AvatarAnimation[] {
    const result: AvatarAnimation[] = [];
    const tokens = normalized.split(/\s+/);
    for (const token of tokens) {
        for (const verb of verbos) {
            if (VERB_ALIASES[verb].includes(token)) {
                result.push(verb);
                break;
            }
        }
    }
    return result;
}

/** ¿Es `sub` una subsecuencia ordenada de `seq`? */
function isOrderedSubsequence(sub: readonly AvatarAnimation[], seq: readonly AvatarAnimation[]): boolean {
    let cursor = 0;
    for (let i = 0; i < seq.length && cursor < sub.length; i += 1) {
        if (sub[cursor] === seq[i]) cursor += 1;
    }
    return cursor === sub.length;
}

function describeSequence(sequence: readonly AvatarAnimation[]): string {
    return sequence.map((verb) => VERB_DISPLAY[verb]).join(' y ');
}

function announcePrompt(sequence: readonly AvatarAnimation[]): GameTurnResult {
    return {
        prompt: `¡Simón dice: ${describeSequence(sequence)}! Repite los movimientos en el mismo orden.`,
        valid: false,
        gameOver: false,
        score: 0,
        animation: sequence[0] ?? 'Idle',
        emotion: 'excited',
    };
}

function growSequence(current: readonly AvatarAnimation[], verbos: readonly AvatarAnimation[], rng: RandomSource): AvatarAnimation[] {
    const last = current[current.length - 1];
    const pool = verbos.length > 1 ? verbos.filter((verb) => verb !== last) : verbos;
    const next = pickRandom(pool, rng);
    return [...current, next];
}

export function createSimonDiceEngine(options?: { random?: RandomSource }): GameEngine {
    let rng: RandomSource = options?.random ?? Math.random;

    const readConfig = (cfg: Record<string, unknown> | undefined): SimonDiceConfig => {
        const verbos = Array.isArray(cfg?.verbos)
            ? (cfg.verbos as unknown[]).filter((verb): verb is AvatarAnimation =>
                  typeof verb === 'string' && verb in VERB_DISPLAY)
            : [...DEFAULT_VERBOS];
        const rounds = clamp(Number(cfg?.rounds) || DEFAULT_ROUNDS, 1, MAX_ROUNDS);
        const longMax = clamp(Number(cfg?.longMax) || DEFAULT_LONG_MAX, 1, MAX_LONG);
        return {
            verbos: verbos.length > 0 ? verbos : [...DEFAULT_VERBOS],
            rounds,
            longMax,
        };
    };

    const adoptRandom = (cfg: Record<string, unknown> | undefined): void => {
        if (cfg && typeof cfg.random === 'function') {
            rng = cfg.random as RandomSource;
        }
    };

    return {
        id: 'simon_dice',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession {
            adoptRandom(optionsConfig);
            const cfg = readConfig(optionsConfig);
            return {
                id: 'simon_dice',
                state: {
                    verbos: cfg.verbos,
                    sequence: [],
                    maxRounds: cfg.rounds,
                    longMax: cfg.longMax,
                    phase: 'announce',
                },
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            adoptRandom(optionsConfig);
            const cfg = readConfig(optionsConfig);
            const state = session.state as unknown as SimonDiceState;
            state.verbos = cfg.verbos;
            state.maxRounds = cfg.rounds;
            state.longMax = cfg.longMax;
            state.sequence = [pickRandom(cfg.verbos, rng)];
            state.phase = 'announce';
            session.score = 0;
            session.round = 1;
            return announcePrompt(state.sequence);
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as unknown as SimonDiceState;

            if (state.phase === 'done') {
                return {
                    prompt: 'Ya terminamos de jugar Simón dice. ¿Quieres empezar otra partida?',
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'happy',
                };
            }

            if (!state.sequence || state.sequence.length === 0) {
                // start() no fue invocado; arranca limpio.
                return this.start(session, {});
            }

            const got = extractOrderedVerbs(normalizeForMatch(text), state.verbos);
            if (got.length === 0) {
                return {
                    prompt: `No logré reconocer un movimiento. Repite: ${describeSequence(state.sequence)}.`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: state.sequence[0] ?? 'Idle',
                    emotion: 'neutral',
                    error: 'no se reconoció ningún verbo de movimiento',
                };
            }

            const expected = state.sequence;

            // ¿Hizo toda la secuencia requerida (en orden, con relleno)?
            if (isOrderedSubsequence(expected, got)) {
                session.score += 1;
                const isLastRound = session.round >= state.maxRounds || expected.length >= state.longMax;
                if (isLastRound) {
                    state.phase = 'done';
                    return {
                        prompt: `¡Perfecto! Completaste ${session.round} ${session.round === 1 ? 'ronda' : 'rondas'} de Simón dice. ¡Eres increíble!`,
                        valid: true,
                        gameOver: true,
                        score: session.score,
                        animation: 'Dance',
                        emotion: 'happy',
                    };
                }
                session.round += 1;
                state.sequence = growSequence(expected, state.verbos, rng);
                state.phase = 'announce';
                return {
                    ...announcePrompt(state.sequence),
                    valid: true,
                    score: session.score,
                };
            }

            // ¿Empezó bien pero incompleto? → "sigue".
            if (got.length < expected.length && isOrderedSubsequence(got, expected)) {
                const remaining = expected.slice(got.length);
                return {
                    prompt: `¡Vas muy bien! Sigue: ${describeSequence(remaining)}.`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: remaining[0] ?? state.sequence[0] ?? 'Idle',
                    emotion: 'excited',
                };
            }

            // Desorden / movimientos de más.
            return {
                prompt: `¡Casi! Inténtalo de nuevo en orden: ${describeSequence(expected)}.`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: expected[0] ?? 'Idle',
                emotion: 'encouraging',
                error: 'secuencia en desorden o con movimientos de más',
            };
        },

        isGameCommand(text = ''): boolean {
            const normalized = normalizeForMatch(text);
            return END_FRAMES.some((frame) => normalized.includes(frame))
                || CONTINUE_FRAMES.some((frame) => normalized.includes(frame));
        },
    };
}
