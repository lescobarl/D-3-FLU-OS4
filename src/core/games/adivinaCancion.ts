// ============================================================
// src/core/games/adivinaCancion.ts
// Adivina la canción (plan-juegos §Fase 3, viabilidad línea 140).
// Motor puro sin I/O. Banco local SONG_BANK que espeja los ids y
// títulos de FLU_PLAYLIST (src/services/musicPlayer.ts) para que
// App.tsx mapee `songId` → playSong(trackId) y suene la melodía.
//
// Flujo (data-driven, determinista):
//   FLU elige una canción, da una pista y ofrece opciones
//   ("¿Es 'Baila', 'Fiesta' o 'Estrellita'?"). El niño responde
//   con el título. Correcto → +1 punto. "paso" salta sin puntuar.
//   Fin al adivinar `rounds` canciones.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';
import {
    RandomSource,
    clamp,
    normalizeForMatch,
    hasToken,
    hasAnyToken,
    shuffleOrder,
} from './gameUtils';

export interface SongOption {
    id: string;            // = trackId de FLU_PLAYLIST
    titulo: string;
    pista: string;
    alias: string[];       // respuestas aceptadas (sin acentos)
}

export const SONG_BANK: readonly SongOption[] = Object.freeze([
    {
        id: 'sueño',
        titulo: 'Sueño de Bunny',
        pista: 'Habla de dormir y soñar con conejitos.',
        alias: ['sueno de bunny', 'bunny', 'sueno'],
    },
    {
        id: 'baila',
        titulo: 'Baila',
        pista: 'Es para mover el cuerpo y seguir el ritmo.',
        alias: ['baila', 'bailar'],
    },
    {
        id: 'canta',
        titulo: 'Canta',
        pista: 'Te invita a cantar a todo pulmón.',
        alias: ['canta', 'cantar'],
    },
    {
        id: 'fiesta',
        titulo: 'Fiesta',
        pista: 'Es perfecta para celebrar con amigos.',
        alias: ['fiesta'],
    },
    {
        id: 'cumpleaños',
        titulo: 'Cumpleaños Feliz',
        pista: 'Se canta cuando apagas las velitas de la torta.',
        alias: ['cumpleanos feliz', 'cumpleanos', 'feliz cumpleanos'],
    },
    {
        id: 'mañanitas',
        titulo: 'Las Mañanitas',
        pista: 'Se canta para despertar a alguien en su día especial.',
        alias: ['las mananitas', 'mananitas'],
    },
    {
        id: 'estrellita',
        titulo: 'Estrellita',
        pista: 'Habla de una lucecita que brilla en el cielo.',
        alias: ['estrellita', 'estrellita donde estas'],
    },
    {
        id: 'elisa',
        titulo: 'Para Elisa',
        pista: 'Es una melodía clásica de piano, muy famosa.',
        alias: ['para elisa', 'elisa'],
    },
    {
        id: 'cielito',
        titulo: 'Cielito Lindo',
        pista: 'Una canción muy mexicana que dice "cielito lindo".',
        alias: ['cielito lindo', 'cielito'],
    },
]);

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = SONG_BANK.length;
const NUM_OPTIONS = 3;

const HINT_FRAMES: readonly string[] = Object.freeze([
    'pista', 'ayuda', 'ayudame', 'dame una pista', 'no se', 'no sé',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'otra', 'siguiente', 'sigo', 'paso', 'no se', 'no sé',
]);

const END_FRAMES: readonly string[] = Object.freeze([
    'salir del juego',
    'terminar el juego',
    'dejar de jugar',
    'ya no quiero jugar',
    'cerrar el juego',
]);

interface AdivinaCancionState {
    order: number[];
    cursor: number;
    maxRounds: number;
    phase: 'announce' | 'done';
    songId: string;
    options: string[];
}

/** Opciones de la ronda: la canción objetivo + 2 distractores, ordenadas por índice del banco. */
function buildOptions(targetIndex: number, rng: RandomSource): SongOption[] {
    const others = SONG_BANK.map((_, index) => index)
        .filter((index) => index !== targetIndex);
    const distractors: SongOption[] = [];
    while (distractors.length < NUM_OPTIONS - 1 && others.length > 0) {
        const pickIndex = Math.floor(rng() * others.length);
        const [chosen] = others.splice(pickIndex, 1);
        distractors.push(SONG_BANK[chosen]);
    }
    return [...distractors, SONG_BANK[targetIndex]]
        .sort((a, b) => SONG_BANK.findIndex((song) => song.id === a.id) - SONG_BANK.findIndex((song) => song.id === b.id));
}

function songPrompt(state: AdivinaCancionState): string {
    const song = SONG_BANK.find((candidate) => candidate.id === state.songId);
    if (!song) return 'Ya se me acabaron las canciones.';
    const titles = state.options.join(', ');
    return `Pista: ${song.pista} ¿Es ${titles}?`;
}

function matchesAnyOption(normalized: string, options: readonly SongOption[]): SongOption | null {
    for (const option of options) {
        if (hasAnyToken(normalized, option.alias)) return option;
    }
    return null;
}

export function createAdivinaCancionEngine(options?: { random?: RandomSource }): GameEngine {
    let rng: RandomSource = options?.random ?? Math.random;

    const readConfig = (cfg: Record<string, unknown> | undefined): number => {
        const rounds = Number(cfg?.rounds) || Number(cfg?.defaultRounds) || DEFAULT_ROUNDS;
        return clamp(rounds, 1, MAX_ROUNDS);
    };

    const buildState = (cfg: Record<string, unknown> | undefined): AdivinaCancionState => {
        if (cfg && typeof cfg.random === 'function') {
            rng = cfg.random as RandomSource;
        }
        const order = shuffleOrder(rng, SONG_BANK.length);
        const targetIndex = order[0];
        const target = SONG_BANK[targetIndex];
        const options = buildOptions(targetIndex, rng).map((song) => song.titulo);
        return {
            order,
            cursor: 0,
            maxRounds: readConfig(cfg),
            phase: 'announce',
            songId: target.id,
            options,
        };
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): AdivinaCancionState => {
        const state = buildState(cfg);
        session.state = state as unknown as Record<string, unknown>;
        session.score = 0;
        session.round = 1;
        return state;
    };

    const advance = (session: GameSession, state: AdivinaCancionState): void => {
        state.cursor += 1;
        const targetIndex = state.order[state.cursor];
        const target = SONG_BANK[targetIndex];
        state.songId = target.id;
        state.options = buildOptions(targetIndex, rng).map((song) => song.titulo);
    };

    return {
        id: 'adivina_cancion',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession {
            const state = buildState(optionsConfig);
            return {
                id: 'adivina_cancion',
                state: state as unknown as Record<string, unknown>,
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as unknown as AdivinaCancionState;
            return {
                prompt: `¡Vamos a adivinar canciones! Escucha con atención. ${songPrompt(state)}`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'excited',
            };
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as unknown as AdivinaCancionState;

            if (state.phase === 'done') {
                return {
                    prompt: 'Ya terminamos de adivinar canciones. ¿Jugamos otra vez?',
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'happy',
                };
            }

            const song = SONG_BANK.find((candidate) => candidate.id === state.songId);
            if (!song) {
                state.phase = 'done';
                return {
                    prompt: `¡Se acabaron las canciones! Tu puntaje fue ${session.score}. ¡Muy bien!`,
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
                    prompt: `Escúchala otra vez. ${songPrompt(state)}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'thinking',
                };
            }

            const answered = matchesAnyOption(normalized, SONG_BANK);

            // ¿Acierta con la canción objetivo?
            if (answered && answered.id === song.id) {
                session.score += 1;
                session.round += 1;
                if (state.cursor + 1 >= state.maxRounds || state.cursor + 1 >= state.order.length) {
                    state.phase = 'done';
                    return {
                        prompt: `¡Correcto, era "${song.titulo}"! Adivinaste ${session.score} canciones con ${session.score} puntos. ¡Gran oído musical!`,
                        valid: true,
                        gameOver: true,
                        score: session.score,
                        animation: 'Dance',
                        emotion: 'happy',
                    };
                }
                advance(session, state);
                return {
                    prompt: `¡Correcto, era "${song.titulo}"! Siguiente canción: ${songPrompt(state)}`,
                    valid: true,
                    gameOver: false,
                    score: session.score,
                    animation: 'Jump_in_place',
                    emotion: 'happy',
                };
            }

            // ¿Dijo una opción equivocada?
            if (answered) {
                return {
                    prompt: `¡Casi! Esa no era. Escucha otra vez. ${songPrompt(state)}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'encouraging',
                    error: 'canción incorrecta',
                };
            }

            // ¿Salta a la siguiente?
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
                advance(session, state);
                return {
                    prompt: `¡Claro! Otra canción: ${songPrompt(state)}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                };
            }

            // No reconoció → reintenta la misma.
            return {
                prompt: `No te escuché bien. ${songPrompt(state)}`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'encouraging',
                error: 'respuesta no reconocida',
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
