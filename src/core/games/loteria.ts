// ============================================================
// src/core/games/loteria.ts
// Lotería mexicana para voz (plan-juegos §Fase 3).
// Motor puro sin I/O. Banco local de cartas `{ id, nombre, copla }`.
//
// Reglas REALES de la Lotería mexicana:
//   - La TABLA del jugador es un subconjunto ALEATORIO e INDEPENDIENTE
//     del mazo de cantadas (antes se tomaba del mismo orden → todas las
//     primeras cantadas estaban en la tabla y el juego era trivial).
//   - FLU canta el mazo carta por carta (copla). El jugador marca con
//     "la tengo" / "yo la tengo" SOLO si la carta cantada está en su tabla.
//   - Cantada que NO está en la tabla: no se marca ("no la tengo" avanza;
//     si el jugador la marca por error es un FALLO).
//   - `fallosMax` marcas equivocadas → se pierde la partida.
//   - Al marcar TODA la tabla se grita "¡Lotería!" para ganar.
//   - Config (data-driven, sin hardcode): `loteria.tablaSize`
//     (retrocompatibilidad: `cartasPorRonda`/`rounds`) y `loteria.fallosMax`.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';
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
const DEFAULT_FALLOS_MAX = 3;
const MAX_FALLOS = 5;

const HINT_FRAMES: readonly string[] = Object.freeze([
    'pista', 'ayuda', 'ayudame', 'repite', 'no escuche', 'no escuché',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'no la tengo', 'no me toco', 'no la saco', 'paso', 'siguiente', 'sigo', 'otra carta',
]);

// Frases con las que el niño MARCA una carta de su tabla.
const CONFIRM_FRAMES: readonly string[] = Object.freeze([
    'la tengo', 'yo la tengo', 'si la tengo', 'tengo esa', 'me toco', 'la saque',
]);

const END_FRAMES: readonly string[] = Object.freeze([
    'salir del juego',
    'terminar el juego',
    'dejar de jugar',
    'ya no quiero jugar',
    'cerrar el juego',
]);

interface LoteriaState {
    /** Orden del MAZO (cantadas): permutación completa del banco. */
    order: number[];
    /** Cartas de la TABLA del jugador (subconjunto independiente del mazo). */
    tabla: number[];
    /** Marca por slot de la tabla. */
    marcadas: boolean[];
    cursor: number;
    /** Marcas equivocadas acumuladas (carta cantada que no era de la tabla). */
    fallos: number;
    /** Tope de fallos configurado para esta partida. */
    fallosMax: number;
    phase: 'announce' | 'lista' | 'done';
}

interface LoteriaConfig {
    tablaSize: number;
    fallosMax: number;
}

/** Pluraliza de forma simple (es): `1 carta` / `3 cartas`. */
function plural(count: number, singular: string, pluralForm: string): string {
    return count === 1 ? singular : pluralForm;
}

function cardAt(state: LoteriaState): LoteriaCard | null {
    const index = state.order[state.cursor];
    return index === undefined ? null : LOTERIA_BANK[index];
}

function tablaNames(state: LoteriaState): string {
    const names = state.tabla.map((index) => LOTERIA_BANK[index].nombre);
    if (names.length <= 1) return names[0] ?? '';
    if (names.length === 2) return `${names[0]} y ${names[1]}`;
    return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

function markedCount(state: LoteriaState): number {
    return state.marcadas.filter(Boolean).length;
}

/** ¿La carta cantada actual pertenece a la tabla del jugador? */
function currentIsInTabla(state: LoteriaState): boolean {
    const cardIdx = state.order[state.cursor];
    return cardIdx !== undefined && state.tabla.includes(cardIdx);
}

function cantarPrompt(state: LoteriaState, intro = 'Siguiente carta: '): string {
    const card = cardAt(state);
    if (!card) return 'Ya se me acabaron las cartas.';
    return `${intro}${card.copla} ¿La tienes? Di "la tengo" solo si está en tu tabla.`;
}

export function createLoteriaEngine(options?: { random?: RandomSource }): GameEngine {
    let rng: RandomSource = options?.random ?? Math.random;

    const readConfig = (cfg: Record<string, unknown> | undefined): LoteriaConfig => {
        const tablaSize = Number(cfg?.tablaSize)
            || Number(cfg?.cartasPorRonda) // retrocompatibilidad
            || Number(cfg?.rounds)
            || DEFAULT_TABLA;
        const fallosMax = Number(cfg?.fallosMax) || DEFAULT_FALLOS_MAX;
        return {
            tablaSize: clamp(tablaSize, 1, MAX_TABLA),
            fallosMax: clamp(fallosMax, 1, MAX_FALLOS),
        };
    };

    const buildState = (cfg: Record<string, unknown> | undefined): LoteriaState => {
        if (cfg && typeof cfg.random === 'function') {
            rng = cfg.random as RandomSource;
        }
        const config = readConfig(cfg);
        // Mazo y tabla son DOS permutaciones independientes del banco: la
        // tabla no puede derivarse del mazo (regla real; antes era su slice).
        const order = shuffleOrder(rng, LOTERIA_BANK.length);
        const tabla =
            config.tablaSize >= LOTERIA_BANK.length
                ? order.slice()
                : shuffleOrder(rng, LOTERIA_BANK.length).slice(0, config.tablaSize);
        return {
            order,
            tabla,
            marcadas: new Array(tabla.length).fill(false),
            cursor: 0,
            fallos: 0,
            fallosMax: config.fallosMax,
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

    const exhaustResult = (session: GameSession, state: LoteriaState): GameTurnResult => ({
        prompt: `¡Se acabaron las cartas y no llenaste tu tabla! Marcaste ${session.score} de ${state.tabla.length} ${plural(state.tabla.length, 'carta', 'cartas')}. ¡Puedes volver a intentarlo!`,
        valid: false,
        gameOver: true,
        won: false,
        score: session.score,
        animation: 'Idle',
        emotion: 'encouraging',
    });

    const loseByFaultsResult = (
        session: GameSession,
        state: LoteriaState,
        fallosMax: number,
    ): GameTurnResult => ({
        prompt: `¡Ay, no! Marcaste ${fallosMax} ${plural(fallosMax, 'carta', 'cartas')} que no eran de tu tabla y se acabó la partida. Alcanzaste ${session.score} de ${state.tabla.length}. ¡Otra vez será!`,
        valid: false,
        gameOver: true,
        won: false,
        score: session.score,
        animation: 'Idle',
        emotion: 'sad',
    });

    /** Avanza a la siguiente carta del mazo (o cierra por agotamiento). */
    const advanceFrom = (
        state: LoteriaState,
        session: GameSession,
        intro = '¡Claro! Siguiente carta: ',
    ): GameTurnResult => {
        state.cursor += 1;
        if (!cardAt(state)) {
            state.phase = 'done';
            return exhaustResult(session, state);
        }
        return {
            prompt: cantarPrompt(state, intro),
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
            const fallosMax = state.fallosMax;
            const first = cardAt(state);
            return {
                prompt: `¡Vamos a jugar a la lotería! Tu tabla tiene ${state.tabla.length} ${plural(state.tabla.length, 'carta', 'cartas')}: ${tablaNames(state)}. Voy a cantar las cartas del mazo y tú dices "la tengo" solo si es de tu tabla; ojo, con ${fallosMax} ${plural(fallosMax, 'error', 'errores')} pierdes. Primera carta: ${first ? first.copla : ''} ¿La tienes?`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'excited',
            };
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as unknown as LoteriaState;
            const fallosMax = state.fallosMax;

            if (state.phase === 'done') {
                return {
                    prompt: 'Ya terminamos la lotería. ¿Jugamos otra vez?',
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
                return exhaustResult(session, state);
            }

            const normalized = normalizeForMatch(text);

            // Fase "lista": la tabla ya está llena; solo falta el grito de "¡Lotería!".
            if (state.phase === 'lista') {
                if (hasToken(normalized, 'loteria')) {
                    state.phase = 'done';
                    return {
                        prompt: `¡LOTERÍA! ¡Ganaste! Llenaste tu tabla de ${state.tabla.length} ${plural(state.tabla.length, 'carta', 'cartas')} con ${session.score} ${plural(session.score, 'punto', 'puntos')}. ¡Eres un campeón!`,
                        valid: true,
                        gameOver: true,
                        won: true,
                        score: session.score,
                        animation: 'Dance',
                        emotion: 'happy',
                    };
                }
                return {
                    prompt: '¡Tu tabla está llena! Grita "¡Lotería!" para ganar.',
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'encouraging',
                };
            }

            // ¿Pide que repita la copla?
            if (hasAnyToken(normalized, HINT_FRAMES)) {
                return {
                    prompt: `La carta es: ${card.nombre}. ${card.copla} ¿La tienes? Di "la tengo" solo si está en tu tabla.`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'thinking',
                };
            }

            // ¿No la tiene? (antes que "la tengo": "no la tengo" contiene "la tengo")
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                session.round += 1;
                return advanceFrom(state, session);
            }

            // ¿Grita "¡Lotería!" antes de llenar la tabla?
            if (hasToken(normalized, 'loteria')) {
                const remaining = state.tabla.length - markedCount(state);
                return {
                    prompt: `¡Todavía no! Te faltan ${remaining} ${plural(remaining, 'carta', 'cartas')} para llenar tu tabla. ${cantarPrompt(state, '')}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                };
            }

            // ¿Marca la carta con "la tengo"?
            if (hasAnyToken(normalized, CONFIRM_FRAMES)) {
                const cardIdx = state.order[state.cursor];
                const slot = state.tabla.indexOf(cardIdx);
                if (slot !== -1 && !state.marcadas[slot]) {
                    state.marcadas[slot] = true;
                    session.score += 1;
                    session.round += 1;
                    if (markedCount(state) === state.tabla.length) {
                        state.phase = 'lista';
                        return {
                            prompt: '¡Llenaste tu tabla! Ahora grita "¡Lotería!" para ganar.',
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
                        return exhaustResult(session, state);
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
                // La carta cantada NO está en la tabla → FALLO (no se marca).
                state.fallos += 1;
                session.round += 1;
                if (state.fallos >= fallosMax) {
                    state.phase = 'done';
                    return loseByFaultsResult(session, state, fallosMax);
                }
                const restantes = fallosMax - state.fallos;
                return advanceFrom(
                    state,
                    session,
                    `¡Uy! Esa carta no está en tu tabla, no la marques. Te ${plural(restantes, 'queda', 'quedan')} ${restantes} ${plural(restantes, 'error', 'errores')} y sigues. Siguiente carta: `,
                );
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
                || hasToken(normalized, 'loteria')
                || CONFIRM_FRAMES.some((frame) => hasToken(normalized, frame));
        },
    };
}
