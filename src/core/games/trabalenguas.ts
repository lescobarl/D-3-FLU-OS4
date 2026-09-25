// ============================================================
// src/core/games/trabalenguas.ts
// Trabalenguas (plan-juegos §Fase 3, Riesgo 3). Motor puro sin I/O.
//
// Banco local de trabalenguas con palabras clave (`claves`) que el
// jugador debe repetir. Validación por keywords normalizadas: se
// considera acierto si todas las claves aparecen en la respuesta.
//
// Controles:
//   "pista" / "ayuda"      → repite despacio con la pista
//   "paso" / "siguiente"   → salta al siguiente trabalenguas
// Fin al completar `rounds` trabalenguas.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';
import {
    normalizeForMatch, hasToken, hasAnyToken,
    adoptRandom,
    readRounds,
} from './gameUtils';

export interface TrabalenguasItem {
    texto: string;
    claves: string[];        // palabras clave que deben aparecer
    pista: string;
}

export const TRABALENGUAS_BANK: readonly TrabalenguasItem[] = Object.freeze([
    { texto: 'Tres tristes tigres tragaban trigo en un trigal.', claves: ['tigres', 'tragaban', 'trigo'], pista: 'Unos animales rayados que comían trigo.' },
    { texto: 'Pepe pica papas con un pico, papas pica Pepe.', claves: ['pepe', 'pica', 'papas'], pista: 'Un niño llamado Pepe picando unas papas.' },
    { texto: 'El cielo está enladrillado, ¿quién lo desenladrillará?', claves: ['cielo', 'enladrillado'], pista: 'Está lleno de ladrillos azules.' },
    { texto: 'Pancha plancha con mucha plancha y con mucha prisa.', claves: ['pancha', 'plancha'], pista: 'Una niña que plancha la ropa.' },
    { texto: 'Compadre, cómpreme un coco, compadre, cómpreme dos.', claves: ['compadre', 'coco'], pista: 'Una fruta dura y marrón con agua dentro.' },
    { texto: 'Pablito clavó un clavito en la calva de un calvito.', claves: ['pablito', 'clavito'], pista: 'Un niño con un clavo muy pequeño.' },
    { texto: 'La bruja piruja prepara un brebaje para el viaje.', claves: ['bruja', 'brebaje'], pista: 'Una señora mágica cocinando una poción.' },
    { texto: 'Erre con erre cigarro, erre con erre barril.', claves: ['cigarro', 'barril'], pista: 'Dos cosas que suenan mucho con la erre.' },
]);

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = TRABALENGUAS_BANK.length;

const HINT_FRAMES: readonly string[] = Object.freeze([
    'pista', 'ayuda', 'ayudame', 'repite', 'no escuche', 'no escuché', 'despacio',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'siguiente', 'otro', 'sigo', 'no se', 'no sé',
]);

const END_FRAMES: readonly string[] = Object.freeze([
    'salir del juego',
    'terminar el juego',
    'dejar de jugar',
    'ya no quiero jugar',
    'cerrar el juego',
]);

type RandomSource = () => number;

interface TrabalenguasState {
    order: number[];
    cursor: number;
    maxRounds: number;
    phase: 'announce' | 'done';
}

function itemAt(state: TrabalenguasState): TrabalenguasItem | null {
    const index = state.order[state.cursor];
    return index === undefined ? null : TRABALENGUAS_BANK[index];
}

function currentPrompt(state: TrabalenguasState): string {
    const item = itemAt(state);
    if (!item) return 'Ya se me acabaron los trabalenguas.';
    return `${item.texto} Repítelo después de mí.`;
}

export function createTrabalenguasEngine(options?: { random?: RandomSource }): GameEngine<TrabalenguasState> {
    let rng: RandomSource = options?.random ?? Math.random;
    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): TrabalenguasState => {
        rng = adoptRandom(rng, cfg);
        const state: TrabalenguasState = {
            order: TRABALENGUAS_BANK.map((_, index) => index),
            cursor: 0,
            maxRounds: readRounds(cfg, DEFAULT_ROUNDS, MAX_ROUNDS),
            phase: 'announce',
        };
        for (let i = state.order.length - 1; i > 0; i -= 1) {
            const j = Math.floor(rng() * (i + 1));
            [state.order[i], state.order[j]] = [state.order[j], state.order[i]];
        }
        session.state = state;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'trabalenguas',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<TrabalenguasState> {
            rng = adoptRandom(rng, optionsConfig);
            const order = TRABALENGUAS_BANK.map((_, index) => index);
            for (let i = order.length - 1; i > 0; i -= 1) {
                const j = Math.floor(rng() * (i + 1));
                [order[i], order[j]] = [order[j], order[i]];
            }
            return {
                id: 'trabalenguas',
                state: {
                    order,
                    cursor: 0,
                    maxRounds: readRounds(optionsConfig, DEFAULT_ROUNDS, MAX_ROUNDS),
                    phase: 'announce',
                },
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as TrabalenguasState;
            return {
                prompt: `¡Vamos a jugar con trabalenguas! ${currentPrompt(state)}`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'excited',
            };
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as TrabalenguasState;

            if (state.phase === 'done') {
                return {
                    prompt: 'Ya terminamos los trabalenguas. ¿Jugamos otra vez?',
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'happy',
                };
            }

            const item = itemAt(state);
            if (!item) {
                state.phase = 'done';
                return {
                    prompt: `¡Se acabaron los trabalenguas! Tu puntaje fue ${session.score}. ¡Muy bien!`,
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
                    prompt: `Vamos despacio: ${item.texto} Recuerda: ${item.pista}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'thinking',
                };
            }

            // ¿Lo repite correctamente? (todas las claves presentes)
            const acierto = item.claves.every((clave) => hasToken(normalized, clave));
            if (acierto) {
                session.score += 1;
                session.round += 1;
                if (state.cursor + 1 >= state.maxRounds || state.cursor + 1 >= state.order.length) {
                    state.phase = 'done';
                    return {
                        prompt: `¡Lengua rápida! Completaste ${state.maxRounds} trabalenguas con ${session.score} puntos. ¡Eres muy listo!`,
                        valid: true,
                        gameOver: true,
                        score: session.score,
                        animation: 'Dance',
                        emotion: 'happy',
                    };
                }
                state.cursor += 1;
                const next = itemAt(state);
                return {
                    prompt: `¡Muy bien! Siguiente: ${next ? currentPrompt(state) : ''}`,
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
                state.cursor += 1;
                return {
                    prompt: `¡Claro! Aquí va otro: ${currentPrompt(state)}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                };
            }

            // Reintenta el mismo trabalenguas.
            return {
                prompt: `¡Casi! Inténtalo otra vez: ${item.texto}`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'encouraging',
                error: 'repite no válido',
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
