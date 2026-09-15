// ============================================================
// src/core/games/trivia.ts
// Trivia (plan-juegos §Fase 3, Riesgo 3). Motor puro sin I/O.
//
// Banco local de preguntas de opción múltiple `{ pregunta,
// opciones, correcta, pista }`. Validación por:
//   - texto de la opción ("el gato")
//   - número ("la opción 2", "la segunda")
//   - letra ("la b")
//
// Controles:
//   "pista" / "ayuda"  → pista de la pregunta actual
//   "paso" / "siguiente" → saltar a la siguiente
// Fin al completar `rounds` preguntas.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';
import {
    clamp, normalizeForMatch, hasToken, hasAnyToken, resolveNumericAnswer,
} from './gameUtils';

export interface TriviaQuestion {
    pregunta: string;
    opciones: string[];     // 4 opciones
    correcta: number;       // índice de la correcta
    pista: string;
}

export const TRIVIA_BANK: readonly TriviaQuestion[] = Object.freeze([
    { pregunta: '¿Qué animal dice miau?', opciones: ['perro', 'gato', 'pájaro', 'pez'], correcta: 1, pista: 'Es un felino que ronronea.' },
    { pregunta: '¿De qué color es el sol?', opciones: ['verde', 'azul', 'amarillo', 'morado'], correcta: 2, pista: 'Como un plátano maduro.' },
    { pregunta: '¿Cuántas patas tiene un perro?', opciones: ['dos', 'tres', 'cuatro', 'cinco'], correcta: 2, pista: 'Camina y corre con sus patas.' },
    { pregunta: '¿Qué fruta es larga y amarilla?', opciones: ['manzana', 'uva', 'plátano', 'fresa'], correcta: 2, pista: 'A los monos les encanta.' },
    { pregunta: '¿Qué usas para leer?', opciones: ['una silla', 'un libro', 'una cuchara', 'una pelota'], correcta: 1, pista: 'Tiene hojas y un cuento.' },
    { pregunta: '¿Qué hay en el cielo de noche?', opciones: ['el sol', 'la luna', 'la playa', 'la montaña'], correcta: 1, pista: 'Brilla cuando está oscuro.' },
    { pregunta: '¿Cómo se llama el bebé del gato?', opciones: ['cachorro', 'gatito', 'pollito', 'patito'], correcta: 1, pista: 'Es un gato muy pequeñito.' },
    { pregunta: '¿Qué prenda te pones en los pies?', opciones: ['gorra', 'guante', 'zapato', 'bufanda'], correcta: 2, pista: 'La usas para caminar.' },
    { pregunta: '¿Qué animal nada en el mar?', opciones: ['águila', 'conejo', 'delfín', 'tortuga', 'león'], correcta: 2, pista: 'Es muy inteligente y salta del agua.' },
    { pregunta: '¿Qué usas para dibujar?', opciones: ['tijeras', 'lápiz', 'martillo', 'regla'], correcta: 1, pista: 'Tiene punta y grafito.' },
]);

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = TRIVIA_BANK.length;

const HINT_FRAMES: readonly string[] = Object.freeze([
    'pista', 'ayuda', 'ayudame', 'dame una pista',
]);

// "no sé" = rendirse → SALTAR (antes era código muerto: el hint iba primero).
const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'siguiente', 'otra', 'sigo', 'no se', 'no sé', 'me rindo',
]);

const END_FRAMES: readonly string[] = Object.freeze([
    'salir del juego',
    'terminar el juego',
    'dejar de jugar',
    'ya no quiero jugar',
    'cerrar el juego',
]);

const ORDINAL_ES: Record<string, number> = Object.freeze({
    primera: 1, primer: 1,
    segunda: 2, segundo: 2,
    tercera: 3, tercero: 3,
    cuarta: 4, cuarto: 4,
    quinta: 5, quinto: 5,
});

/** Palabras cortas/función que no identifican una opción ("la", "un"…). */
const OPTION_STOPWORDS: ReadonlySet<string> = new Set([
    'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'y', 'o', 'en', 'con',
]);

type RandomSource = () => number;

interface TriviaState {
    order: number[];
    cursor: number;
    maxRounds: number;
    phase: 'announce' | 'done';
}

function questionAt(state: TriviaState): TriviaQuestion | null {
    const index = state.order[state.cursor];
    return index === undefined ? null : TRIVIA_BANK[index];
}

function optionsPrompt(question: TriviaQuestion): string {
    return question.opciones
        .map((opcion, index) => `${index + 1}. ${opcion}`)
        .join(', ');
}

function currentPrompt(state: TriviaState): string {
    const question = questionAt(state);
    if (!question) return 'Ya se me acabaron las preguntas.';
    return `${question.pregunta} Opciones: ${optionsPrompt(question)}`;
}

function resolveOptionIndex(normalized: string, question: TriviaQuestion): number | null {
    // 1) Texto completo de la opción ("la luna") o su palabra significativa
    //    ("luna"): exigir la frase completa rechazaba respuestas naturales.
    for (let i = 0; i < question.opciones.length; i += 1) {
        const option = question.opciones[i];
        if (hasToken(normalized, option)) return i;
        const keywords = option
            .split(/\s+/)
            .filter((token) => token.length >= 4 && !OPTION_STOPWORDS.has(token));
        if (keywords.some((keyword) => hasToken(normalized, keyword))) return i;
    }
    // 2) Número / ordinal ("la opción 2", "la segunda").
    const num = resolveNumericAnswer(normalized);
    if (num !== null) {
        const idx = num - 1;
        if (idx >= 0 && idx < question.opciones.length) return idx;
    }
    for (const token of normalized.split(/\s+/)) {
        if (token in ORDINAL_ES) {
            const idx = ORDINAL_ES[token] - 1;
            if (idx >= 0 && idx < question.opciones.length) return idx;
        }
    }
    // 3) Letra ("la b"): el banco admite hasta 5 opciones (a–e).
    const letter = normalized.match(/\b([a-e])\b/);
    if (letter) {
        const idx = letter[1].charCodeAt(0) - 97;
        if (idx >= 0 && idx < question.opciones.length) return idx;
    }
    return null;
}

export function createTriviaEngine(options?: { random?: RandomSource }): GameEngine {
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

    const shuffledOrder = (): number[] => {
        const order = TRIVIA_BANK.map((_, index) => index);
        for (let i = order.length - 1; i > 0; i -= 1) {
            const j = Math.floor(rng() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        return order;
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): TriviaState => {
        adoptRandom(cfg);
        const state: TriviaState = {
            order: shuffledOrder(),
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
        id: 'trivia',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession {
            adoptRandom(optionsConfig);
            return {
                id: 'trivia',
                state: {
                    order: shuffledOrder(),
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
            const state = session.state as unknown as TriviaState;
            return {
                prompt: `¡Vamos a jugar a la trivia! ${currentPrompt(state)}`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'excited',
            };
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as unknown as TriviaState;

            if (state.phase === 'done') {
                return {
                    prompt: 'Ya terminamos la trivia. ¿Jugamos otra vez?',
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'happy',
                };
            }

            const question = questionAt(state);
            if (!question) {
                state.phase = 'done';
                return {
                    prompt: `¡Se acabaron las preguntas! Tu puntaje fue ${session.score}. ¡Muy bien!`,
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
                    prompt: `Aquí va una pista: ${question.pista}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'thinking',
                };
            }

            // ¿Responde?
            const idx = resolveOptionIndex(normalized, question);
            if (idx !== null) {
                if (idx === question.correcta) {
                    session.score += 1;
                    session.round += 1;
                    if (state.cursor + 1 >= state.maxRounds || state.cursor + 1 >= state.order.length) {
                        state.phase = 'done';
                        return {
                            prompt: `¡Correcto, era ${question.opciones[question.correcta]}! Completaste ${state.maxRounds} preguntas con ${session.score} puntos. ¡Eres muy listo!`,
                            valid: true,
                            gameOver: true,
                            score: session.score,
                            animation: 'Dance',
                            emotion: 'happy',
                        };
                    }
                    state.cursor += 1;
                    return {
                        prompt: `¡Correcto, era ${question.opciones[question.correcta]}! Siguiente: ${currentPrompt(state)}`,
                        valid: true,
                        gameOver: false,
                        score: session.score,
                        animation: 'Jump_in_place',
                        emotion: 'happy',
                    };
                }
                return {
                    prompt: `¡Casi! Esa no era. ${currentPrompt(state)}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'encouraging',
                    error: 'opción incorrecta',
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
                prompt: `No te escuché bien. Dime el número, la letra o el nombre. ${currentPrompt(state)}`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'neutral',
                error: 'sin opción reconocida',
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
