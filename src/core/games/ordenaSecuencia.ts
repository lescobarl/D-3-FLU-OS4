// ============================================================
// src/core/games/ordenaSecuencia.ts
// Ordena la secuencia (plan-juegos §Fase 3, Riesgo 3).
// Motor puro sin I/O.
//
// FLU muestra los pasos de una rutina en DESORDEN (etiquetados
// A, B, C...); el jugador los recita en el orden correcto.
// Validación por palabras clave en orden de aparición.
//
// Controles:
//   "pista" / "ayuda"      → muestra el orden correcto
//   "paso" / "siguiente"   → salta al siguiente ejercicio
// Fin al completar `rounds` secuencias.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';
import {
    clamp, normalizeForMatch, hasToken, hasAnyToken,
} from './gameUtils';

export interface OrdenaPaso {
    texto: string;
    clave: string;           // keyword para validar la recitación
}

export interface OrdenaSecuenciaItem {
    titulo: string;          // 'lavarse las manos'
    pasos: OrdenaPaso[];     // en orden correcto
    pista: string;
}

export const ORDENA_BANK: readonly OrdenaSecuenciaItem[] = Object.freeze([
    {
        titulo: 'lavarse las manos',
        pasos: [
            { texto: 'abrir el agua', clave: 'agua' },
            { texto: 'ponerse jabón', clave: 'jabon' },
            { texto: 'enjuagarse', clave: 'enjuagar' },
            { texto: 'secarse con la toalla', clave: 'secar' },
        ],
        pista: 'Primero el agua, luego el jabón, después enjuagar y al final secar.',
    },
    {
        titulo: 'lavarse los dientes',
        pasos: [
            { texto: 'poner pasta al cepillo', clave: 'pasta' },
            { texto: 'cepillarse', clave: 'cepillo' },
            { texto: 'escupir', clave: 'escupir' },
            { texto: 'enjuagar la boca', clave: 'enjuagar' },
        ],
        pista: 'Primero la pasta, luego cepillar, escupir y enjuagar.',
    },
    {
        titulo: 'preparar un sándwich',
        pasos: [
            { texto: 'sacar el pan', clave: 'pan' },
            { texto: 'poner el jamón', clave: 'jamon' },
            { texto: 'poner el queso', clave: 'queso' },
            { texto: 'tapar con el otro pan', clave: 'tapar' },
        ],
        pista: 'Pan, jamón, queso y tapar.',
    },
    {
        titulo: 'guardar los juguetes',
        pasos: [
            { texto: 'recoger los bloques', clave: 'bloques' },
            { texto: 'guardar los muñecos', clave: 'munecos' },
            { texto: 'cerrar la caja', clave: 'caja' },
            { texto: 'dejar todo en su lugar', clave: 'lugar' },
        ],
        pista: 'Bloques, muñecos, caja y lugar.',
    },
    {
        titulo: 'vestirse para salir',
        pasos: [
            { texto: 'ponerse la camisa', clave: 'camisa' },
            { texto: 'ponerse el pantalón', clave: 'pantalon' },
            { texto: 'ponerse los zapatos', clave: 'zapatos' },
            { texto: 'ponerse la chamarra', clave: 'chamarra' },
        ],
        pista: 'Camisa, pantalón, zapatos y chamarra.',
    },
]);

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = ORDENA_BANK.length;

const HINT_FRAMES: readonly string[] = Object.freeze([
    'pista', 'ayuda', 'ayudame', 'repite', 'no se', 'no sé',
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

interface OrdenaSecuenciaState {
    order: number[];
    cursor: number;
    maxRounds: number;
    phase: 'announce' | 'done';
}

function itemAt(state: OrdenaSecuenciaState): OrdenaSecuenciaItem | null {
    const index = state.order[state.cursor];
    return index === undefined ? null : ORDENA_BANK[index];
}

function shufflePasos(item: OrdenaSecuenciaItem, rng: RandomSource): number[] {
    const idx = item.pasos.map((_, index) => index);
    for (let i = idx.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx;
}

function displayScrambled(item: OrdenaSecuenciaItem, shuffled: number[]): string {
    const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
    return shuffled.map((pasoIdx, pos) => `${labels[pos]}) ${item.pasos[pasoIdx].texto}`).join(', ');
}

function extractClavesInOrder(normalized: string, item: OrdenaSecuenciaItem): string[] {
    const found: string[] = [];
    for (const paso of item.pasos) {
        if (hasToken(normalized, paso.clave)) found.push(paso.clave);
    }
    return found;
}

function isFullOrder(extracted: readonly string[], item: OrdenaSecuenciaItem): boolean {
    const expected = item.pasos.map((paso) => paso.clave);
    return extracted.length === expected.length
        && expected.every((clave, index) => clave === extracted[index]);
}

export function createOrdenaSecuenciaEngine(options?: { random?: RandomSource }): GameEngine {
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

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): OrdenaSecuenciaState => {
        adoptRandom(cfg);
        const state: OrdenaSecuenciaState = {
            order: ORDENA_BANK.map((_, index) => index),
            cursor: 0,
            maxRounds: readRounds(cfg),
            phase: 'announce',
        };
        for (let i = state.order.length - 1; i > 0; i -= 1) {
            const j = Math.floor(rng() * (i + 1));
            [state.order[i], state.order[j]] = [state.order[j], state.order[i]];
        }
        session.state = state as unknown as Record<string, unknown>;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'ordena_secuencia',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession {
            adoptRandom(optionsConfig);
            const order = ORDENA_BANK.map((_, index) => index);
            for (let i = order.length - 1; i > 0; i -= 1) {
                const j = Math.floor(rng() * (i + 1));
                [order[i], order[j]] = [order[j], order[i]];
            }
            return {
                id: 'ordena_secuencia',
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
            const state = session.state as unknown as OrdenaSecuenciaState;
            const item = itemAt(state);
            if (!item) {
                return {
                    prompt: 'Ya se me acabaron las secuencias.',
                    valid: false,
                    gameOver: true,
                    score: 0,
                    animation: 'Idle',
                    emotion: 'happy',
                };
            }
            return {
                prompt: `¡Vamos a ordenar los pasos para ${item.titulo}! Dime los pasos en el orden correcto: ${displayScrambled(item, shufflePasos(item, rng))}`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'excited',
            };
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as unknown as OrdenaSecuenciaState;

            if (state.phase === 'done') {
                return {
                    prompt: 'Ya terminamos las secuencias. ¿Jugamos otra vez?',
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
                    prompt: `¡Se acabaron las secuencias! Tu puntaje fue ${session.score}. ¡Muy bien!`,
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
                    prompt: `El orden correcto es: ${item.pasos.map((paso) => paso.texto).join(', ')}. ${item.pista}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'thinking',
                };
            }

            // ¿Recita en orden correcto?
            const extracted = extractClavesInOrder(normalized, item);
            if (extracted.length > 0 && isFullOrder(extracted, item)) {
                session.score += 1;
                session.round += 1;
                if (state.cursor + 1 >= state.maxRounds || state.cursor + 1 >= state.order.length) {
                    state.phase = 'done';
                    return {
                        prompt: `¡Perfecto! Completaste ${state.maxRounds} secuencias con ${session.score} puntos. ¡Eres muy listo!`,
                        valid: true,
                        gameOver: true,
                        score: session.score,
                        animation: 'Dance',
                        emotion: 'happy',
                    };
                }
                state.cursor += 1;
                const next = itemAt(state);
                if (!next) {
                    state.phase = 'done';
                    return {
                        prompt: `¡Se acabaron las secuencias! Tu puntaje fue ${session.score}. ¡Muy bien!`,
                        valid: true,
                        gameOver: true,
                        score: session.score,
                        animation: 'Dance',
                        emotion: 'happy',
                    };
                }
                return {
                    prompt: `¡Perfecto! Siguiente: ordena los pasos para ${next.titulo}: ${displayScrambled(next, shufflePasos(next, rng))}`,
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
                const next = itemAt(state);
                if (!next) {
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
                return {
                    prompt: `¡Claro! Aquí va otra: ordena los pasos para ${next.titulo}: ${displayScrambled(next, shufflePasos(next, rng))}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                };
            }

            // Intentó pero el orden está incompleto.
            if (extracted.length > 0) {
                return {
                    prompt: `Casi. El orden correcto es: ${item.pasos.map((paso) => paso.texto).join(', ')}. Inténtalo de nuevo.`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'encouraging',
                    error: 'orden incorrecto',
                };
            }

            return {
                prompt: `No te escuché bien. Dime los pasos para ${item.titulo} en orden.`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'neutral',
                error: 'sin pasos reconocidos',
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
