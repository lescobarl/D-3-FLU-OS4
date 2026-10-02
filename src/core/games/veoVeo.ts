// ============================================================
// src/core/games/veoVeo.ts
// Veo veo (plan-juegos §4). Motor puro sin I/O.
//
// FLU anuncia una cosita por su PRIMERA LETRA (pista = primera
// letra del nombre, variante "adivina el objeto secreto") y el
// niño adivina el objeto. Validación por keywords normalizadas con
// límites de palabra y sinónimos.
//
// Controles del jugador:
//   "pista" / "ayuda" / "no sé" → pista de la categoría
//   "paso" / "otra" / "siguiente" → revela el objeto y salta
// Acierto → +1 punto, siguiente objeto. Incorrecta → reintenta.
// Fin al alcanzar `rounds` objetos.
//
// El RNG es inyectable vía options.random para tests deterministas.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';
import { finishRoundsIfLast, isGameCommandSurface, isLastRound, END_GAME_FRAMES, HELP_CORE_FRAMES, adoptRandom, gameOverResult, hasAnyToken, normalizeForMatch, readRounds, shuffleOrder, stripDiacritics, turnResult } from './gameUtils';

export interface VeoVeoItem {
    nombre: string;
    categoria: string;
    keywords: string[];
}

export const VEO_VEO_BANK: readonly VeoVeoItem[] = Object.freeze([
    {
        nombre: 'manzana',
        categoria: 'una fruta roja y dulce',
        keywords: ['manzana'],
    },
    {
        nombre: 'sol',
        categoria: 'una cosa del cielo que da calor',
        keywords: ['sol'],
    },
    {
        nombre: 'perro',
        categoria: 'un animal que ladra',
        keywords: ['perro', 'perrito'],
    },
    {
        nombre: 'luna',
        categoria: 'una cosa del cielo que brilla de noche',
        keywords: ['luna'],
    },
    {
        nombre: 'mariposa',
        categoria: 'un animal que vuela y tiene alas de colores',
        keywords: ['mariposa'],
    },
    {
        nombre: 'globo',
        categoria: 'un juguete que flota en el aire',
        keywords: ['globo'],
    },
    {
        nombre: 'tren',
        categoria: 'un medio de transporte sobre rieles',
        keywords: ['tren'],
    },
    {
        nombre: 'sombrero',
        categoria: 'una prenda para la cabeza',
        keywords: ['sombrero'],
    },
    {
        nombre: 'elefante',
        categoria: 'un animal muy grande con trompa',
        keywords: ['elefante'],
    },
    {
        nombre: 'caracol',
        categoria: 'un animal pequeño con caparazón',
        keywords: ['caracol'],
    },
    {
        nombre: 'fresa',
        categoria: 'una fruta pequeña y roja',
        keywords: ['fresa', 'frutilla'],
    },
    {
        nombre: 'estrella',
        categoria: 'una cosa que brilla en el cielo de noche',
        keywords: ['estrella'],
    },
]);

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = VEO_VEO_BANK.length;

// "no sé" = el niño está atascado → PISTA de la categoría (documentado).
// Se elimina de SKIP: tenerlo en ambas listas era código muerto (HINT gana).
const HINT_FRAMES: readonly string[] = Object.freeze([
    ...HELP_CORE_FRAMES,
    'dame una pista', 'no se', 'no sé',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'otra', 'siguiente', 'paso', 'me rindo',
]);

const END_FRAMES: readonly string[] = END_GAME_FRAMES;

interface VeoVeoState {
    order: number[];
    cursor: number;
    maxRounds: number;
    phase: 'announce' | 'done';
}

type RandomSource = () => number;

function itemAt(state: VeoVeoState): VeoVeoItem | null {
    const index = state.order[state.cursor];
    return index === undefined ? null : VEO_VEO_BANK[index];
}

/** Primera letra del nombre (sin acentos, en mayúscula) → la pista del juego. */
function itemLetter(item: VeoVeoItem): string {
    return stripDiacritics(item.nombre).trim()[0]?.toUpperCase() ?? '?';
}

/**
 * Pista del juego. En el veo-veo real se adivina entre lo que ambos VEN; aquí
 * no hay escena compartida, así que la letra sola es injugable ("algo con G").
 * Por eso la pista SIEMPRE incluye la categoría del banco (fuente única de datos).
 */
function itemPrompt(item: VeoVeoItem): string {
    return `Veo una cosita que empieza con la letra ${itemLetter(item)} y es ${item.categoria}. ¿Qué es?`;
}

export function createVeoVeoEngine(options?: { random?: RandomSource }): GameEngine<VeoVeoState> {
    let rng: RandomSource = options?.random ?? Math.random;
    const buildState = (cfg: Record<string, unknown> | undefined): VeoVeoState => {
        rng = adoptRandom(rng, cfg);
        return {
            order: shuffleOrder(rng, VEO_VEO_BANK.length),
            cursor: 0,
            maxRounds: readRounds(cfg, DEFAULT_ROUNDS, MAX_ROUNDS),
            phase: 'announce',
        };
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): VeoVeoState => {
        const state: VeoVeoState = buildState(cfg);
        session.state = state;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'veo_veo',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<VeoVeoState> {
            return {
                id: 'veo_veo',
                state: buildState(optionsConfig),
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as VeoVeoState;
            const item = itemAt(state);
            return turnResult(`¡Vamos a jugar a veo veo! ${item ? itemPrompt(item) : ''}`, session.score, { emotion: 'excited' });
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as VeoVeoState;

            if (state.phase === 'done') {
                return gameOverResult('Ya terminamos de jugar veo veo. ¿Jugamos otra vez?', session.score);
            }

            const item = itemAt(state);
            if (!item) {
                state.phase = 'done';
                return gameOverResult(
                        `¡Se acabaron los objetos! Tu puntaje fue ${session.score}. ¡Muy bien!`,
                        session.score,
                        { animation: 'Dance' },
                    );
            }

            const normalized = normalizeForMatch(text);

            // ¿Pide pista (categoría)?
            if (hasAnyToken(normalized, HINT_FRAMES)) {
                return turnResult(`¡Uy! Te doy una pista: es algo de ${item.categoria}. ¿Ya sabes qué es?`, session.score, { emotion: 'thinking' });
            }

            // ¿Intenta adivinar el objeto?
            if (hasAnyToken(normalized, item.keywords)) {
                session.score += 1;
                session.round += 1;
                if (isLastRound(state)) {
                    state.phase = 'done';
                    return gameOverResult(
                            `¡Correcto, es ${item.nombre}! Completaste ${state.maxRounds} rondas de veo veo. ¡Eres un gran detective!`,
                            session.score,
                            { valid: true, won: true, animation: 'Dance' },
                        );
                }
                state.cursor += 1;
                const next = itemAt(state);
                return turnResult(`¡Correcto, es ${item.nombre}! ${next ? itemPrompt(next) : ''}`, session.score, { valid: true, animation: 'Jump_in_place', emotion: 'happy' });
            }

            // ¿Salta al siguiente objeto?
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                session.round += 1;
                const finRonda = finishRoundsIfLast(session, state);
                if (finRonda) return finRonda;
                state.cursor += 1;
                const next = itemAt(state);
                return turnResult(`¡Claro! Era ${item.nombre}. ${next ? itemPrompt(next) : ''}`, session.score);
            }

            // Respuesta incorrecta → reintenta el mismo objeto.
            return turnResult(`¡Casi! Inténtalo otra vez. ${itemPrompt(item)}`, session.score, { emotion: 'encouraging', error: 'respuesta incorrecta' });
        },

        isGameCommand(text = ''): boolean {
            const normalized = normalizeForMatch(text);
            return isGameCommandSurface(normalized, { end: END_FRAMES, hint: HINT_FRAMES, skip: SKIP_FRAMES });
        },
    };
}
export const VEO_VEO_COMMAND_FRAMES = Object.freeze({ HINT_FRAMES, SKIP_FRAMES, END_FRAMES })
