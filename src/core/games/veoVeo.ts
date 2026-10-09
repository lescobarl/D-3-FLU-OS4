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
import { END_GAME_FRAMES, HELP_CORE_FRAMES, adoptRandom, bankItemAt, baseSession, beginGame, buildShuffledState, hasAnyToken, isEngineCommand, resetGameSession, runGuessTurn, stripDiacritics } from './gameUtils';

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

const itemAt = (state: VeoVeoState) => bankItemAt(state, VEO_VEO_BANK);

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
    const buildState = (cfg: Record<string, unknown> | undefined): VeoVeoState =>
        buildShuffledState({
            cfg,
            bankLength: VEO_VEO_BANK.length,
            defaultRounds: DEFAULT_ROUNDS,
            maxRounds: MAX_ROUNDS,
            adopt: (cfg2) => {
                rng = adoptRandom(rng, cfg2);
                return rng;
            },
            build: ({ order, maxRounds }) => ({ order, cursor: 0, maxRounds, phase: 'announce' }),
        });

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): VeoVeoState =>
        resetGameSession(session, cfg, buildState);

    return {
        id: 'veo_veo',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<VeoVeoState> {
            return baseSession('veo_veo', buildState(optionsConfig));
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            return beginGame(session, optionsConfig, reset, (raw) => {
                const state = raw as VeoVeoState;
                const item = itemAt(state);
                return `¡Vamos a jugar a veo veo! ${item ? itemPrompt(item) : ''}`;
            }, { emotion: 'excited' });
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            return runGuessTurn<VeoVeoState, NonNullable<ReturnType<typeof itemAt>>>({
                session,
                state: session.state as VeoVeoState,
                text,
                itemAt,
                matches: (normalized, item) => hasAnyToken(normalized, item.keywords),
                hintFrames: HINT_FRAMES,
                skipFrames: SKIP_FRAMES,
                message: {
                    done: 'Ya terminamos de jugar veo veo. ¿Jugamos otra vez?',
                    exhausted: ({ score }) => `¡Se acabaron los objetos! Tu puntaje fue ${score}. ¡Muy bien!`,
                    hint: (item) => `¡Uy! Te doy una pista: es algo de ${item.categoria}. ¿Ya sabes qué es?`,
                    won: (item, { maxRounds }) =>
                        `¡Correcto, es ${item.nombre}! Completaste ${maxRounds} rondas de veo veo. ¡Eres un gran detective!`,
                    correct: (item, next) => `¡Correcto, es ${item.nombre}! ${next ? itemPrompt(next) : ''}`,
                    skipped: (item, next) => `¡Claro! Era ${item.nombre}. ${next ? itemPrompt(next) : ''}`,
                    retry: (item) => `¡Casi! Inténtalo otra vez. ${itemPrompt(item)}`,
                },
            });
        },

        isGameCommand(text = ''): boolean {
            return isEngineCommand(text, { end: END_FRAMES, hint: HINT_FRAMES, skip: SKIP_FRAMES });
        },
    };
}
export const VEO_VEO_COMMAND_FRAMES = Object.freeze({ HINT_FRAMES, SKIP_FRAMES, END_FRAMES })
