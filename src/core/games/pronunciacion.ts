// ============================================================
// pronunciacion.ts - Practica de PRONUNCIACION (P8.65).
// Motor puro sin I/O, hermano de `repiteTraduce`.
//
// FLU ENUNCIA una palabra (normalmente en ingles) y el alumno la REPITE. El
// motor acredita la repeticion comparando lo que TRANSCRIBIO el ASR con la
// palabra objetivo. La comparacion es DETERMINISTA y TOLERANTE: el ASR no es
// exacto, asi que se acepta un token con distancia de edicion <= 1. Repetir la
// misma palabra que el motor acaba de decir ES la tarea (a diferencia de
// `repiteTraduce`, aqui NO se pregunta "como se dice", se pide IMITAR).
//
// El BANCO es configurable (P8.67): vive en core/config/pronunciacionBank y se
// elige por nivel con `options.nivel` (basico/intermedio/avanzado; sin nivel =
// banco completo).
//
// Controles:
//   "pista" / "ayuda"      -> como suena la palabra
//   "otra" / "siguiente"   -> salta a la siguiente
// Fin al completar `rounds` palabras.
// ============================================================
import type { GameEngine } from './gameEngine.ts';
import type { GameSession, GameTurnResult } from './types.ts';
import { END_GAME_FRAMES, HELP_CORE_FRAMES, SKIP_CORE_FRAMES, adoptRandom, bankItemAt, baseSession, beginGame, gameOverResult, gamePrompt, hasAnyToken, hasToken, isEngineCommand, isLastRound, normalizeForMatch, openTurn, readRounds, resetGameSession, shuffleOrder, skipTurn, turnResult } from './gameUtils.ts';
import {
    PRONUNCIACION_BANK,
    pronunciacionWordsByLevel,
    type PronunciacionWord,
} from '../config/pronunciacionBank.ts';

// Reexportado para no romper la superficie publica del motor.
export { PRONUNCIACION_BANK };
export type { PronunciacionWord };

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = PRONUNCIACION_BANK.length;

const HINT_FRAMES: readonly string[] = Object.freeze([
    ...HELP_CORE_FRAMES,
    'repite', 'como suena', 'no se', 'no sé',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([...SKIP_CORE_FRAMES]);

const END_FRAMES: readonly string[] = END_GAME_FRAMES;

type RandomSource = () => number;

interface PronunciacionState {
    order: number[];
    cursor: number;
    maxRounds: number;
    phase: 'announce' | 'done';
    /** Banco EFECTIVO de la partida (filtrado por nivel). */
    bank: PronunciacionWord[];
}

const itemAt = (state: PronunciacionState) => bankItemAt(state, state.bank);

const currentPrompt = (state: PronunciacionState) =>
    gamePrompt(
        state,
        itemAt,
        (item) => `Repite despues de mi: "${item.word}".`,
        'Ya se me acabaron las palabras.',
    );

/** Distancia de edicion (Levenshtein) entre dos cadenas. */
function editDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i += 1) {
        const cur = [i];
        for (let j = 1; j <= n; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        }
        prev = cur;
    }
    return prev[n];
}

/**
 * ¿Lo que TRANSCRIBIO el ASR imita la palabra objetivo? Exacto por token o con
 * distancia de edicion <= 1 en algun token (el ASR no es exacto). Determinista.
 */
function imitaLaPalabra(normalized: string, word: string): boolean {
    if (hasToken(normalized, word)) return true;
    const target = word.toLowerCase();
    return normalized
        .split(/\s+/)
        .filter(Boolean)
        .some((token) => editDistance(token, target) <= 1);
}

export function createPronunciacionEngine(options?: { random?: RandomSource }): GameEngine<PronunciacionState> {
    let rng: RandomSource = options?.random ?? Math.random;
    const buildState = (cfg: Record<string, unknown> | undefined): PronunciacionState => {
        rng = adoptRandom(rng, cfg);
        const bank = pronunciacionWordsByLevel(cfg?.nivel as string | undefined);
        return {
            bank,
            order: shuffleOrder(rng, bank.length),
            cursor: 0,
            maxRounds: readRounds(cfg, DEFAULT_ROUNDS, Math.min(MAX_ROUNDS, bank.length)),
            phase: 'announce',
        };
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): PronunciacionState =>
        resetGameSession(session, cfg, buildState);

    return {
        id: 'pronunciacion',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<PronunciacionState> {
            return baseSession('pronunciacion', buildState(optionsConfig));
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            return beginGame(session, optionsConfig, reset, (raw) => {
                const state = raw as PronunciacionState;
                return `¡Vamos a practicar pronunciacion! ${currentPrompt(state)}`;
            }, { emotion: 'excited' });
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as PronunciacionState;

            const gate = openTurn(session, state, () => itemAt(state), {
                done: 'Ya terminamos de practicar. ¿Jugamos otra vez?',
                exhausted: `¡Se acabaron las palabras! Tu puntaje fue ${session.score}. ¡Muy bien!`,
            });
            if (!gate.ok) return gate.result;
            const item = gate.item;

            const normalized = normalizeForMatch(text);

            if (hasAnyToken(normalized, HINT_FRAMES)) {
                return turnResult(`"${item.word}". ${item.pista} Ahora repitelo.`, session.score, { emotion: 'thinking' });
            }

            if (imitaLaPalabra(normalized, item.word)) {
                session.score += 1;
                session.round += 1;
                if (isLastRound(state)) {
                    state.phase = 'done';
                    return gameOverResult(
                        `¡Excelente pronunciacion! Dijiste "${item.word}" muy bien. Completaste ${state.maxRounds} palabras con ${session.score} puntos.`,
                        session.score,
                        { valid: true, won: true, animation: 'Dance' },
                    );
                }
                state.cursor += 1;
                return turnResult(`¡Muy bien! Siguiente: ${currentPrompt(state)}`, session.score, { valid: true, animation: 'Jump_in_place', emotion: 'happy' });
            }

            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                return skipTurn(session, state, (nextState) => `¡Claro! Aqui va otra: ${currentPrompt(nextState)}`);
            }

            return turnResult(`¡Casi! Escucha: "${item.word}". ${item.pista} Intentalo otra vez.`, session.score, { emotion: 'encouraging', error: 'pronunciacion por mejorar' });
        },

        isGameCommand(text = ''): boolean {
            return isEngineCommand(text, { end: END_FRAMES, hint: HINT_FRAMES, skip: SKIP_FRAMES });
        },
    };
}

export const PRONUNCIACION_COMMAND_FRAMES = Object.freeze({ HINT_FRAMES, SKIP_FRAMES, END_FRAMES });
