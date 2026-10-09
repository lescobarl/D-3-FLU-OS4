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
import { END_GAME_FRAMES, HELP_CORE_FRAMES, adoptRandom, baseSession, beginGame, buildShuffledState, finishRoundsIfLast, gameOverResult, gamePrompt, hasAnyToken, hasToken, isEngineCommand, isLastRound, normalizeForMatch, resetGameSession, resolveNumericAnswer, turnResult } from './gameUtils';

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
{ pregunta: '¿Qué animal vive en el mar y es muy inteligente?', opciones: ['águila', 'conejo', 'delfín', 'león'], correcta: 2, pista: 'Salta del agua y es muy listo.' },
    { pregunta: '¿Qué usas para dibujar?', opciones: ['tijeras', 'lápiz', 'martillo', 'regla'], correcta: 1, pista: 'Tiene punta y grafito.' },
]);

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = TRIVIA_BANK.length;

const HINT_FRAMES: readonly string[] = Object.freeze([
    ...HELP_CORE_FRAMES,
    'dame una pista',
]);

// "no sé" = rendirse → SALTAR (antes era código muerto: el hint iba primero).
const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'siguiente', 'otra', 'sigo', 'no se', 'no sé', 'me rindo',
]);

const END_FRAMES: readonly string[] = END_GAME_FRAMES;

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

const currentPrompt = (state: TriviaState) =>
    gamePrompt(
        state,
        questionAt,
        (question) => `${question.pregunta} Opciones: ${optionsPrompt(question)}`,
        'Ya se me acabaron las preguntas.',
    );

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

export function createTriviaEngine(options?: { random?: RandomSource }): GameEngine<TriviaState> {
    let rng: RandomSource = options?.random ?? Math.random;

    const buildState = (cfg: Record<string, unknown> | undefined): TriviaState =>
        buildShuffledState({
            cfg,
            bankLength: TRIVIA_BANK.length,
            defaultRounds: DEFAULT_ROUNDS,
            maxRounds: MAX_ROUNDS,
            adopt: (cfg2) => {
                rng = adoptRandom(rng, cfg2);
                return rng;
            },
            build: ({ order, maxRounds }) => ({ order, cursor: 0, maxRounds, phase: 'announce' }),
        });

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): TriviaState =>
        resetGameSession(session, cfg, buildState);

    return {
        id: 'trivia',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<TriviaState> {
            return baseSession('trivia', buildState(optionsConfig));
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            return beginGame(session, optionsConfig, reset, (raw) => {
                const state = raw as TriviaState;
                return `¡Vamos a jugar a la trivia! ${currentPrompt(state)}`;
            }, { emotion: 'excited' });
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as TriviaState;

            if (state.phase === 'done') {
                return gameOverResult('Ya terminamos la trivia. ¿Jugamos otra vez?', session.score);
            }

            const question = questionAt(state);
            if (!question) {
                state.phase = 'done';
                return gameOverResult(
                        `¡Se acabaron las preguntas! Tu puntaje fue ${session.score}. ¡Muy bien!`,
                        session.score,
                        { animation: 'Dance' },
                    );
            }

            const normalized = normalizeForMatch(text);

            // ¿Pide pista?
            if (hasAnyToken(normalized, HINT_FRAMES)) {
                return turnResult(`Aquí va una pista: ${question.pista}`, session.score, { emotion: 'thinking' });
            }

            // ¿Responde?
            const idx = resolveOptionIndex(normalized, question);
            if (idx !== null) {
                if (idx === question.correcta) {
                    session.score += 1;
                    session.round += 1;
                    if (isLastRound(state)) {
                        state.phase = 'done';
                        return gameOverResult(
                                `¡Correcto, era ${question.opciones[question.correcta]}! Completaste ${state.maxRounds} preguntas con ${session.score} puntos. ¡Eres muy listo!`,
                                session.score,
                                { valid: true, won: true, animation: 'Dance' },
                            );
                    }
                    state.cursor += 1;
                    return turnResult(`¡Correcto, era ${question.opciones[question.correcta]}! Siguiente: ${currentPrompt(state)}`, session.score, { valid: true, animation: 'Jump_in_place', emotion: 'happy' });
                }
                return turnResult(`¡Casi! Esa no era. ${currentPrompt(state)}`, session.score, { emotion: 'encouraging', error: 'opción incorrecta' });
            }

            // ¿Salta?
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                session.round += 1;
                const finRonda = finishRoundsIfLast(session, state);
                if (finRonda) return finRonda;
                state.cursor += 1;
                return turnResult(`¡Claro! Aquí va otra: ${currentPrompt(state)}`, session.score);
            }

            return turnResult(`No te escuché bien. Dime el número, la letra o el nombre. ${currentPrompt(state)}`, session.score, { error: 'sin opción reconocida' });
        },

        isGameCommand(text = ''): boolean {
            return isEngineCommand(text, { end: END_FRAMES, hint: HINT_FRAMES, skip: SKIP_FRAMES });
        },
    };
}
export const TRIVIA_COMMAND_FRAMES = Object.freeze({ HINT_FRAMES, SKIP_FRAMES, END_FRAMES })
