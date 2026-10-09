// ============================================================
// src/core/games/ahorcado.ts
// Ahorcado (plan-juegos §Fase 3, Riesgo 3). Motor puro sin I/O.
//
// Banco local de palabras con pistas. El jugador dice una letra
// (o la palabra completa) para adivinar; FLU revela las letras
// acertadas. Validación normalizada sin acentos.
//
// Controles del jugador:
//   "pista" / "ayuda"    → da la PISTA (categoría), sin revelar letras
//   "paso" / "siguiente" → revela la palabra y salta
// Gana al completar la palabra; pierde al agotar los intentos.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';
import { END_GAME_FRAMES, HELP_CORE_FRAMES, adoptRandom, baseSession, beginGame, clamp, gameOverResult, hasAnyToken, hasToken, isEngineCommand, normalizeForMatch, pickRandom, resetGameSession, turnResult } from './gameUtils';

export interface AhorcadoWord {
    palabra: string;
    pista: string;
}

export const AHORCADO_BANK: readonly AhorcadoWord[] = Object.freeze([
    { palabra: 'agua', pista: 'La bebes cuando tienes sed.' },
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
    ...HELP_CORE_FRAMES,
    'dame una pista',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'siguiente', 'otra palabra', 'no se', 'no sé', 'sigo', 'me rindo',
]);

/**
 * Nombres hablados de las letras (ASR transcribe "eme", no "m"). Sin esto,
 * una respuesta válida por voz no se reconocía como letra.
 */
const LETTER_NAMES: Record<string, string> = Object.freeze({
    a: 'a', be: 'b', ce: 'c', de: 'd', e: 'e', efe: 'f', ge: 'g', hache: 'h',
    i: 'i', jota: 'j', ka: 'k', ele: 'l', eme: 'm', ene: 'n', o: 'o', pe: 'p',
    cu: 'q', erre: 'r', ese: 's', te: 't', u: 'u', uve: 'v', equis: 'x',
    ye: 'y', zeta: 'z',
});

/** Letra dicha por el niño: "letra X", nombre hablado ("eme") o letra suelta ("m"). */
function extractLetter(normalized: string): string | null {
    const tokens = normalized.split(/\s+/).filter(Boolean);
    // Patrón explícito "letra X" (cualquier posición).
    const explicitIndex = tokens.indexOf('letra');
    const explicit = explicitIndex >= 0 ? tokens[explicitIndex + 1] : null;
    if (explicit) {
        if (Object.prototype.hasOwnProperty.call(LETTER_NAMES, explicit)) return LETTER_NAMES[explicit];
        if (/^[a-z]$/.test(explicit)) return explicit;
    }
    // Nombre hablado solo si es la frase ENTERA ("eme", "de"): evita que
    // homógrafas dentro de una oración ("es de color") gasten un intento.
    if (tokens.length === 1 && Object.prototype.hasOwnProperty.call(LETTER_NAMES, tokens[0])) {
        return LETTER_NAMES[tokens[0]];
    }
    // Letra suelta en cualquier posición ("la a").
    for (const token of tokens) {
        if (/^[a-z]$/.test(token)) return token;
    }
    return null;
}

const END_FRAMES: readonly string[] = END_GAME_FRAMES;

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

export function createAhorcadoEngine(options?: { random?: RandomSource }): GameEngine<AhorcadoState> {
    let rng: RandomSource = options?.random ?? Math.random;

    const readIntentos = (cfg: Record<string, unknown> | undefined): number => {
        const intentos = Number(cfg?.intentos) || Number(cfg?.maxIntentos) || DEFAULT_INTENTOS;
        return clamp(intentos, 3, MAX_INTENTOS);
    };

    const buildState = (cfg: Record<string, unknown> | undefined): AhorcadoState => {
        rng = adoptRandom(rng, cfg);
        const word = pickRandom(AHORCADO_BANK, rng);
        return {
            palabra: word.palabra,
            pista: word.pista,
            adivinadas: [],
            intentos: readIntentos(cfg),
            maxIntentos: readIntentos(cfg),
            phase: 'announce',
        };
    };
    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): AhorcadoState =>
        resetGameSession(session, cfg, buildState);

    return {
        id: 'ahorcado',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<AhorcadoState> {
            return baseSession('ahorcado', buildState(optionsConfig));
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            return beginGame(session, optionsConfig, reset, (raw) => {
                const state = raw as AhorcadoState;
                return `¡Vamos a jugar al ahorcado! La palabra tiene ${state.palabra.length} letras: ${displayWord(state)}. Dime una letra.`;
            }, { emotion: 'excited' });
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as AhorcadoState;

            if (state.phase === 'done') {
                return gameOverResult('Ya terminamos el ahorcado. ¿Jugamos otra vez?', session.score);
            }

            const normalized = normalizeForMatch(text);
            const finish = (
                prompt: string,
                valid: boolean,
                emotion: string,
                won: boolean,
            ): GameTurnResult => {
                state.phase = 'done';
                return gameOverResult(prompt, session.score, {
                    won,
                    valid,
                    animation: won ? 'Dance' : 'Idle',
                    emotion,
                });
            };

            // ¿Pide pista? → la PISTA (categoría), nunca revela letras:
            // antes la pista destapaba letras sin coste (se ganaba pidiendo
            // "pista" repetidas veces) y anulaba el juego.
            if (hasAnyToken(normalized, HINT_FRAMES)) {
                return turnResult(`Pista: ${state.pista} ${displayWord(state)} Dime una letra.`, session.score, { emotion: 'thinking' });
            }

            // ¿La palabra completa? (acepta que venga dentro de la frase:
            // "la palabra es agua").
            if (hasToken(normalized, state.palabra)) {
                state.adivinadas = state.palabra.split('');
                session.score += 1;
                return finish(`¡Correcto! La palabra era ${state.palabra}. ¡Eres muy listo!`, true, 'happy', true);
            }

            // ¿Salta?
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                return finish(`La palabra era ${state.palabra}. ¡Jugamos otra y la adivinas!`, false, 'neutral', false);
            }

            // ¿Dice una letra (nombre hablado o letra suelta)?
            const letter = extractLetter(normalized);
            if (!letter) {
                // Palabra completa fallida: una sola palabra de 2+ letras no es
                // letra ni control → es un intento de palabra, consume intento.
                const soloGuess = normalized.split(/\s+/).filter(Boolean);
                if (soloGuess.length === 1 && /^[a-zñ]+$/.test(soloGuess[0]) && soloGuess[0].length >= 2) {
                    state.intentos -= 1;
                    if (state.intentos <= 0) {
                        return finish(`Se acabaron los intentos. La palabra era ${state.palabra}. ¡Otra vez será!`, false, 'encouraging', false);
                    }
                    return turnResult(`"${soloGuess[0]}" no es. Te quedan ${state.intentos} intentos. ${displayWord(state)}`, session.score, { emotion: 'encouraging', error: 'palabra incorrecta' });
                }
            }
            if (letter) {
                if (state.adivinadas.includes(letter)) {
                    return turnResult(`La letra "${letter}" ya la adivinaste. ${displayWord(state)} Dime otra letra.`, session.score);
                }
                if (state.palabra.includes(letter)) {
                    state.adivinadas.push(letter);
                    if (isComplete(state)) {
                        session.score += 1;
                        return finish(`¡Correcto! La palabra era ${state.palabra}. ¡Eres muy listo!`, true, 'happy', true);
                    }
                    return turnResult(`¡La letra "${letter}" está! ${displayWord(state)} Sigue así.`, session.score, { valid: true, animation: 'Jump_in_place', emotion: 'happy' });
                }
                state.intentos -= 1;
                if (state.intentos <= 0) {
                    return finish(`Se acabaron los intentos. La palabra era ${state.palabra}. ¡Otra vez será!`, false, 'encouraging', false);
                }
                return turnResult(`La letra "${letter}" no está. Quedan ${state.intentos} intentos. ${displayWord(state)}`, session.score, { emotion: 'encouraging', error: 'letra incorrecta' });
            }

            // No entendió → repite la consigna.
            return turnResult(`No te escuché bien. Dime una letra o la palabra completa. ${displayWord(state)}`, session.score, { error: 'sin letra reconocida' });
        },

        isGameCommand(text = ''): boolean {
            return isEngineCommand(text, { end: END_FRAMES, hint: HINT_FRAMES, skip: SKIP_FRAMES });
        },
    };
}
export const AHORCADO_COMMAND_FRAMES = Object.freeze({ HINT_FRAMES, SKIP_FRAMES, END_FRAMES })
