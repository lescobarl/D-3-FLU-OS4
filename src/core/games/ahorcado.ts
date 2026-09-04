// ============================================================
// src/core/games/ahorcado.ts
// Ahorcado (plan-juegos §Fase 3, Riesgo 3). Motor puro sin I/O.
//
// Banco local de palabras con pistas. El jugador dice una letra
// (o la palabra completa) para adivinar; FLU revela las letras
// acertadas. Validación normalizada sin acentos.
//
// Controles del jugador:
//   "pista" / "ayuda"    → revela la primera letra oculta
//   "paso" / "siguiente" → revela la palabra y salta
// Gana al completar la palabra; pierde al agotar los intentos.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';
import {
    clamp, normalizeForMatch, hasToken, hasAnyToken, pickRandom,
} from './gameUtils';

export interface AhorcadoWord {
    palabra: string;
    pista: string;
}

export const AHORCADO_BANK: readonly AhorcadoWord[] = Object.freeze([
    { palabra: 'agua', pista: 'La bebes para tener sed.' },
    { palabra: 'sol', pista: 'Brilla en el cielo de día.' },
    { palabra: 'luna', pista: 'La ves de noche acompañando a las estrellas.' },
    { palabra: 'gato', pista: 'Es un animal que dice miau.' },
    { palabra: 'perro', pista: 'Es el mejor amigo del hombre y dice guau.' },
    { palabra: 'leon', pista: 'Es el rey de la selva y ruge fuerte.' },
    { palabra: 'arbol', pista: 'Tiene tronco, hojas y da sombra.' },
    { palabra: 'flor', pista: 'Huele rico y crece en el jardín.' },
    { palabra: 'mariposa', pista: 'Vuela y tiene alas de muchos colores.' },
    { palabra: 'elefante', pista: 'Tiene trompa y es muy grande.' },
    { palabra: 'estrella', pista: 'Brilla en el cielo por la noche.' },
    { palabra: 'campana', pista: 'Suena: ¡tolón, tolón!' },
    { palabra: 'zapato', pista: 'Te lo pones en el pie.' },
    { palabra: 'pelota', pista: 'La pateas o la avientas para jugar.' },
    { palabra: 'caracol', pista: 'Lleva su casita a cuestas y deja baba.' },
]);

const DEFAULT_INTENTOS = 6;
const MAX_INTENTOS = 10;

const HINT_FRAMES: readonly string[] = Object.freeze([
    'pista', 'ayuda', 'ayudame', 'dame una pista', 'no se', 'no sé',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'siguiente', 'otra palabra', 'no se', 'no sé', 'sigo',
]);

const END_FRAMES: readonly string[] = Object.freeze([
    'salir del juego',
    'terminar el juego',
    'dejar de jugar',
    'ya no quiero jugar',
    'cerrar el juego',
]);

type RandomSource = () => number;

interface AhorcadoState {
    palabra: string;
    pista: string;
    adivinadas: string[];      // letras ya reveladas
    intentos: number;          // intentos restantes
    maxIntentos: number;
    phase: 'announce' | 'done';
}

function displayWord(state: AhorcadoState): string {
    return state.palabra
        .split('')
        .map((ch) => (state.adivinadas.includes(ch) ? ch : '_'))
        .join(' ');
}

function isComplete(state: AhorcadoState): boolean {
    return state.palabra.split('').every((ch) => state.adivinadas.includes(ch));
}

export function createAhorcadoEngine(options?: { random?: RandomSource }): GameEngine {
    let rng: RandomSource = options?.random ?? Math.random;

    const adoptRandom = (cfg: Record<string, unknown> | undefined): void => {
        if (cfg && typeof cfg.random === 'function') {
            rng = cfg.random as RandomSource;
        }
    };

    const readIntentos = (cfg: Record<string, unknown> | undefined): number => {
        const intentos = Number(cfg?.intentos) || Number(cfg?.maxIntentos) || DEFAULT_INTENTOS;
        return clamp(intentos, 3, MAX_INTENTOS);
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): AhorcadoState => {
        adoptRandom(cfg);
        const word = pickRandom(AHORCADO_BANK, rng);
        const state: AhorcadoState = {
            palabra: word.palabra,
            pista: word.pista,
            adivinadas: [],
            intentos: readIntentos(cfg),
            maxIntentos: readIntentos(cfg),
            phase: 'announce',
        };
        session.state = state as unknown as Record<string, unknown>;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'ahorcado',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession {
            adoptRandom(optionsConfig);
            const word = pickRandom(AHORCADO_BANK, rng);
            return {
                id: 'ahorcado',
                state: {
                    palabra: word.palabra,
                    pista: word.pista,
                    adivinadas: [],
                    intentos: readIntentos(optionsConfig),
                    maxIntentos: readIntentos(optionsConfig),
                    phase: 'announce',
                },
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as unknown as AhorcadoState;
            return {
                prompt: `¡Vamos a jugar al ahorcado! La palabra tiene ${state.palabra.length} letras: ${displayWord(state)}. Dime una letra.`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'excited',
            };
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as unknown as AhorcadoState;

            if (state.phase === 'done') {
                return {
                    prompt: 'Ya terminamos el ahorcado. ¿Jugamos otra vez?',
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
                const hidden = state.palabra
                    .split('')
                    .find((ch) => !state.adivinadas.includes(ch));
                if (hidden && !state.adivinadas.includes(hidden)) {
                    state.adivinadas.push(hidden);
                    state.intentos = Math.max(1, state.intentos - 1);
                    if (isComplete(state)) {
                        session.score += 1;
                        return finish(`¡Correcto! La palabra era ${state.palabra}. ¡Eres muy listo!`, true, 'happy');
                    }
                    return {
                        prompt: `Aquí va una pista: la letra "${hidden}" está en la palabra. ${displayWord(state)} Quedan ${state.intentos} intentos.`,
                        valid: false,
                        gameOver: false,
                        score: session.score,
                        animation: 'Idle',
                        emotion: 'thinking',
                    };
                }
                return {
                    prompt: `Pista: ${state.pista}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'thinking',
                };
            }

            // ¿La palabra completa?
            if (normalized === state.palabra) {
                state.adivinadas = state.palabra.split('');
                session.score += 1;
                return finish(`¡Correcto! La palabra era ${state.palabra}. ¡Eres muy listo!`, true, 'happy');
            }

            // ¿Salta?
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                return finish(`La palabra era ${state.palabra}. ¡Jugamos otra y la adivinas!`, false, 'neutral');
            }

            // ¿Dice una letra?
            const letter = normalized
                .split(/\s+/)
                .find((token) => /^[a-z]$/.test(token));
            if (letter) {
                if (state.adivinadas.includes(letter)) {
                    return {
                        prompt: `La letra "${letter}" ya la adivinaste. ${displayWord(state)} Dime otra letra.`,
                        valid: false,
                        gameOver: false,
                        score: session.score,
                        animation: 'Idle',
                        emotion: 'neutral',
                    };
                }
                if (state.palabra.includes(letter)) {
                    state.adivinadas.push(letter);
                    if (isComplete(state)) {
                        session.score += 1;
                        return finish(`¡Correcto! La palabra era ${state.palabra}. ¡Eres muy listo!`, true, 'happy');
                    }
                    return {
                        prompt: `¡La letra "${letter}" está! ${displayWord(state)} Sigue así.`,
                        valid: true,
                        gameOver: false,
                        score: session.score,
                        animation: 'Jump_in_place',
                        emotion: 'happy',
                    };
                }
                state.intentos -= 1;
                if (state.intentos <= 0) {
                    return finish(`Se acabaron los intentos. La palabra era ${state.palabra}. ¡Otra vez será!`, false, 'neutral');
                }
                return {
                    prompt: `La letra "${letter}" no está. Quedan ${state.intentos} intentos. ${displayWord(state)}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'encouraging',
                    error: 'letra incorrecta',
                };
            }

            // No entendió → repite la consigna.
            return {
                prompt: `No te escuché bien. Dime una letra o la palabra completa. ${displayWord(state)}`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'neutral',
                error: 'sin letra reconocida',
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
