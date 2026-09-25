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
    normalizeForMatch, hasToken, hasAnyToken, findTokenIndex,
    adoptRandom,
    readRounds,
} from './gameUtils';

export interface OrdenaPaso {
    texto: string;
    clave: string;           // keyword para validar la recitación
    /** Variantes habladas de la clave (conjugaciones, sinónimos naturales). */
    alias?: string[];
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
            { texto: 'ponerse jabón', clave: 'jabon', alias: ['jabón'] },
            { texto: 'enjuagarse', clave: 'enjuagar', alias: ['enjuagarse'] },
            { texto: 'secarse con la toalla', clave: 'secar', alias: ['secarse', 'toalla'] },
        ],
        pista: 'Primero el agua, luego el jabón, después enjuagar y al final secar.',
    },
    {
        titulo: 'lavarse los dientes',
        pasos: [
            { texto: 'poner pasta al cepillo', clave: 'pasta' },
            { texto: 'cepillarse', clave: 'cepillo', alias: ['cepillarse', 'cepillar'] },
            { texto: 'escupir', clave: 'escupir' },
            { texto: 'enjuagar la boca', clave: 'enjuagar', alias: ['enjuagarse'] },
        ],
        pista: 'Primero la pasta, luego cepillar, escupir y enjuagar.',
    },
    {
        titulo: 'preparar un sándwich',
        pasos: [
            { texto: 'sacar el pan', clave: 'pan' },
            { texto: 'poner el jamón', clave: 'jamon', alias: ['jamón'] },
            { texto: 'poner el queso', clave: 'queso' },
            { texto: 'tapar con el otro pan', clave: 'tapar', alias: ['taparse'] },
        ],
        pista: 'Pan, jamón, queso y tapar.',
    },
    {
        titulo: 'guardar los juguetes',
        pasos: [
            { texto: 'recoger los bloques', clave: 'bloques' },
            { texto: 'guardar los muñecos', clave: 'munecos', alias: ['muñecos'] },
            { texto: 'cerrar la caja', clave: 'caja' },
            { texto: 'dejar todo en su lugar', clave: 'lugar' },
        ],
        pista: 'Bloques, muñecos, caja y lugar.',
    },
    {
        titulo: 'vestirse para salir',
        pasos: [
            { texto: 'ponerse la camisa', clave: 'camisa' },
            { texto: 'ponerse el pantalón', clave: 'pantalon', alias: ['pantalón'] },
            { texto: 'ponerse los zapatos', clave: 'zapatos' },
            { texto: 'ponerse la chamarra', clave: 'chamarra' },
        ],
        pista: 'Camisa, pantalón, zapatos y chamarra.',
    },
]);

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = ORDENA_BANK.length;

const HINT_FRAMES: readonly string[] = Object.freeze([
    'pista', 'ayuda', 'ayudame', 'repite',
]);

// "no sé" / "me rindo" = el niño se rinde → SALTAR (no dar la respuesta).
const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'siguiente', 'otro', 'sigo', 'no se', 'no sé', 'me rindo',
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

/** Posición de la clave (o de un alias hablado) en el texto, o null si falta. */
function claveIndex(normalized: string, paso: OrdenaPaso): number | null {
    const candidates = [paso.clave, ...(paso.alias || [])];
    let best: number | null = null;
    for (const candidate of candidates) {
        const idx = findTokenIndex(normalized, normalizeForMatch(candidate));
        if (idx !== null && (best === null || idx < best)) best = idx;
    }
    return best;
}

/**
 * Posiciones de TODAS las claves en el texto, o `null` si falta alguna.
 * El orden REAL lo decide el texto del niño (posición creciente), no el
 * orden del banco: antes se recorría `item.pasos` (siempre ordenado) y la
 * validación solo comprobaba completitud, permitiendo ganar en desorden.
 */
function clavePositions(normalized: string, item: OrdenaSecuenciaItem): number[] | null {
    const positions: number[] = [];
    for (const paso of item.pasos) {
        const idx = claveIndex(normalized, paso);
        if (idx === null) return null;
        positions.push(idx);
    }
    return positions;
}

/** ¿Las posiciones van estrictamente en aumento? (orden correcto recitado). */
function isAscending(positions: readonly number[]): boolean {
    for (let i = 1; i < positions.length; i += 1) {
        if (positions[i] <= positions[i - 1]) return false;
    }
    return true;
}

/** Cuántos pasos reconoció el niño (distingue "incompleto" de "sin pasos"). */
function countRecognized(normalized: string, item: OrdenaSecuenciaItem): number {
    return item.pasos.reduce(
        (acc, paso) => acc + (claveIndex(normalized, paso) !== null ? 1 : 0),
        0,
    );
}

export function createOrdenaSecuenciaEngine(options?: { random?: RandomSource }): GameEngine<OrdenaSecuenciaState> {
    let rng: RandomSource = options?.random ?? Math.random;
    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): OrdenaSecuenciaState => {
        rng = adoptRandom(rng, cfg);
        const state: OrdenaSecuenciaState = {
            order: ORDENA_BANK.map((_, index) => index),
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
        id: 'ordena_secuencia',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<OrdenaSecuenciaState> {
            rng = adoptRandom(rng, optionsConfig);
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
                    maxRounds: readRounds(optionsConfig, DEFAULT_ROUNDS, MAX_ROUNDS),
                    phase: 'announce',
                },
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as OrdenaSecuenciaState;
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
            const state = session.state as OrdenaSecuenciaState;

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

            // ¿Recita TODOS los pasos en el orden correcto?
            const positions = clavePositions(normalized, item);
            if (positions && isAscending(positions)) {
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

            // Intentó pero el orden está incompleto o desordenado.
            if (countRecognized(normalized, item) > 0) {
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
