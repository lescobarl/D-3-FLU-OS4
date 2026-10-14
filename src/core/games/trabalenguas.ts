// ============================================================
// src/core/games/trabalenguas.ts
// Trabalenguas (plan-juegos §Fase 3, Riesgo 3). Motor puro sin I/O.
//
// Banco local de trabalenguas con palabras clave (`claves`) que el
// jugador debe repetir. Validación por keywords normalizadas: se
// considera acierto si todas las claves aparecen en la respuesta.
//
// Controles:
//   "pista" / "ayuda"      → repite despacio con la pista
//   "paso" / "siguiente"   → salta al siguiente trabalenguas
// Fin al completar `rounds` trabalenguas.
// ============================================================
import type { GameEngine } from './gameEngine.ts';
import type { GameSession, GameTurnResult } from './types.ts';
import { END_GAME_FRAMES, HELP_CORE_FRAMES, adoptRandom, advanceRound, bankItemAt, baseSession, beginGame, buildShuffledState, gameOverResult, gamePrompt, hasAnyToken, hasToken, isEngineCommand, isLastRound, normalizeForMatch, resetGameSession, turnResult } from './gameUtils.ts';

export interface TrabalenguasItem {
    texto: string;
    claves: string[];        // palabras clave que deben aparecer
    pista: string;
}

export const TRABALENGUAS_BANK: readonly TrabalenguasItem[] = Object.freeze([
    { texto: 'Tres tristes tigres tragaban trigo en un trigal.', claves: ['tigres', 'tragaban', 'trigo'], pista: 'Unos animales rayados que comían trigo.' },
    { texto: 'Pepe pica papas con un pico, papas pica Pepe.', claves: ['pepe', 'pica', 'papas'], pista: 'Un niño llamado Pepe picando unas papas.' },
    { texto: 'El cielo está enladrillado, ¿quién lo desenladrillará?', claves: ['cielo', 'enladrillado'], pista: 'Está lleno de ladrillos azules.' },
    { texto: 'Pancha plancha con mucha plancha y con mucha prisa.', claves: ['pancha', 'plancha'], pista: 'Una niña que plancha la ropa.' },
    { texto: 'Compadre, cómpreme un coco, compadre, cómpreme dos.', claves: ['compadre', 'coco'], pista: 'Una fruta dura y marrón con agua dentro.' },
    { texto: 'Pablito clavó un clavito en la calva de un calvito.', claves: ['pablito', 'clavito'], pista: 'Un niño con un clavo muy pequeño.' },
    { texto: 'La bruja piruja prepara un brebaje para el viaje.', claves: ['bruja', 'brebaje'], pista: 'Una señora mágica cocinando una poción.' },
    { texto: 'Erre con erre cigarro, erre con erre barril.', claves: ['cigarro', 'barril'], pista: 'Dos cosas que suenan mucho con la erre.' },
]);

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = TRABALENGUAS_BANK.length;

const HINT_FRAMES: readonly string[] = Object.freeze([
    ...HELP_CORE_FRAMES,
    'repite', 'no escuche', 'no escuché', 'despacio',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'siguiente', 'otro', 'sigo', 'no se', 'no sé',
]);

const END_FRAMES: readonly string[] = END_GAME_FRAMES;

type RandomSource = () => number;

interface TrabalenguasState {
    order: number[];
    cursor: number;
    maxRounds: number;
    phase: 'announce' | 'done';
}

const itemAt = (state: TrabalenguasState) => bankItemAt(state, TRABALENGUAS_BANK);

const currentPrompt = (state: TrabalenguasState) =>
    gamePrompt(state, itemAt, (item) => `${item.texto} Repítelo después de mí.`, 'Ya se me acabaron los trabalenguas.');

export function createTrabalenguasEngine(options?: { random?: RandomSource }): GameEngine<TrabalenguasState> {
    let rng: RandomSource = options?.random ?? Math.random;
    const buildState = (cfg: Record<string, unknown> | undefined): TrabalenguasState =>
        buildShuffledState({
            cfg,
            bankLength: TRABALENGUAS_BANK.length,
            defaultRounds: DEFAULT_ROUNDS,
            maxRounds: MAX_ROUNDS,
            adopt: (cfg2) => {
                rng = adoptRandom(rng, cfg2);
                return rng;
            },
            build: ({ order, maxRounds }) => ({ order, cursor: 0, maxRounds, phase: 'announce' }),
        });

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): TrabalenguasState =>
        resetGameSession(session, cfg, buildState);

    return {
        id: 'trabalenguas',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<TrabalenguasState> {
            return baseSession('trabalenguas', buildState(optionsConfig));
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            return beginGame(session, optionsConfig, reset, (raw) => {
                const state = raw as TrabalenguasState;
                return `¡Vamos a jugar con trabalenguas! ${currentPrompt(state)}`;
            }, { emotion: 'excited' });
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as TrabalenguasState;

            if (state.phase === 'done') {
                return gameOverResult('Ya terminamos los trabalenguas. ¿Jugamos otra vez?', session.score);
            }

            const item = itemAt(state);
            if (!item) {
                state.phase = 'done';
                return gameOverResult(
                        `¡Se acabaron los trabalenguas! Tu puntaje fue ${session.score}. ¡Muy bien!`,
                        session.score,
                        { animation: 'Dance' },
                    );
            }

            const normalized = normalizeForMatch(text);

            // ¿Pide pista?
            if (hasAnyToken(normalized, HINT_FRAMES)) {
                return turnResult(`Vamos despacio: ${item.texto} Recuerda: ${item.pista}`, session.score, { emotion: 'thinking' });
            }

            // ¿Lo repite correctamente? (todas las claves presentes)
            const acierto = item.claves.every((clave) => hasToken(normalized, clave));
            if (acierto) {
                session.score += 1;
                session.round += 1;
                if (isLastRound(state)) {
                    state.phase = 'done';
                    return gameOverResult(
                            `¡Lengua rápida! Completaste ${state.maxRounds} trabalenguas con ${session.score} puntos. ¡Eres muy listo!`,
                            session.score,
                            { valid: true, won: true, animation: 'Dance' },
                        );
                }
                state.cursor += 1;
                const next = itemAt(state);
                return turnResult(`¡Muy bien! Siguiente: ${next ? currentPrompt(state) : ''}`, session.score, { valid: true, animation: 'Jump_in_place', emotion: 'happy' });
            }

            // ¿Salta?
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                const finRonda = advanceRound(session, state);
                if (finRonda) return finRonda;
                state.cursor += 1;
                return turnResult(`¡Claro! Aquí va otro: ${currentPrompt(state)}`, session.score);
            }

            // Reintenta el mismo trabalenguas.
            return turnResult(`¡Casi! Inténtalo otra vez: ${item.texto}`, session.score, { emotion: 'encouraging', error: 'repite no válido' });
        },

        isGameCommand(text = ''): boolean {
            return isEngineCommand(text, { end: END_FRAMES, hint: HINT_FRAMES, skip: SKIP_FRAMES });
        },
    };
}
export const TRABALENGUAS_COMMAND_FRAMES = Object.freeze({ HINT_FRAMES, SKIP_FRAMES, END_FRAMES })
