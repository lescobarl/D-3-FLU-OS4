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
import type { GameEngine } from './gameEngine.ts';
import type { GameSession, GameTurnResult } from './types.ts';
import { END_GAME_FRAMES, HELP_CORE_FRAMES, adoptRandom, advanceCursorAfterSkip, bankItemAt, baseSession, buildShuffledState, findTokenIndex, gameOverResult, hasAnyToken, isEngineCommand, isLastRound, normalizeForMatch, resetGameSession, roundsOverMessage, shuffleOrder, turnResult } from './gameUtils.ts';

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
    ...HELP_CORE_FRAMES,
    'repite',
]);

// "no sé" / "me rindo" = el niño se rinde → SALTAR (no dar la respuesta).
const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'siguiente', 'otro', 'sigo', 'no se', 'no sé', 'me rindo',
]);

const END_FRAMES: readonly string[] = END_GAME_FRAMES;

type RandomSource = () => number;

interface OrdenaSecuenciaState {
    order: number[];
    cursor: number;
    maxRounds: number;
    phase: 'announce' | 'done';
}

const itemAt = (state: OrdenaSecuenciaState) => bankItemAt(state, ORDENA_BANK);

function shufflePasos(item: OrdenaSecuenciaItem, rng: RandomSource): number[] {
    return shuffleOrder(rng, item.pasos.length);
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
    const buildState = (cfg: Record<string, unknown> | undefined): OrdenaSecuenciaState =>
        buildShuffledState({
            cfg,
            bankLength: ORDENA_BANK.length,
            defaultRounds: DEFAULT_ROUNDS,
            maxRounds: MAX_ROUNDS,
            adopt: (cfg2) => {
                rng = adoptRandom(rng, cfg2);
                return rng;
            },
            build: ({ order, maxRounds }) => ({ order, cursor: 0, maxRounds, phase: 'announce' }),
        });

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): OrdenaSecuenciaState =>
        resetGameSession(session, cfg, buildState);

    return {
        id: 'ordena_secuencia',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<OrdenaSecuenciaState> {
            return baseSession('ordena_secuencia', buildState(optionsConfig));
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as OrdenaSecuenciaState;
            const item = itemAt(state);
            if (!item) {
                return gameOverResult('Ya se me acabaron las secuencias.', 0);
            }
            return turnResult(`¡Vamos a ordenar los pasos para ${item.titulo}! Dime los pasos en el orden correcto: ${displayScrambled(item, shufflePasos(item, rng))}`, session.score, { emotion: 'excited' });
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as OrdenaSecuenciaState;

            if (state.phase === 'done') {
                return gameOverResult('Ya terminamos las secuencias. ¿Jugamos otra vez?', session.score);
            }

            const item = itemAt(state);
            if (!item) {
                state.phase = 'done';
                return gameOverResult(
                        `¡Se acabaron las secuencias! Tu puntaje fue ${session.score}. ¡Muy bien!`,
                        session.score,
                        { animation: 'Dance' },
                    );
            }

            const normalized = normalizeForMatch(text);

            // ¿Pide pista?
            if (hasAnyToken(normalized, HINT_FRAMES)) {
                return turnResult(`El orden correcto es: ${item.pasos.map((paso) => paso.texto).join(', ')}. ${item.pista}`, session.score, { emotion: 'thinking' });
            }

            // ¿Recita TODOS los pasos en el orden correcto?
            const positions = clavePositions(normalized, item);
            if (positions && isAscending(positions)) {
                session.score += 1;
                session.round += 1;
                if (isLastRound(state)) {
                    state.phase = 'done';
                    return gameOverResult(
                            `¡Perfecto! Completaste ${state.maxRounds} secuencias con ${session.score} puntos. ¡Eres muy listo!`,
                            session.score,
                            { valid: true, won: true, animation: 'Dance' },
                        );
                }
                state.cursor += 1;
                const next = itemAt(state);
                if (!next) {
                    state.phase = 'done';
                    return gameOverResult(
                            `¡Se acabaron las secuencias! Tu puntaje fue ${session.score}. ¡Muy bien!`,
                            session.score,
                            { valid: true, won: true, animation: 'Dance' },
                        );
                }
                return turnResult(`¡Perfecto! Siguiente: ordena los pasos para ${next.titulo}: ${displayScrambled(next, shufflePasos(next, rng))}`, session.score, { valid: true, animation: 'Jump_in_place', emotion: 'happy' });
            }

            // ¿Salta?
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                const finRonda = advanceCursorAfterSkip(session, state);
                if (finRonda) return finRonda;
                const next = itemAt(state);
                if (!next) {
                    state.phase = 'done';
                    return gameOverResult(
                            roundsOverMessage(session.score),
                            session.score,
                            { animation: 'Dance' },
                        );
                }
                return turnResult(`¡Claro! Aquí va otra: ordena los pasos para ${next.titulo}: ${displayScrambled(next, shufflePasos(next, rng))}`, session.score);
            }

            // Intentó pero el orden está incompleto o desordenado.
            if (countRecognized(normalized, item) > 0) {
                return turnResult(`Casi. El orden correcto es: ${item.pasos.map((paso) => paso.texto).join(', ')}. Inténtalo de nuevo.`, session.score, { emotion: 'encouraging', error: 'orden incorrecto' });
            }

            return turnResult(`No te escuché bien. Dime los pasos para ${item.titulo} en orden.`, session.score, { error: 'sin pasos reconocidos' });
        },

        isGameCommand(text = ''): boolean {
            return isEngineCommand(text, { end: END_FRAMES, hint: HINT_FRAMES, skip: SKIP_FRAMES });
        },
    };
}
export const ORDENA_SECUENCIA_COMMAND_FRAMES = Object.freeze({ HINT_FRAMES, SKIP_FRAMES, END_FRAMES })
