// ============================================================
// src/core/games/karaoke.ts
// Karaoke — "cantar juntos" (plan-juegos §Fase 3, Riesgo 3, MVP).
// Motor puro sin I/O.
//
// MVP de canto: FLU pone una pista (id del banco espejo de
// FLU_PLAYLIST), muestra la letra línea a línea y anima la boca.
// NO hay validación de canto (Riesgo 3 consciente): el niño canta
// libremente y avanza línea con "sigue" / "paso".
//
// La capa de App lee `session.state.songId` y llama `playSong`
// para reproducir la pista real desde el reproductor de música.
//
// Controles:
//   "pista" / "ayuda"  → repite la línea actual
//   "sigue" / "paso"   → avanza a la siguiente línea
// Fin al terminar la letra de la canción.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';
import {
    normalizeForMatch, hasAnyToken,
} from './gameUtils';

export interface KaraokeSong {
    id: string;          // id espejo de FLU_PLAYLIST (musicPlayer.ts)
    titulo: string;
    lineas: readonly string[];
}

// Espejo de las pistas con letra de FLU_PLAYLIST (sueño/baila/canta/
// fiesta/cumpleaños/mañanitas/estrellita/elisa/cielito). Líneas breves
// de canciones tradicionales o letra original corta.
export const KARAOKE_SONG_BANK: readonly KaraokeSong[] = Object.freeze([
    {
        id: 'estrellita',
        titulo: 'Estrellita',
        lineas: Object.freeze([
            'Estrellita, ¿dónde estás?',
            'Me pregunto qué serás.',
            'En el cielo y en el mar',
            'un diamante de verdad.',
        ]),
    },
    {
        id: 'cumpleaños',
        titulo: 'Cumpleaños feliz',
        lineas: Object.freeze([
            'Cumpleaños feliz,',
            'te deseamos a ti.',
            'Que los cumplas feliz,',
            'que los cumplas feliz.',
        ]),
    },
    {
        id: 'mañanitas',
        titulo: 'Las mañanitas',
        lineas: Object.freeze([
            'Estas son las mañanitas,',
            'que cantaba el rey David.',
            'A los niños de la casa,',
            'se las cantamos a ti.',
        ]),
    },
    {
        id: 'cielito',
        titulo: 'Cielito lindo',
        lineas: Object.freeze([
            'Cielito lindo, ay, ay, ay,',
            'canta y no llores,',
            'porque cantando se alegran',
            'los corazones.',
        ]),
    },
    {
        id: 'baila',
        titulo: 'Baila conmigo',
        lineas: Object.freeze([
            'Baila, baila sin parar,',
            'mueve el cuerpo al ritmo ya.',
            'Salta, gira y brilla más,',
            'todos vamos a gozar.',
        ]),
    },
    {
        id: 'canta',
        titulo: 'Canta con alegría',
        lineas: Object.freeze([
            'Canta, canta con alegría,',
            'que la música te guíe.',
            'Siente el ritmo en tu corazón,',
            'canta con todo tu corazón.',
        ]),
    },
    {
        id: 'fiesta',
        titulo: 'La fiesta',
        lineas: Object.freeze([
            'Llegó la fiesta, vamos a gozar,',
            'todos bailamos sin parar.',
            'Luces de colores por aquí,',
            'qué bonita es la fiesta.',
        ]),
    },
    {
        id: 'sueño',
        titulo: 'Canción de sueño',
        lineas: Object.freeze([
            'Cierra los ojitos ya,',
            'que la luna te va a cuidar.',
            'Duérmete, mi pequeño,',
            'sueña con un lindo lugar.',
        ]),
    },
    {
        id: 'elisa',
        titulo: 'Para Elisa',
        lineas: Object.freeze([
            'Para Elisa la música suena,',
            'notas suaves como un sueño.',
            'El piano dulce nos llena,',
            'melodía de amor sereno.',
        ]),
    },
]);

const HINT_FRAMES: readonly string[] = Object.freeze([
    'pista', 'ayuda', 'ayudame', 'otra vez', 'repite',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'sigue', 'paso', 'siguiente', 'adelante', 'ya', 'sigo',
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

interface KaraokeState {
    songId: string;
    titulo: string;
    lineas: readonly string[];
    cursor: number;
    phase: 'announce' | 'singing' | 'done';
}

export function createKaraokeEngine(options?: { random?: RandomSource }): GameEngine {
    let rng: RandomSource = options?.random ?? Math.random;

    const adoptRandom = (cfg: Record<string, unknown> | undefined): void => {
        if (cfg && typeof cfg.random === 'function') {
            rng = cfg.random as RandomSource;
        }
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): KaraokeState => {
        adoptRandom(cfg);
        const song = KARAOKE_SONG_BANK[Math.floor(rng() * KARAOKE_SONG_BANK.length)];
        const state: KaraokeState = {
            songId: song.id,
            titulo: song.titulo,
            lineas: song.lineas,
            cursor: 0,
            phase: 'announce',
        };
        session.state = state as unknown as Record<string, unknown>;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'karaoke',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession {
            adoptRandom(optionsConfig);
            const song = KARAOKE_SONG_BANK[Math.floor(rng() * KARAOKE_SONG_BANK.length)];
            return {
                id: 'karaoke',
                state: {
                    songId: song.id,
                    titulo: song.titulo,
                    lineas: song.lineas,
                    cursor: 0,
                    phase: 'announce',
                },
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as unknown as KaraokeState;
            state.phase = 'singing';
            return {
                prompt: `¡Hora de cantar! Vamos a cantar "${state.titulo}" juntos. La pista ya suena. Escucha la primera línea: "${state.lineas[0]}" Cántala conmigo y dime "sigue" para la siguiente.`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'excited',
            };
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as unknown as KaraokeState;

            if (state.phase === 'done') {
                return {
                    prompt: 'Ya terminamos de cantar. ¿Cantamos otra canción?',
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'happy',
                };
            }

            const normalized = normalizeForMatch(text);
            const lineaActual = state.lineas[state.cursor];

            // ¿Pide repetir la línea?
            if (hasAnyToken(normalized, HINT_FRAMES)) {
                return {
                    prompt: `Claro, la repito: "${lineaActual}" Cántala conmigo y dime "sigue" para la siguiente.`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'thinking',
                };
            }

            // ¿Avanza a la siguiente línea?
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                state.cursor += 1;
                session.round += 1;
                if (state.cursor >= state.lineas.length) {
                    state.phase = 'done';
                    return {
                        prompt: `¡Cantamos toda la canción "${state.titulo}"! ${state.lineas[state.lineas.length - 1]} ¡Bravo, eres una estrella!`,
                        valid: true,
                        gameOver: true,
                        score: session.score,
                        animation: 'Dance',
                        emotion: 'happy',
                    };
                }
                return {
                    prompt: `¡Sigue así! Siguiente línea: "${state.lineas[state.cursor]}" Cántala y dime "sigue".`,
                    valid: true,
                    gameOver: false,
                    score: session.score,
                    animation: 'Jump_in_place',
                    emotion: 'happy',
                };
            }

            // Sin validación de canto: invita a cantar la línea actual.
            return {
                prompt: `¡Canta conmigo! "${lineaActual}" Cuando la cantes, dime "sigue" para la siguiente línea.`,
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
                || HINT_FRAMES.some((frame) => hasAnyToken(normalized, [frame]))
                || SKIP_FRAMES.some((frame) => hasAnyToken(normalized, [frame]));
        },
    };
}
