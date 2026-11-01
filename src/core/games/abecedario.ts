// ============================================================
// src/core/games/abecedario.ts
// Abecedario (plan-juegos §Fase 3, Riesgo 3).
// Motor puro sin I/O.
//
// FLU propone una letra y el niño dice una palabra que empiece
// con esa letra. Se acepta CUALQUIER palabra que empiece con la
// letra (validación por primera letra de los tokens) o la palabra
// del banco (validación por keyword).
//
// Controles:
//   "pista" / "ayuda"  → revela una palabra del banco
//   "paso" / "siguiente" → pasa a la siguiente letra
// Fin al completar `rounds` letras.
// ============================================================
import type { GameEngine } from './gameEngine.ts';
import type { GameSession, GameTurnResult } from './types.ts';
import { END_GAME_FRAMES, HELP_CORE_FRAMES, STOPWORDS_ES, adoptRandom, bankItemAt, baseSession, beginGame, buildShuffledState, gameOverResult, hasAnyToken, isEngineCommand, isLastRound, normalizeForMatch, resetGameSession, skipTurn, stripDiacritics, turnResult } from './gameUtils.ts';

export interface AbecedarioItem {
    letra: string;
    palabra: string;
    pista: string;
}

export const ABECEDARIO_BANK: readonly AbecedarioItem[] = Object.freeze([
    { letra: 'a', palabra: 'avión', pista: 'Vuela por el cielo.' },
    { letra: 'b', palabra: 'ballena', pista: 'El animal más grande del mar.' },
    { letra: 'c', palabra: 'casa', pista: 'Donde vives todos los días.' },
    { letra: 'd', palabra: 'delfín', pista: 'Un animal que nada y salta en el mar.' },
    { letra: 'e', palabra: 'elefante', pista: 'Un animal enorme con trompa.' },
    { letra: 'f', palabra: 'fresa', pista: 'Una fruta roja y dulce.' },
    { letra: 'g', palabra: 'gato', pista: 'Un felino que dice miau.' },
    { letra: 'h', palabra: 'hipopótamo', pista: 'Un animal enorme que vive en el río.' },
    { letra: 'i', palabra: 'isla', pista: 'Un pedazo de tierra rodeado de agua.' },
    { letra: 'j', palabra: 'jirafa', pista: 'Un animal muy alto con el cuello largo.' },
    { letra: 'k', palabra: 'koala', pista: 'Vive en los árboles y come hojas.' },
    { letra: 'l', palabra: 'luna', pista: 'Brilla en el cielo de noche.' },
    { letra: 'm', palabra: 'mariposa', pista: 'Vuela y tiene alas de colores.' },
    { letra: 'n', palabra: 'nube', pista: 'Está en el cielo y trae la lluvia.' },
    { letra: 'ñ', palabra: 'ñandú', pista: 'Un ave grande que no vuela y corre rapidísimo.' },
    { letra: 'o', palabra: 'oso', pista: 'Un animal peludo que come miel.' },
    { letra: 'p', palabra: 'pelota', pista: 'La usas para jugar y rebota.' },
    { letra: 'q', palabra: 'queso', pista: 'Es de leche y se pone en el sándwich.' },
    { letra: 'r', palabra: 'ratón', pista: 'Un animal pequeñito con la cola larga.' },
    { letra: 's', palabra: 'sol', pista: 'Brilla y da calor de día.' },
    { letra: 't', palabra: 'tortuga', pista: 'Es lenta y lleva caparazón.' },
    { letra: 'u', palabra: 'uva', pista: 'Una fruta pequeña y redonda que viene en racimo.' },
    { letra: 'v', palabra: 'vaca', pista: 'Un animal que nos da la leche.' },
    { letra: 'w', palabra: 'waffle', pista: 'Un pan dulce con cuadritos.' },
    { letra: 'x', palabra: 'xilófono', pista: 'Un instrumento que se toca con baquetas.' },
    { letra: 'y', palabra: 'yogur', pista: 'Un postre de leche, frío y cremoso.' },
    { letra: 'z', palabra: 'zapato', pista: 'Te lo pones en el pie.' },
]);

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = ABECEDARIO_BANK.length;

const HINT_FRAMES: readonly string[] = Object.freeze([
    ...HELP_CORE_FRAMES,
    'no se', 'no sé', 'dame otra',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'siguiente', 'otra', 'sigo', 'adelante',
]);

const END_FRAMES: readonly string[] = END_GAME_FRAMES;

type RandomSource = () => number;

interface AbecedarioState {
    order: number[];
    cursor: number;
    maxRounds: number;
    phase: 'announce' | 'done';
}

const itemAt = (state: AbecedarioState) => bankItemAt(state, ABECEDARIO_BANK);

/**
 * STOPWORDS_ES vive en `gameUtils` (fuente unica): es el mismo criterio de
 * "palabra real" que aplican abecedario y palabras encadenadas.
 */

/** Palabra REAL dicha por el niño que empieza con la letra objetivo, o null. */
function matchedWord(texto: string, normalized: string, item: AbecedarioItem): string | null {
    const target = item.letra.toLowerCase();
    // La "ñ" NO sobrevive al plegado de diacriticos (se vuelve "n"), asi que esa
    // ronda se compara contra el texto CRUDO: si no, era imposible de acertar.
    const fuente = target === 'ñ' ? texto.toLowerCase() : normalized;
    for (const token of fuente.split(/\s+/)) {
        const limpio = token.replace(/[^a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00fc\u00f1]/g, '');
        if (limpio.length >= 2 && limpio.startsWith(target) && !STOPWORDS_ES.has(limpio)) {
            return limpio;
        }
    }
    // La palabra del banco siempre cuenta (contrato del motor), lo que ademas
    // cubre que el ASR entregue la "ñ" ya plegada ("nandu").
    if (hasAnyToken(normalized, [stripDiacritics(item.palabra).toLowerCase()])) return item.palabra;
    return null;
}

export function createAbecedarioEngine(options?: { random?: RandomSource }): GameEngine<AbecedarioState> {
    let rng: RandomSource = options?.random ?? Math.random;
    const buildState = (cfg: Record<string, unknown> | undefined): AbecedarioState =>
        buildShuffledState({
            cfg,
            bankLength: ABECEDARIO_BANK.length,
            defaultRounds: DEFAULT_ROUNDS,
            maxRounds: MAX_ROUNDS,
            adopt: (cfg2) => {
                rng = adoptRandom(rng, cfg2);
                return rng;
            },
            build: ({ order, maxRounds }) => ({ order, cursor: 0, maxRounds, phase: 'announce' }),
        });
    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): AbecedarioState =>
        resetGameSession(session, cfg, buildState);

    return {
        id: 'abecedario',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<AbecedarioState> {
            return baseSession('abecedario', buildState(optionsConfig));
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            return beginGame(session, optionsConfig, reset, (raw) => {
                const state = raw as AbecedarioState;
                const item = itemAt(state);
                return `¡Vamos a jugar con el abecedario! Dime una palabra que empiece con la letra "${item ? item.letra : ''}".`;
            }, { emotion: 'excited' });
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as AbecedarioState;

            if (state.phase === 'done') {
                return gameOverResult('Ya terminamos con las letras. ¿Jugamos otra vez?', session.score);
            }

            const item = itemAt(state);
            if (!item) {
                state.phase = 'done';
                return gameOverResult(
                        `¡Se acabaron las letras! Tu puntaje fue ${session.score}. ¡Muy bien!`,
                        session.score,
                        { animation: 'Dance' },
                    );
            }

            const normalized = normalizeForMatch(text);

            // ¿Pide pista?
            if (hasAnyToken(normalized, HINT_FRAMES)) {
                return turnResult(`La palabra "${item.palabra}" empieza con la "${item.letra}". ${item.pista} Ahora dime otra que empiece con la "${item.letra}".`, session.score, { emotion: 'thinking' });
            }

            // ¿Acierta? Una palabra REAL del niño con la letra inicial.
            const word = matchedWord(text, normalized, item);
            if (word) {
                session.score += 1;
                session.round += 1;
                if (isLastRound(state)) {
                    state.phase = 'done';
                    return gameOverResult(
                            `¡Muy bien! "${word}" empieza con la "${item.letra}". Completaste ${state.maxRounds} letras con ${session.score} puntos. ¡Conoces el abecedario!`,
                            session.score,
                            { valid: true, won: true, animation: 'Dance' },
                        );
                }
                state.cursor += 1;
                const next = itemAt(state);
                return turnResult(`¡Muy bien! "${word}" empieza con la "${item.letra}". Ahora dime una palabra que empiece con la letra "${next ? next.letra : ''}".`, session.score, { valid: true, animation: 'Jump_in_place', emotion: 'happy' });
            }

            // ¿Salta?
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                return skipTurn(session, state, (nextState) => {
                    const next = itemAt(nextState);
                    return `¡Claro! Ahora dime una palabra que empiece con la letra "${next ? next.letra : ''}".`;
                });
            }

            // No acierta → reintenta la misma letra.
            return turnResult(`Casi... Dime una palabra que empiece con la letra "${item.letra}".`, session.score, { emotion: 'encouraging', error: 'palabra incorrecta' });
        },

        isGameCommand(text = ''): boolean {
            return isEngineCommand(text, { end: END_FRAMES, hint: HINT_FRAMES, skip: SKIP_FRAMES });
        },
    };
}
export const ABECEDARIO_COMMAND_FRAMES = Object.freeze({ HINT_FRAMES, SKIP_FRAMES, END_FRAMES })
