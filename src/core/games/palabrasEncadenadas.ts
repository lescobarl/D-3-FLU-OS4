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
import { END_GAME_FRAMES, STOPWORDS_ES, adoptRandom, baseSession, beginGame, gameOverResult, hasAnyToken, hasToken, isStopOrSkipCommand, normalizeForMatch, pickRandom, readRounds, resetGameSession, stripDiacritics, turnResult } from './gameUtils';

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

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): PalabrasEncadenadasState =>
        resetGameSession(session, cfg, buildState);

    return {
        id: 'palabras_encadenadas',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<PalabrasEncadenadasState> {
            return baseSession('palabras_encadenadas', buildState(optionsConfig));
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            return beginGame(session, optionsConfig, reset, (raw) => {
                const state = raw as PalabrasEncadenadasState;
                return `¡Vamos a jugar a palabras encadenadas! Empiezo yo con ${state.word}. Di una palabra que empiece con la letra ${state.nextLetter.toUpperCase()}.`;
            }, { emotion: 'excited' });
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
                return turnResult(`Ya dijiste "${playerWord}". Di una palabra nueva que empiece con la letra ${state.nextLetter.toUpperCase()}.`, session.score, { error: 'palabra repetida' });
            }
            if (!playerWord && bankWord) {
                return turnResult(`¡Casi! Tu palabra debe empezar con la letra ${state.nextLetter.toUpperCase()}. Inténtalo otra vez.`, session.score, { emotion: 'encouraging', error: 'la palabra no empieza con la letra pedida' });
            }
            if (!playerWord) {
                return turnResult(`No reconozco esa palabra. Di una palabra que empiece con la letra ${state.nextLetter.toUpperCase()}.`, session.score, { error: 'palabra desconocida' });
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
            return turnResult(`¡Genial, ${playerWord}! Sigue tú: yo digo ${fluWord}. Di una palabra que empiece con la letra ${state.nextLetter.toUpperCase()}.`, session.score, { valid: true, animation: 'Jump_in_place', emotion: 'happy' });
        },

        isGameCommand(text = ''): boolean {
            return isStopOrSkipCommand(text, END_FRAMES, SKIP_FRAMES);
        },
    };
}
export const PALABRAS_ENCADENADAS_COMMAND_FRAMES = Object.freeze({ SKIP_FRAMES, END_FRAMES })
