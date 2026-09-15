// ============================================================
// src/core/games/riddles.ts
// Adivinanzas (plan-juegos §4). Motor puro sin I/O.
//
// Banco local de 12 adivinanzas `{ pregunta, respuesta[], pista }`.
// Validación por keywords normalizadas (sin acentos, límites de
// palabra → "espera" NO responde "pera").
//
// Controles del jugador:
//   "pista" / "ayuda"        → pista de la adivinanza actual
//   "otra" / "siguiente"     → saltar a la siguiente
//   "sigo" / "no sé"         → saltar (no sabe la respuesta)
// Respuesta correcta → +1 punto, siguiente adivinanza.
// Incorrecta → reintenta la misma.
// Fin al alcanzar `rounds` adivinanzas.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';
import { clamp, normalizeForMatch, hasAnyToken, hasToken } from './gameUtils';

export interface Riddle {
    pregunta: string;
    respuesta: string[];
    pista: string;
}

export const RIDDLE_BANK: readonly Riddle[] = Object.freeze([
    {
        pregunta: 'Soy una fruta con forma de gota, mi piel es verde o amarilla y por dentro soy blanca y jugosa',
        respuesta: ['pera'],
        pista: 'Es una fruta que empieza con la letra "pe".',
    },
    {
        pregunta: 'Tengo manecillas pero no soy un animal, y te digo la hora sin parar.',
        respuesta: ['reloj'],
        pista: 'Lo usas para no llegar tarde.',
    },
    {
        pregunta: 'Soy amarillo, me pela un mono y soy la fruta favorita de un gorila.',
        respuesta: ['platano', 'banana', 'guineo'],
        pista: 'Es una fruta larga y amarilla.',
    },
    {
        pregunta: 'Tengo hojas pero no soy un árbol, y dentro de mí hay historias por contar.',
        respuesta: ['libro'],
        pista: 'Lo abres para leer un cuento.',
    },
    {
        pregunta: 'Vuelo de noche, no tengo plumas y duermo colgado cabeza abajo.',
        respuesta: ['murcielago', 'vampiro'],
        pista: 'Es un animal que chilla y vuela de noche.',
    },
    {
        pregunta: 'Brillo de noche, cambio de forma y acompaño a las estrellas.',
        respuesta: ['luna'],
        pista: 'La ves en el cielo por la noche.',
    },
    {
        pregunta: 'Soy agua pero no me puedes beber, me pones al sol y desaparezco.',
        respuesta: ['hielo'],
        pista: 'Lo pones en el refresco para que esté frío.',
    },
    {
        pregunta: 'Tengo cuatro patas pero no camino, y en la comida me usas de apoyo.',
        respuesta: ['mesa'],
        pista: 'Ahí pones los platos para comer.',
    },
    {
        pregunta: 'Tengo muchas teclas pero no soy un piano, y conmigo escribes en la computadora.',
        respuesta: ['teclado'],
        pista: 'Sirve para escribir letras en la pantalla.',
    },
    {
        pregunta: 'Me pones en el cuerpo, tengo botones y mangas, y me quitas para dormir.',
        respuesta: ['camisa', 'camiseta', 'playera'],
        pista: 'Es una prenda de ropa que te pones arriba.',
    },
    {
        pregunta: 'Aparezco después de la lluvia, tengo siete colores y no puedes tocarme.',
        respuesta: ['arcoiris'],
        pista: 'Tiene los colores del arco en el cielo.',
    },
    {
        pregunta: 'Tengo una llama arriba, me prenden en la torta y alumbro en la oscuridad.',
        respuesta: ['vela', 'candela'],
        pista: 'La apagas soplando después de pedir un deseo.',
    },
]);

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = RIDDLE_BANK.length;

const HINT_FRAMES: readonly string[] = Object.freeze([
    'pista', 'ayuda', 'ayudame', 'dame una pista', 'no se', 'no sé',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'otra', 'siguiente', 'otra adivinanza', 'sigo', 'paso', 'no se', 'no sé',
]);

const END_FRAMES: readonly string[] = Object.freeze([
    'salir del juego',
    'terminar el juego',
    'dejar de jugar',
    'ya no quiero jugar',
    'cerrar el juego',
]);

interface RiddlesState {
    order: number[];
    cursor: number;
    maxRounds: number;
    phase: 'announce' | 'done';
}

type RandomSource = () => number;

/** Baraja determinista (Fisher-Yates) de los índices del banco. */
function shuffleOrder(rng: RandomSource): number[] {
    const order = RIDDLE_BANK.map((_, index) => index);
    for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

function riddleAt(state: RiddlesState): Riddle | null {
    const index = state.order[state.cursor];
    return index === undefined ? null : RIDDLE_BANK[index];
}

function currentPrompt(state: RiddlesState): string {
    const riddle = riddleAt(state);
    if (!riddle) return 'Ya se me acabaron las adivinanzas.';
    return `${riddle.pregunta} ¿Qué soy?`;
}

export function createRiddlesEngine(options?: { random?: RandomSource }): GameEngine {
    let rng: RandomSource = options?.random ?? Math.random;

    const readRounds = (cfg: Record<string, unknown> | undefined): number => {
        const rounds = Number(cfg?.rounds) || Number(cfg?.defaultRounds) || DEFAULT_ROUNDS;
        return clamp(rounds, 1, MAX_ROUNDS);
    };

    const adoptRandom = (cfg: Record<string, unknown> | undefined): void => {
        if (cfg && typeof cfg.random === 'function') {
            rng = cfg.random as RandomSource;
        }
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): RiddlesState => {
        adoptRandom(cfg);
        const state: RiddlesState = {
            order: shuffleOrder(rng),
            cursor: 0,
            maxRounds: readRounds(cfg),
            phase: 'announce',
        };
        session.state = state as unknown as Record<string, unknown>;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'adivinanzas',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession {
            adoptRandom(optionsConfig);
            return {
                id: 'adivinanzas',
                state: {
                    order: shuffleOrder(rng),
                    cursor: 0,
                    maxRounds: readRounds(optionsConfig),
                    phase: 'announce',
                },
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            return {
                prompt: `¡Vamos a jugar a las adivinanzas! ${currentPrompt(session.state as unknown as RiddlesState)}`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'excited',
            };
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as unknown as RiddlesState;

            if (state.phase === 'done') {
                return {
                    prompt: 'Ya terminamos las adivinanzas. ¿Jugamos otra vez?',
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'happy',
                };
            }

            const riddle = riddleAt(state);
            if (!riddle) {
                state.phase = 'done';
                return {
                    prompt: `¡Se acabaron las adivinanzas! Tu puntaje fue ${session.score}. ¡Muy bien!`,
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
                    prompt: `Aquí va una pista: ${riddle.pista}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'thinking',
                };
            }

            // ¿Intenta responder?
            if (hasAnyToken(normalized, riddle.respuesta)) {
                session.score += 1;
                session.round += 1;
                if (state.cursor + 1 >= state.maxRounds || state.cursor + 1 >= state.order.length) {
                    state.phase = 'done';
                    return {
                        prompt: `¡Correcto, era ${riddle.respuesta[0]}! Completaste ${state.maxRounds} adivinanzas con ${session.score} puntos. ¡Eres muy listo!`,
                        valid: true,
                        gameOver: true,
                        score: session.score,
                        animation: 'Dance',
                        emotion: 'happy',
                    };
                }
                state.cursor += 1;
                const next = riddleAt(state);
                return {
                    prompt: `¡Correcto, era ${riddle.respuesta[0]}! Siguiente: ${next ? next.pregunta : ''} ¿Qué soy?`,
                    valid: true,
                    gameOver: false,
                    score: session.score,
                    animation: 'Jump_in_place',
                    emotion: 'happy',
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
                state.cursor += 1;
                const next = riddleAt(state);
                return {
                    prompt: `¡Claro! Aquí va otra: ${next ? next.pregunta : ''} ¿Qué soy?`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                };
            }

            // Respuesta incorrecta → reintenta la misma.
            return {
                prompt: `¡Casi! Inténtalo otra vez. ${riddle.pregunta} ¿Qué soy?`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'encouraging',
                error: 'respuesta incorrecta',
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
