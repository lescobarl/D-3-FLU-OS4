// ============================================================
// src/core/games/palabrasEncadenadas.ts
// Palabras encadenadas (plan-juegos §4). Motor puro sin I/O.
//
// FLU dice una palabra y el niño responde con otra que empieza por
// la última letra de la anterior. El plan marca "sin scoring
// estricto": cada enlace vale +1 solo como motivación, y la cadena
// no es competitiva. El banco local está cerrado bajo
// encadenamiento (toda última letra tiene al menos una palabra que
// empieza con ella), por lo que el juego nunca se atora.
//
// - Enlace válido → +1 y FLU continúa la cadena.
// - "paso" / "no sé" → cierra la cadena con un resumen.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';

export const WORD_BANK: readonly string[] = Object.freeze([
    'avion', 'auto', 'arbol', 'agua', 'abeja', 'amigo', 'arana',
    'barco', 'bota', 'beso', 'bailarina', 'banana',
    'casa', 'cama', 'caja', 'carro', 'conejo', 'cuchara',
    'elefante', 'escoba', 'espejo', 'estrella', 'erizo',
    'flor', 'foca', 'fresa',
    'gato', 'globo', 'guante', 'gorra', 'galleta',
    'jirafa',
    'luna', 'libro', 'lago', 'leon', 'lobo', 'lapiz',
    'manzana', 'mariposa', 'moto', 'mesa', 'mono', 'mar', 'mano',
    'nube', 'nariz', 'nino', 'nido',
    'oso', 'olla', 'ojo',
    'perro', 'pelota', 'pato', 'piedra', 'pera', 'payaso', 'pez',
    'raton', 'reloj', 'rana', 'rio', 'rosa', 'robot',
    'sol', 'silla', 'sombrero', 'sandia', 'serpiente',
    'tren', 'tigre', 'taza', 'tomate', 'tortuga',
    'uva', 'unicornio',
    'zapato',
]);

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = 10;

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'me rindo', 'rendirse', 'no se', 'no sé',
]);

const END_FRAMES: readonly string[] = Object.freeze([
    'salir del juego',
    'terminar el juego',
    'dejar de jugar',
    'ya no quiero jugar',
    'cerrar el juego',
]);

interface PalabrasEncadenadasState {
    word: string;
    nextLetter: string;
    maxRounds: number;
    phase: 'announce' | 'done';
}

type RandomSource = () => number;

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.round(value)));
}

function stripDiacritics(text: string): string {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeForMatch(text = ''): string {
    return stripDiacritics(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasToken(normalized = '', phrase = ''): boolean {
    if (!phrase) return false;
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|\\s)${escaped}($|\\s|[.,;!?¡¿])`);
    return pattern.test(normalized);
}

function hasAnyToken(normalized: string, phrases: readonly string[]): boolean {
    return phrases.some((phrase) => hasToken(normalized, phrase));
}

function pickRandom<T>(items: readonly T[], rng: RandomSource): T {
    return items[Math.floor(rng() * items.length)];
}

function firstLetter(word: string): string {
    return stripDiacritics(word).trim()[0]?.toLowerCase() ?? '';
}

function lastLetter(word: string): string {
    const clean = stripDiacritics(word).trim();
    return clean[clean.length - 1]?.toLowerCase() ?? '';
}

/** Primera palabra del banco mencionada en el texto (límites de palabra). */
function findBankWord(normalized: string): string | null {
    for (const word of WORD_BANK) {
        if (hasToken(normalized, word)) return word;
    }
    return null;
}

/** Palabra del banco que continúa la cadena desde la última letra dada. */
function continuationFor(playerWord: string, rng: RandomSource): string {
    const letter = lastLetter(playerWord);
    const candidates = WORD_BANK.filter((word) => firstLetter(word) === letter && word !== playerWord);
    const pool = candidates.length > 0 ? candidates : WORD_BANK.filter((word) => firstLetter(word) === letter);
    return pickRandom(pool, rng);
}

export function createPalabrasEncadenadasEngine(options?: { random?: RandomSource }): GameEngine {
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

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): PalabrasEncadenadasState => {
        adoptRandom(cfg);
        const startWord = pickRandom(WORD_BANK, rng);
        const state: PalabrasEncadenadasState = {
            word: startWord,
            nextLetter: lastLetter(startWord),
            maxRounds: readRounds(cfg),
            phase: 'announce',
        };
        session.state = state as unknown as Record<string, unknown>;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'palabras_encadenadas',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession {
            adoptRandom(optionsConfig);
            const startWord = pickRandom(WORD_BANK, rng);
            return {
                id: 'palabras_encadenadas',
                state: {
                    word: startWord,
                    nextLetter: lastLetter(startWord),
                    maxRounds: readRounds(optionsConfig),
                    phase: 'announce',
                },
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as unknown as PalabrasEncadenadasState;
            return {
                prompt: `¡Vamos a jugar a palabras encadenadas! Empiezo yo con ${state.word}. Di una palabra que empiece con la letra ${state.nextLetter.toUpperCase()}.`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'excited',
            };
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as unknown as PalabrasEncadenadasState;

            if (state.phase === 'done') {
                return {
                    prompt: 'Ya terminamos de jugar palabras encadenadas. ¿Jugamos otra vez?',
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'happy',
                };
            }

            const normalized = normalizeForMatch(text);

            // ¿Cierra la cadena?
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                state.phase = 'done';
                return {
                    prompt: `¡Claro! La cadena quedó de ${session.score} ${session.score === 1 ? 'palabra' : 'palabras'}. ¡Muy bien jugado!`,
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Dance',
                    emotion: 'happy',
                };
            }

            // Palabra del niño (del banco local).
            const playerWord = findBankWord(normalized);
            if (!playerWord) {
                return {
                    prompt: `No reconozco esa palabra. Di una palabra que empiece con la letra ${state.nextLetter.toUpperCase()}.`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                    error: 'palabra desconocida',
                };
            }

            if (firstLetter(playerWord) !== state.nextLetter) {
                return {
                    prompt: `¡Casi! Tu palabra debe empezar con la letra ${state.nextLetter.toUpperCase()}. Inténtalo otra vez.`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'encouraging',
                    error: 'la palabra no empieza con la letra pedida',
                };
            }

            session.score += 1;
            session.round += 1;
            if (session.round > state.maxRounds) {
                state.phase = 'done';
                return {
                    prompt: `¡Qué buena cadena! Encadenamos ${session.score} palabras. ¡Eres muy creativo!`,
                    valid: true,
                    gameOver: true,
                    score: session.score,
                    animation: 'Dance',
                    emotion: 'happy',
                };
            }

            const fluWord = continuationFor(playerWord, rng);
            state.word = fluWord;
            state.nextLetter = lastLetter(fluWord);
            return {
                prompt: `¡Genial, ${playerWord}! Sigue tú: yo digo ${fluWord}. Di una palabra que empiece con la letra ${state.nextLetter.toUpperCase()}.`,
                valid: true,
                gameOver: false,
                score: session.score,
                animation: 'Jump_in_place',
                emotion: 'happy',
            };
        },

        isGameCommand(text = ''): boolean {
            const normalized = normalizeForMatch(text);
            return END_FRAMES.some((frame) => normalized.includes(frame))
                || SKIP_FRAMES.some((frame) => hasToken(normalized, frame));
        },
    };
}
