// ============================================================
// src/core/games/loteria.ts
// Lotería mexicana por VOZ — FLU es solo el CANTADOR.
// Motor puro sin I/O. Banco local de cartas `{ id, nombre, copla }`.
//
// Reglas REALES:
//   - Los CARTONES los tienen los jugadores; FLU no los conoce ni los crea.
//   - FLU canta el mazo carta por carta (copla).
//   - "ok flu repite" → repite la carta actual.
//   - "siguiente" / "otra" / "canta otra" → canta la siguiente.
//   - "ok flu lotería" → ALGUIEN ganó: FLU lo declara y termina la partida.
//   - No hay "la tengo"/"no la tengo", ni tablas internas, ni puntaje, ni
//     marcaje: nadie marca en voz alta, cada quien marca su cartón en silencio.
// Multijugador POR NATURALEZA: no importa QUIÉN hable; cualquier grito de
// "lotería" gana. No se necesita estado por jugador.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnContext, GameTurnResult } from './types';
import { RandomSource, normalizeForMatch, hasToken, hasAnyToken, shuffleOrder } from './gameUtils';

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

const REPEAT_FRAMES: readonly string[] = Object.freeze([
    'repite', 'repetir', 'pista', 'ayuda', 'ayudame', 'no escuche', 'no escuché', 'otra vez',
]);

const NEXT_FRAMES: readonly string[] = Object.freeze([
    'siguiente', 'otra', 'canta otra', 'siguiente carta', 'paso', 'sigo', 'otra carta', 'dale',
    // Afirmaciones: en la lotería el jugador no "responde"; un "sí"/"continúa"
    // significa "canta la siguiente" (antes repetía la misma carta en ciclo).
    'si', 'sí', 'continua', 'continúa', 'continuar', 'sigue', 'ok', 'okey', 'vale', 'adelante',
    'yes', 'next', 'listo', 'vamos',
]);

const END_FRAMES: readonly string[] = Object.freeze([
    'salir del juego', 'terminar el juego', 'dejar de jugar', 'ya no quiero jugar', 'cerrar el juego',
    'salir', 'terminar', 'termina', 'basta', 'parar', 'stop', 'ya no quiero', 'no quiero jugar',
    'fin del juego', 'se acabo', 'se acabó',
]);

interface LoteriaState {
    /** Orden del MAZO (cantadas): permutación completa del banco. */
    order: number[];
    cursor: number;
    /** Participante que gritó lotería (si lo hay). */
    winner: string | null;
    phase: 'announce' | 'done';
}

function cardAt(state: LoteriaState): LoteriaCard | null {
    const index = state.order[state.cursor];
    return index === undefined ? null : LOTERIA_BANK[index];
}

function cantarPrompt(state: LoteriaState, intro = 'Siguiente carta: '): string {
    const card = cardAt(state);
    if (!card) return 'Ya se me acabaron las cartas.';
    return `${intro}${card.copla}`;
}

export function createLoteriaEngine(options?: { random?: RandomSource }): GameEngine {
    let rng: RandomSource = options?.random ?? Math.random;

    const buildState = (cfg: Record<string, unknown> | undefined): LoteriaState => {
        if (cfg && typeof cfg.random === 'function') {
            rng = cfg.random as RandomSource;
        }
        return {
            order: shuffleOrder(rng, LOTERIA_BANK.length),
            cursor: 0,
            winner: null,
            phase: 'announce',
        };
    };

    const advanceFrom = (state: LoteriaState, session: GameSession): GameTurnResult => {
        state.cursor += 1;
        if (!cardAt(state)) {
            state.phase = 'done';
            return {
                prompt: '¡Se acabaron las cartas! ¿Jugamos otra vez?',
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
            const state = buildState(optionsConfig);
            session.state = state as unknown as Record<string, unknown>;
            session.score = 0;
            session.round = 1;
            const first = cardAt(state);
            return {
                prompt: `¡Vamos a jugar a la lotería! Yo canto las cartas y cada quien marca su cartón. Primera carta: ${first ? first.copla : ''}`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'excited',
            };
        },

        turn(session: GameSession, text = '', context?: GameTurnContext): GameTurnResult {
            const state = session.state as unknown as LoteriaState;

            if (state.phase === 'done') {
                return {
                    prompt: state.winner
                        ? `¡${state.winner} ganó la lotería! ¿Jugamos otra vez?`
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

            // "¡Lotería!" → alguien completó su cartón: gana.
            if (hasToken(normalized, 'loteria')) {
                state.phase = 'done';
                state.winner = context?.playerId || null;
                return {
                    prompt: state.winner
                        ? `¡LOTERÍA! ¡Ganó ${state.winner}! ¡A celebrar!`
                        : '¡LOTERÍA! ¡Ganaste! ¡A celebrar!',
                    valid: true,
                    gameOver: true,
                    won: true,
                    score: session.score,
                    animation: 'Dance',
                    emotion: 'happy',
                };
            }

            // "repite" / "pista" → repetir la carta actual.
            if (hasAnyToken(normalized, REPEAT_FRAMES)) {
                return {
                    prompt: `La carta es: ${card.nombre}. ${card.copla}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'thinking',
                };
            }

            // "siguiente" / "otra" → canta la siguiente.
            if (hasAnyToken(normalized, NEXT_FRAMES)) {
                session.round += 1;
                return advanceFrom(state, session);
            }

            // No entendió → repite la carta actual.
            return {
                prompt: `La carta es: ${card.nombre}. ${card.copla}`,
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
                || REPEAT_FRAMES.some((frame) => hasToken(normalized, frame))
                || NEXT_FRAMES.some((frame) => hasToken(normalized, frame))
                || hasToken(normalized, 'loteria');
        },
    };
}
