// ============================================================
// src/core/games/loteria.ts
// Lotería mexicana multijugador para voz.
// Motor puro sin I/O. Banco local de cartas `{ id, nombre, copla }`.
//
// Reglas REALES (sin invenciones):
//   - La TABLA de cada jugador es un subconjunto ALEATORIO e INDEPENDIENTE
//     del mazo. Se crea al primer turno de cada jugador (se unen hablando).
//   - FLU canta el mazo carta por carta. Cada jugador marca con "la tengo"
//     SOLO si la carta cantada está en SU tabla.
//   - Marcar una carta ajena no penaliza: simplemente no cuenta.
//   - El PRIMERO que llena su tabla y grita "¡Lotería!" gana.
//   - "mis cartas" / "¿qué cartas tengo?" → FLU le dice SU tabla a ese jugador.
//   - "siguiente" / "canta otra" → el cantador avanza sin marcar.
// Multiusuario: el estado vive en `session.players[playerId]` (aislado por
// hablante); el mazo/cursor son compartidos. Config data-driven: tablaSize.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnContext, GameTurnResult } from './types';
import {
    RandomSource,
    clamp,
    normalizeForMatch,
    hasToken,
    hasAnyToken,
    shuffleOrder,
} from './gameUtils';

export interface LoteriaCard {
    id: string;
    nombre: string;
    copla: string;
}

export const LOTERIA_BANK: readonly LoteriaCard[] = Object.freeze([
    { id: 'gallo', nombre: 'El gallo', copla: 'El que le cantó a San Pedro no le volverá a cantar.' },
    { id: 'dama', nombre: 'La dama', copla: 'Una dama distinguida, en su trono se quedó.' },
    { id: 'catrin', nombre: 'El catrín', copla: 'Don Ferruco en la alameda, su bastón quiere lucir.' },
    { id: 'diablito', nombre: 'El diablito', copla: 'Pórtate bien, cuatito, si no te lleva el diablito.' },
    { id: 'muerte', nombre: 'La muerte', copla: 'La muerte calavera, a todos nos espera.' },
    { id: 'pera', nombre: 'La pera', copla: 'La pera, la perita, dulce y amarillita.' },
    { id: 'sandia', nombre: 'La sandía', copla: 'La sandía, colorada, bien heladita.' },
    { id: 'melon', nombre: 'El melón', copla: 'El melón, redondo y muy sabrosón.' },
    { id: 'corazon', nombre: 'El corazón', copla: 'El corazón late, late, y el amor se va.' },
    { id: 'luna', nombre: 'La luna', copla: 'La luna brillante alumbra la noche.' },
    { id: 'sol', nombre: 'El sol', copla: 'El sol sale y todo lo ilumina.' },
    { id: 'estrella', nombre: 'La estrella', copla: 'La estrella que guía mi camino.' },
    { id: 'arbol', nombre: 'El árbol', copla: 'El árbol da sombra y fruto.' },
    { id: 'casa', nombre: 'La casa', copla: 'La casa, mi casita, hogar dulce hogar.' },
    { id: 'pajaro', nombre: 'El pájaro', copla: 'El pájaro que canta y vuela.' },
    { id: 'corona', nombre: 'La corona', copla: 'La corona del rey, para quien la merece.' },
]);

const DEFAULT_TABLA = 3;
const MAX_TABLA = LOTERIA_BANK.length;
const ANONYMOUS_PLAYER = 'anonimo';

const HINT_FRAMES: readonly string[] = Object.freeze([
    'pista', 'ayuda', 'ayudame', 'repite', 'no escuche', 'no escuché',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'no la tengo', 'no me toco', 'no la saco', 'paso', 'siguiente', 'otra carta', 'canta otra', 'sigo',
]);

const CONFIRM_FRAMES: readonly string[] = Object.freeze([
    'la tengo', 'yo la tengo', 'si la tengo', 'tengo esa', 'me toco', 'la saque',
]);

const MY_CARDS_FRAMES: readonly string[] = Object.freeze([
    'mis cartas', 'que cartas tengo', 'cuales son mis cartas', 'mi tabla', 'que tengo',
]);

const END_FRAMES: readonly string[] = Object.freeze([
    'salir del juego', 'terminar el juego', 'dejar de jugar', 'ya no quiero jugar', 'cerrar el juego',
]);

interface LoteriaPlayerState {
    tabla: number[];
    marcadas: boolean[];
}

interface LoteriaState {
    /** Orden del MAZO (cantadas): permutación completa del banco. */
    order: number[];
    cursor: number;
    tablaSize: number;
    /** Estado por jugador (participantId → su tabla). */
    tablas: Record<string, LoteriaPlayerState>;
    winner: string | null;
    phase: 'announce' | 'done';
}

/** Pluraliza de forma simple (es): `1 carta` / `3 cartas`. */
function plural(count: number, singular: string, pluralForm: string): string {
    return count === 1 ? singular : pluralForm;
}

function cardAt(state: LoteriaState): LoteriaCard | null {
    const index = state.order[state.cursor];
    return index === undefined ? null : LOTERIA_BANK[index];
}

function playerTabla(state: LoteriaState, playerId: string, rng: RandomSource): LoteriaPlayerState {
    if (!state.tablas[playerId]) {
        state.tablas[playerId] = {
            tabla: shuffleOrder(rng, LOTERIA_BANK.length).slice(0, state.tablaSize),
            marcadas: new Array(state.tablaSize).fill(false),
        };
    }
    return state.tablas[playerId];
}

function playerNames(player: LoteriaPlayerState): string {
    const names = player.tabla.map((index) => LOTERIA_BANK[index].nombre);
    if (names.length <= 1) return names[0] ?? '';
    if (names.length === 2) return `${names[0]} y ${names[1]}`;
    return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

function playerComplete(player: LoteriaPlayerState): boolean {
    return player.marcadas.every(Boolean);
}

function cantarPrompt(state: LoteriaState, intro = 'Siguiente carta: '): string {
    const card = cardAt(state);
    if (!card) return 'Ya se me acabaron las cartas.';
    return `${intro}${card.copla} Di "la tengo" solo si está en tu tabla.`;
}

export function createLoteriaEngine(options?: { random?: RandomSource }): GameEngine {
    let rng: RandomSource = options?.random ?? Math.random;

    const readConfig = (cfg: Record<string, unknown> | undefined): number => {
        const tablaSize = Number(cfg?.tablaSize) || DEFAULT_TABLA;
        return clamp(tablaSize, 1, MAX_TABLA);
    };

    const buildState = (cfg: Record<string, unknown> | undefined): LoteriaState => {
        if (cfg && typeof cfg.random === 'function') {
            rng = cfg.random as RandomSource;
        }
        return {
            order: shuffleOrder(rng, LOTERIA_BANK.length),
            cursor: 0,
            tablaSize: readConfig(cfg),
            tablas: {},
            winner: null,
            phase: 'announce',
        };
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): LoteriaState => {
        const state = buildState(cfg);
        session.state = state as unknown as Record<string, unknown>;
        session.score = 0;
        session.round = 1;
        return state;
    };

    const advanceFrom = (state: LoteriaState, session: GameSession): GameTurnResult => {
        state.cursor += 1;
        if (!cardAt(state)) {
            state.phase = 'done';
            return {
                prompt: '¡Se acabaron las cartas y nadie gritó lotería! ¿Jugamos otra vez?',
                valid: false,
                gameOver: true,
                won: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'encouraging',
            };
        }
        return {
            prompt: cantarPrompt(state),
            valid: false,
            gameOver: false,
            score: session.score,
            animation: 'Idle',
            emotion: 'neutral',
        };
    };

    return {
        id: 'loteria',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession {
            return {
                id: 'loteria',
                state: buildState(optionsConfig) as unknown as Record<string, unknown>,
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as unknown as LoteriaState;
            const first = cardAt(state);
            return {
                prompt: `¡Vamos a jugar a la lotería en grupo! Voy a cantar las cartas del mazo; cada quien marca su tabla con "la tengo". Di "mis cartas" para ver la tuya. Primera carta: ${first ? first.copla : ''} ¿La tienes?`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'excited',
            };
        },

        turn(session: GameSession, text = '', context?: GameTurnContext): GameTurnResult {
            const state = session.state as unknown as LoteriaState;
            const playerId = context?.playerId || ANONYMOUS_PLAYER;

            if (state.phase === 'done') {
                return {
                    prompt: state.winner
                        ? `¡${state.winner} ya ganó la lotería! ¿Jugamos otra vez?`
                        : 'Ya terminamos la lotería. ¿Jugamos otra vez?',
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'happy',
                };
            }

            const card = cardAt(state);
            if (!card) {
                state.phase = 'done';
                return advanceFrom(state, session);
            }

            const normalized = normalizeForMatch(text);
            const player = playerTabla(state, playerId, rng);

            // ¿Grita "¡Lotería!"?
            if (hasToken(normalized, 'loteria')) {
                if (playerComplete(player)) {
                    state.phase = 'done';
                    state.winner = playerId;
                    return {
                        prompt: `¡LOTERÍA! ¡Ganó ${playerId}! Llenó su tabla de ${player.tabla.length} ${plural(player.tabla.length, 'carta', 'cartas')}. ¡A celebrar!`,
                        valid: true,
                        gameOver: true,
                        won: true,
                        score: session.score,
                        animation: 'Dance',
                        emotion: 'happy',
                    };
                }
                const remaining = player.tabla.length - player.marcadas.filter(Boolean).length;
                return {
                    prompt: `¡Todavía no! Te faltan ${remaining} ${plural(remaining, 'carta', 'cartas')}. ${cantarPrompt(state, '')}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                };
            }

            // ¿Pide ver su tabla?
            if (hasAnyToken(normalized, MY_CARDS_FRAMES)) {
                return {
                    prompt: `Tu tabla tiene ${player.tabla.length} ${plural(player.tabla.length, 'carta', 'cartas')}: ${playerNames(player)}. ${cantarPrompt(state, '')}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'thinking',
                };
            }

            // ¿Pide repetir la copla?
            if (hasAnyToken(normalized, HINT_FRAMES)) {
                return {
                    prompt: `La carta es: ${card.nombre}. ${card.copla} ¿La tienes?`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'thinking',
                };
            }

            // ¿No la tiene / canta otra? (antes que "la tengo": "no la tengo" la contiene)
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                session.round += 1;
                return advanceFrom(state, session);
            }

            // ¿Marca la carta con "la tengo"?
            if (hasAnyToken(normalized, CONFIRM_FRAMES)) {
                const cardIdx = state.order[state.cursor];
                const slot = player.tabla.indexOf(cardIdx);
                if (slot !== -1 && !player.marcadas[slot]) {
                    player.marcadas[slot] = true;
                    session.score += 1;
                    session.round += 1;
                    if (playerComplete(player)) {
                        return {
                            prompt: '¡Llenaste tu tabla! Grita "¡Lotería!" para ganar.',
                            valid: true,
                            gameOver: false,
                            score: session.score,
                            animation: 'Jump_in_place',
                            emotion: 'happy',
                        };
                    }
                    state.cursor += 1;
                    if (!cardAt(state)) {
                        state.phase = 'done';
                        return advanceFrom(state, session);
                    }
                    return {
                        prompt: `¡${card.nombre}, sí la tienes! ${cantarPrompt(state)}`,
                        valid: true,
                        gameOver: false,
                        score: session.score,
                        animation: 'Jump_in_place',
                        emotion: 'happy',
                    };
                }
                // La carta NO está en su tabla: no marca, no penaliza.
                session.round += 1;
                return advanceFrom(state, session);
            }

            // No entendió → reintenta la misma carta.
            return {
                prompt: `¡Casi! Escúchame otra vez. ${cantarPrompt(state, '')}`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'encouraging',
                error: 'respuesta no reconocida',
            };
        },

        isGameCommand(text = ''): boolean {
            const normalized = normalizeForMatch(text);
            return END_FRAMES.some((frame) => normalized.includes(frame))
                || HINT_FRAMES.some((frame) => hasToken(normalized, frame))
                || SKIP_FRAMES.some((frame) => hasToken(normalized, frame))
                || MY_CARDS_FRAMES.some((frame) => hasToken(normalized, frame))
                || hasToken(normalized, 'loteria')
                || CONFIRM_FRAMES.some((frame) => hasToken(normalized, frame));
        },
    };
}
