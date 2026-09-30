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
import { stripDiacritics, normalizeForMatch, adoptRandom, readRounds, hasToken, hasAnyToken, STOPWORDS_ES, END_GAME_FRAMES, matchesEndGameFrames, pickRandom, gameOverResult } from './gameUtils';

export const WORD_BANK: readonly string[] = Object.freeze([
    'avión', 'auto', 'árbol', 'agua', 'abeja', 'amigo', 'araña',
    'barco', 'bota', 'beso', 'bailarina', 'banana',
    'casa', 'cama', 'caja', 'carro', 'conejo', 'cuchara',
    'elefante', 'escoba', 'espejo', 'estrella', 'erizo',
    'flor', 'foca', 'fresa',
    'gato', 'globo', 'guante', 'gorra', 'galleta',
    'jirafa',
    'luna', 'libro', 'lago', 'león', 'lobo', 'lápiz',
    'manzana', 'mariposa', 'moto', 'mesa', 'mono', 'mar', 'mano',
    'nube', 'nariz', 'niño', 'nido',
    'oso', 'olla', 'ojo',
    'perro', 'pelota', 'pato', 'piedra', 'pera', 'payaso', 'pez',
    'ratón', 'reloj', 'rana', 'río', 'rosa', 'robot',
    'sol', 'silla', 'sombrero', 'sandía', 'serpiente',
    'tren', 'tigre', 'taza', 'tomate', 'tortuga',
    'uva', 'unicornio',
    'zapato',
]);

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = 10;

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'me rindo', 'rendirse', 'no se', 'no sé',
]);

const END_FRAMES: readonly string[] = END_GAME_FRAMES;

interface PalabrasEncadenadasState {
    word: string;
    nextLetter: string;
    usadas: string[];
    maxRounds: number;
    phase: 'announce' | 'done';
}

type RandomSource = () => number;





function firstLetter(word: string): string {
    return stripDiacritics(word).trim()[0]?.toLowerCase() ?? '';
}

function lastLetter(word: string): string {
    const clean = stripDiacritics(word).trim();
    return clean[clean.length - 1]?.toLowerCase() ?? '';
}

/**
 * Palabra del banco mencionada en el texto. Si se indica `requiredLetter`,
 * prefiere la que empieza con esa letra (antes se devolvía la PRIMERA del
 * banco en la frase: "la casa del oso" con letra "o" rechazaba "oso").
 */
function findBankWord(normalized: string, requiredLetter?: string): string | null {
    let anyMatch: string | null = null;
    for (const word of WORD_BANK) {
        if (!hasToken(normalized, word)) continue;
        if (requiredLetter && firstLetter(word) === requiredLetter) return word;
        if (!anyMatch) anyMatch = word;
    }
    return anyMatch;
}

/** Palabra del banco que continúa la cadena desde la última letra dada. */
function continuationFor(playerWord: string, usadas: readonly string[], rng: RandomSource): string | null {
    const letter = lastLetter(playerWord);
    const conLetra = WORD_BANK.filter((word) => firstLetter(word) === letter && word !== playerWord);
    const nuevas = conLetra.filter((word) => !usadas.includes(word));
    const pool = nuevas.length > 0 ? nuevas : conLetra;
    // El banco esta cerrado para SUS palabras, no para el vocabulario del nino:
    // si dice una palabra que acaba en una letra que el banco no puede seguir,
    // no hay continuacion (antes se devolvia undefined).
    return pool.length > 0 ? pickRandom(pool, rng) : null;
}

/**
 * Palabra REAL dicha por el nino que empieza por la letra pedida. La regla real
 * acepta su vocabulario; exigir el banco local volvia el juego injugable
 * (con la letra N, "naranja" se rechazaba).
 */
function realWordWithLetter(normalized: string, letra: string): string | null {
    for (const token of normalized.split(/\s+/)) {
        if (token.length >= 2 && token.startsWith(letra) && !STOPWORDS_ES.has(token)) return token;
    }
    return null;
}

export function createPalabrasEncadenadasEngine(options?: { random?: RandomSource }): GameEngine<PalabrasEncadenadasState> {
    let rng: RandomSource = options?.random ?? Math.random;
    const buildState = (cfg: Record<string, unknown> | undefined): PalabrasEncadenadasState => {
        rng = adoptRandom(rng, cfg);
        const startWord = pickRandom(WORD_BANK, rng);
        return {
            word: startWord,
            nextLetter: lastLetter(startWord),
            usadas: [startWord],
            maxRounds: readRounds(cfg, DEFAULT_ROUNDS, MAX_ROUNDS),
            phase: 'announce',
        };
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): PalabrasEncadenadasState => {
        const state: PalabrasEncadenadasState = buildState(cfg);
        session.state = state;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'palabras_encadenadas',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<PalabrasEncadenadasState> {
            return {
                id: 'palabras_encadenadas',
                state: buildState(optionsConfig),
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as PalabrasEncadenadasState;
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
            const state = session.state as PalabrasEncadenadasState;

            if (state.phase === 'done') {
                return gameOverResult('Ya terminamos de jugar palabras encadenadas. ¿Jugamos otra vez?', session.score);
            }

            const normalized = normalizeForMatch(text);

            // ¿Cierra la cadena?
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                state.phase = 'done';
                return gameOverResult(
                        `¡Claro! La cadena quedó de ${session.score} ${session.score === 1 ? 'palabra' : 'palabras'}. ¡Muy bien jugado!`,
                        session.score,
                        { animation: 'Dance' },
                    );
            }

            // Palabra del nino: primero el banco (prefiere la que enlaza) y, si no
            // esta, CUALQUIER palabra real que empiece por la letra pedida. La regla
            // real acepta el vocabulario del nino; exigir el banco lo volvia injugable.
            const bankWord = findBankWord(normalized, state.nextLetter);
            const playerWord = bankWord && firstLetter(bankWord) === state.nextLetter
                ? bankWord
                : realWordWithLetter(normalized, state.nextLetter);
            if (playerWord && state.usadas.includes(playerWord)) {
                return {
                    prompt: `Ya dijiste "${playerWord}". Di una palabra nueva que empiece con la letra ${state.nextLetter.toUpperCase()}.`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                    error: 'palabra repetida',
                };
            }
            if (!playerWord && bankWord) {
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

            state.usadas.push(playerWord);
            session.score += 1;
            session.round += 1;
            if (session.round > state.maxRounds) {
                state.phase = 'done';
                return gameOverResult(
                        `¡Qué buena cadena! Encadenamos ${session.score} palabras. ¡Eres muy creativo!`,
                        session.score,
                        { valid: true, won: true, animation: 'Dance' },
                    );
            }

            const fluWord = continuationFor(playerWord, state.usadas, rng);
            if (!fluWord) {
                state.phase = 'done';
                return gameOverResult(
                        `¡Me ganaste! No se me ocurre ninguna palabra con la letra ${lastLetter(playerWord).toUpperCase()}. ¡Muy bien!`,
                        session.score,
                        { valid: true, won: true, animation: 'Dance' },
                    );
            }
            state.usadas.push(fluWord);
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
            return matchesEndGameFrames(normalized, END_FRAMES)
                || SKIP_FRAMES.some((frame) => hasToken(normalized, frame));
        },
    };
}
// Superficie de comandos PUBLICADA como dato, con nombre CALIFICADO por motor:
// los simbolos exportados deben ser unicos (un `HINT_FRAMES` por modulo choca).
export const PALABRAS_ENCADENADAS_COMMAND_FRAMES = Object.freeze({ SKIP_FRAMES, END_FRAMES })
