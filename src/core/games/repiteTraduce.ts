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
import type { GameEngine } from './gameEngine.ts';
import type { GameSession, GameTurnResult } from './types.ts';
import { END_GAME_FRAMES, HELP_CORE_FRAMES, SKIP_CORE_FRAMES, adoptRandom, bankItemAt, baseSession, beginGame, buildShuffledState, gameOverResult, gamePrompt, hasAnyToken, hasToken, isEngineCommand, isLastRound, normalizeForMatch, openTurn, resetGameSession, skipNextPrompt, skipTurn, turnResult } from './gameUtils.ts';

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

const itemAt = (state: RepiteTraduceState) => bankItemAt(state, REPITE_BANK);

const currentPrompt = (state: RepiteTraduceState) =>
    gamePrompt(
        state,
        itemAt,
        (item) => `¿Cómo se dice "${item.es}" en inglés?`,
        'Ya se me acabaron las palabras.',
    );

export function createRepiteTraduceEngine(options?: { random?: RandomSource }): GameEngine<RepiteTraduceState> {
    let rng: RandomSource = options?.random ?? Math.random;
    const buildState = (cfg: Record<string, unknown> | undefined): RepiteTraduceState =>
        buildShuffledState({
            cfg,
            bankLength: REPITE_BANK.length,
            defaultRounds: DEFAULT_ROUNDS,
            maxRounds: MAX_ROUNDS,
            adopt: (cfg2) => {
                rng = adoptRandom(rng, cfg2);
                return rng;
            },
            build: ({ order, maxRounds }) => ({ order, cursor: 0, maxRounds, phase: 'announce' }),
        });

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): RepiteTraduceState =>
        resetGameSession(session, cfg, buildState);

    return {
        id: 'repite_traduce',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<RepiteTraduceState> {
            return baseSession('repite_traduce', buildState(optionsConfig));
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            return beginGame(session, optionsConfig, reset, (raw) => {
                const state = raw as RepiteTraduceState;
                return `¡Vamos a practicar inglés! ${currentPrompt(state)}`;
            }, { emotion: 'excited' });
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as RepiteTraduceState;

            const gate = openTurn(session, state, () => itemAt(state), {
                done: 'Ya terminamos de practicar inglés. ¿Jugamos otra vez?',
                exhausted: `¡Se acabaron las palabras! Tu puntaje fue ${session.score}. ¡Muy bien!`,
            });
            if (!gate.ok) return gate.result;
            const item = gate.item;

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
                return skipTurn(session, state, (nextState) => skipNextPrompt(currentPrompt(nextState)));
            }

            return turnResult(`¡Casi! "${item.es}" en inglés se dice "${item.en}". Inténtalo otra vez.`, session.score, { emotion: 'encouraging', error: 'traducción incorrecta' });
        },

        isGameCommand(text = ''): boolean {
            return isEngineCommand(text, { end: END_FRAMES, hint: HINT_FRAMES, skip: SKIP_FRAMES });
        },
    };
}
export const REPITE_TRADUCE_COMMAND_FRAMES = Object.freeze({ HINT_FRAMES, SKIP_FRAMES, END_FRAMES })
