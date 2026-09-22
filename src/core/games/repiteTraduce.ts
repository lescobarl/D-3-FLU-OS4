// ============================================================
// src/core/games/repiteTraduce.ts
// Repite y traduce (plan-juegos §Fase 3, Riesgo 3).
// Motor puro sin I/O, ideal para el modo bilingüe.
//
// FLU dice una palabra en español y pide su traducción al
// inglés (o al revés). Acepta la palabra en cualquiera de los
// dos idiomas (repetición o traducción), validación por keyword.
//
// Controles:
//   "pista" / "ayuda"      → da la traducción
//   "paso" / "siguiente"   → salta a la siguiente palabra
// Fin al completar `rounds` palabras.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';
import {
    clamp, normalizeForMatch, hasToken, hasAnyToken,
} from './gameUtils';

export interface RepiteTraduceItem {
    es: string;              // palabra en español
    en: string;              // palabra en inglés
    pista: string;
}

export const REPITE_BANK: readonly RepiteTraduceItem[] = Object.freeze([
    { es: 'perro', en: 'dog', pista: 'Es el mejor amigo del hombre y dice guau.' },
    { es: 'gato', en: 'cat', pista: 'Un felino que dice miau.' },
    { es: 'casa', en: 'house', pista: 'El lugar donde vives.' },
    { es: 'sol', en: 'sun', pista: 'Brilla en el cielo de día.' },
    { es: 'luna', en: 'moon', pista: 'La ves de noche.' },
    { es: 'agua', en: 'water', pista: 'La bebes cuando tienes sed.' },
    { es: 'pan', en: 'bread', pista: 'Lo comes en el desayuno.' },
    { es: 'leche', en: 'milk', pista: 'Es blanca y sale de la vaca.' },
    { es: 'rojo', en: 'red', pista: 'El color de una manzana.' },
    { es: 'azul', en: 'blue', pista: 'El color del cielo.' },
]);

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = REPITE_BANK.length;

const HINT_FRAMES: readonly string[] = Object.freeze([
    'pista', 'ayuda', 'ayudame', 'repite', 'no se', 'no sé',
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

interface RepiteTraduceState {
    order: number[];
    cursor: number;
    maxRounds: number;
    phase: 'announce' | 'done';
}

function itemAt(state: RepiteTraduceState): RepiteTraduceItem | null {
    const index = state.order[state.cursor];
    return index === undefined ? null : REPITE_BANK[index];
}

function currentPrompt(state: RepiteTraduceState): string {
    const item = itemAt(state);
    if (!item) return 'Ya se me acabaron las palabras.';
    return `¿Cómo se dice "${item.es}" en inglés?`;
}

export function createRepiteTraduceEngine(options?: { random?: RandomSource }): GameEngine<RepiteTraduceState> {
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

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): RepiteTraduceState => {
        adoptRandom(cfg);
        const state: RepiteTraduceState = {
            order: REPITE_BANK.map((_, index) => index),
            cursor: 0,
            maxRounds: readRounds(cfg),
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
        id: 'repite_traduce',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<RepiteTraduceState> {
            adoptRandom(optionsConfig);
            const order = REPITE_BANK.map((_, index) => index);
            for (let i = order.length - 1; i > 0; i -= 1) {
                const j = Math.floor(rng() * (i + 1));
                [order[i], order[j]] = [order[j], order[i]];
            }
            return {
                id: 'repite_traduce',
                state: {
                    order,
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
            const state = session.state as RepiteTraduceState;
            return {
                prompt: `¡Vamos a practicar inglés! ${currentPrompt(state)}`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'excited',
            };
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as RepiteTraduceState;

            if (state.phase === 'done') {
                return {
                    prompt: 'Ya terminamos de practicar inglés. ¿Jugamos otra vez?',
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
                    prompt: `¡Se acabaron las palabras! Tu puntaje fue ${session.score}. ¡Muy bien!`,
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
                    prompt: `"${item.es}" en inglés se dice "${item.en}". ${item.pista} Ahora repítelo.`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'thinking',
                };
            }

            // Acierto SOLO con la traducción al inglés: el prompt pregunta
            // "¿cómo se dice X en inglés?"; aceptar `item.es` permitía ganar
            // repitiendo la palabra que FLU acababa de decir.
            const acierto = hasToken(normalized, item.en);
            if (acierto) {
                session.score += 1;
                session.round += 1;
                if (state.cursor + 1 >= state.maxRounds || state.cursor + 1 >= state.order.length) {
                    state.phase = 'done';
                    return {
                        prompt: `¡Muy bien! "${item.es}" es "${item.en}" en inglés. Completaste ${state.maxRounds} palabras con ${session.score} puntos. ¡Eres muy listo!`,
                        valid: true,
                        gameOver: true,
                        score: session.score,
                        animation: 'Dance',
                        emotion: 'happy',
                    };
                }
                state.cursor += 1;
                return {
                    prompt: `¡Muy bien! "${item.es}" es "${item.en}". Siguiente: ${currentPrompt(state)}`,
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
                    prompt: `¡Claro! Aquí va otra: ${currentPrompt(state)}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                };
            }

            return {
                prompt: `¡Casi! "${item.es}" en inglés se dice "${item.en}". Inténtalo otra vez.`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'encouraging',
                error: 'traducción incorrecta',
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
