// ============================================================
// src/core/games/repiteTraduce.ts
// Repite y traduce (plan-juegos §Fase 3, Riesgo 3).
// Motor puro sin I/O, ideal para el modo bilingüe.
//
// FLU dice una palabra en español y pide su traducción al inglés.
// Acredita SOLO la traducción (`item.en`): repetir la palabra en
// español NO puntúa, porque el prompt ya la enunció. Keyword sin acentos.
//
// Controles:
//   "pista" / "ayuda"      → da la traducción
//   "paso" / "siguiente"   → salta a la siguiente palabra
// Fin al completar `rounds` palabras.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';
import { finishRoundsIfLast, isGameCommandSurface, isLastRound, END_GAME_FRAMES, HELP_CORE_FRAMES, SKIP_CORE_FRAMES, adoptRandom, gameOverResult, hasAnyToken, hasToken, normalizeForMatch, readRounds, shuffleOrder, turnResult } from './gameUtils';

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
    ...HELP_CORE_FRAMES,
    'repite', 'no se', 'no sé',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([...SKIP_CORE_FRAMES]);

const END_FRAMES: readonly string[] = END_GAME_FRAMES;

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
    const buildState = (cfg: Record<string, unknown> | undefined): RepiteTraduceState => {
        rng = adoptRandom(rng, cfg);
        return {
            order: shuffleOrder(rng, REPITE_BANK.length),
            cursor: 0,
            maxRounds: readRounds(cfg, DEFAULT_ROUNDS, MAX_ROUNDS),
            phase: 'announce',
        };
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): RepiteTraduceState => {
        const state: RepiteTraduceState = buildState(cfg);
        session.state = state;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'repite_traduce',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<RepiteTraduceState> {
            return {
                id: 'repite_traduce',
                state: buildState(optionsConfig),
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as RepiteTraduceState;
            return turnResult(`¡Vamos a practicar inglés! ${currentPrompt(state)}`, session.score, { emotion: 'excited' });
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as RepiteTraduceState;

            if (state.phase === 'done') {
                return gameOverResult('Ya terminamos de practicar inglés. ¿Jugamos otra vez?', session.score);
            }

            const item = itemAt(state);
            if (!item) {
                state.phase = 'done';
                return gameOverResult(
                        `¡Se acabaron las palabras! Tu puntaje fue ${session.score}. ¡Muy bien!`,
                        session.score,
                        { animation: 'Dance' },
                    );
            }

            const normalized = normalizeForMatch(text);

            // ¿Pide pista?
            if (hasAnyToken(normalized, HINT_FRAMES)) {
                return turnResult(`"${item.es}" en inglés se dice "${item.en}". ${item.pista} Ahora repítelo.`, session.score, { emotion: 'thinking' });
            }

            // Acierto SOLO con la traducción al inglés: el prompt pregunta
            // "¿cómo se dice X en inglés?"; aceptar `item.es` permitía ganar
            // repitiendo la palabra que FLU acababa de decir.
            const acierto = hasToken(normalized, item.en);
            if (acierto) {
                session.score += 1;
                session.round += 1;
                if (isLastRound(state)) {
                    state.phase = 'done';
                    return gameOverResult(
                            `¡Muy bien! "${item.es}" es "${item.en}" en inglés. Completaste ${state.maxRounds} palabras con ${session.score} puntos. ¡Eres muy listo!`,
                            session.score,
                            { valid: true, won: true, animation: 'Dance' },
                        );
                }
                state.cursor += 1;
                return turnResult(`¡Muy bien! "${item.es}" es "${item.en}". Siguiente: ${currentPrompt(state)}`, session.score, { valid: true, animation: 'Jump_in_place', emotion: 'happy' });
            }

            // ¿Salta?
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                session.round += 1;
                const finRonda = finishRoundsIfLast(session, state);
                if (finRonda) return finRonda;
                state.cursor += 1;
                return turnResult(`¡Claro! Aquí va otra: ${currentPrompt(state)}`, session.score);
            }

            return turnResult(`¡Casi! "${item.es}" en inglés se dice "${item.en}". Inténtalo otra vez.`, session.score, { emotion: 'encouraging', error: 'traducción incorrecta' });
        },

        isGameCommand(text = ''): boolean {
            const normalized = normalizeForMatch(text);
            return isGameCommandSurface(normalized, { end: END_FRAMES, hint: HINT_FRAMES, skip: SKIP_FRAMES });
        },
    };
}
// Superficie de comandos PUBLICADA como dato, con nombre CALIFICADO por motor:
// los simbolos exportados deben ser unicos (un `HINT_FRAMES` por modulo choca).
export const REPITE_TRADUCE_COMMAND_FRAMES = Object.freeze({ HINT_FRAMES, SKIP_FRAMES, END_FRAMES })
