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
    'pista', 'ayuda', 'ayudame', 'dame una pista', 'no se', 'no sé',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'otra', 'siguiente', 'paso', 'me rindo',
]);

const END_FRAMES: readonly string[] = Object.freeze([
    'salir del juego',
    'terminar el juego',
    'dejar de jugar',
    'ya no quiero jugar',
    'cerrar el juego',
]);

interface VeoVeoState {
    order: number[];
    cursor: number;
    maxRounds: number;
    phase: 'announce' | 'done';
}

type RandomSource = () => number;

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.round(value)));
}

function stripDiacritics(text: string): string {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeForMatch(text = ''): string {
    return stripDiacritics(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasToken(normalized = '', phrase = ''): boolean {
    if (!phrase) return false;
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|\\s)${escaped}($|\\s|[.,;!?¡¿])`);
    return pattern.test(normalized);
}

function hasAnyToken(normalized: string, phrases: readonly string[]): boolean {
    return phrases.some((phrase) => hasToken(normalized, phrase));
}

/** Baraja determinista (Fisher-Yates) de los índices del banco. */
function shuffleOrder(rng: RandomSource): number[] {
    const order = VEO_VEO_BANK.map((_, index) => index);
    for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

function itemAt(state: VeoVeoState): VeoVeoItem | null {
    const index = state.order[state.cursor];
    return index === undefined ? null : VEO_VEO_BANK[index];
}

/** Primera letra del nombre (sin acentos, en mayúscula) → la pista del juego. */
function itemLetter(item: VeoVeoItem): string {
    return stripDiacritics(item.nombre).trim()[0]?.toUpperCase() ?? '?';
}

function itemPrompt(item: VeoVeoItem): string {
    return `Veo una cosita que empieza con la letra ${itemLetter(item)}. ¿Qué es?`;
}

export function createVeoVeoEngine(options?: { random?: RandomSource }): GameEngine {
    let rng: RandomSource = options?.random ?? Math.random;

    const readRounds = (cfg: Record<string, unknown> | undefined): number => {
        const rounds = Number(cfg?.rounds) || Number(cfg?.defaultRounds) || DEFAULT_ROUNDS;
        return clamp(rounds, 1, MAX_ROUNDS);
    };

    const adoptRandom = (cfg: Record<string, unknown> | undefined): void => {
        if (cfg && typeof cfg.random === 'function') {
            rng = cfg.random as RandomSource;
        }
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): VeoVeoState => {
        adoptRandom(cfg);
        const state: VeoVeoState = {
            order: shuffleOrder(rng),
            cursor: 0,
            maxRounds: readRounds(cfg),
            phase: 'announce',
        };
        session.state = state as unknown as Record<string, unknown>;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'veo_veo',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession {
            adoptRandom(optionsConfig);
            return {
                id: 'veo_veo',
                state: {
                    order: shuffleOrder(rng),
                    cursor: 0,
                    maxRounds: readRounds(optionsConfig),
                    phase: 'announce',
                },
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as unknown as VeoVeoState;
            const item = itemAt(state);
            return {
                prompt: `¡Vamos a jugar a veo veo! ${item ? itemPrompt(item) : ''}`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'excited',
            };
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as unknown as VeoVeoState;

            if (state.phase === 'done') {
                return {
                    prompt: 'Ya terminamos de jugar veo veo. ¿Jugamos otra vez?',
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'happy',
                };
            }

            const item = itemAt(state);
            if (!item) {
                state.phase = 'done';
                return {
                    prompt: `¡Se acabaron los objetos! Tu puntaje fue ${session.score}. ¡Muy bien!`,
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Dance',
                    emotion: 'happy',
                };
            }

            const normalized = normalizeForMatch(text);

            // ¿Pide pista (categoría)?
            if (hasAnyToken(normalized, HINT_FRAMES)) {
                return {
                    prompt: `¡Uy! Te doy una pista: es algo de ${item.categoria}. ¿Ya sabes qué es?`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'thinking',
                };
            }

            // ¿Intenta adivinar el objeto?
            if (hasAnyToken(normalized, item.keywords)) {
                session.score += 1;
                session.round += 1;
                if (state.cursor + 1 >= state.maxRounds || state.cursor + 1 >= state.order.length) {
                    state.phase = 'done';
                    return {
                        prompt: `¡Correcto, es ${item.nombre}! Completaste ${state.maxRounds} rondas de veo veo. ¡Eres un gran detective!`,
                        valid: true,
                        gameOver: true,
                        score: session.score,
                        animation: 'Dance',
                        emotion: 'happy',
                    };
                }
                state.cursor += 1;
                const next = itemAt(state);
                return {
                    prompt: `¡Correcto, es ${item.nombre}! ${next ? itemPrompt(next) : ''}`,
                    valid: true,
                    gameOver: false,
                    score: session.score,
                    animation: 'Jump_in_place',
                    emotion: 'happy',
                };
            }

            // ¿Salta al siguiente objeto?
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                session.round += 1;
                if (state.cursor + 1 >= state.maxRounds || state.cursor + 1 >= state.order.length) {
                    state.phase = 'done';
                    return {
                        prompt: `Terminamos con ${session.score} puntos. ¡Muy bien jugado!`,
                        valid: false,
                        gameOver: true,
                        score: session.score,
                        animation: 'Dance',
                        emotion: 'happy',
                    };
                }
                state.cursor += 1;
                const next = itemAt(state);
                return {
                    prompt: `¡Claro! Era ${item.nombre}. ${next ? itemPrompt(next) : ''}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                };
            }

            // Respuesta incorrecta → reintenta el mismo objeto.
            return {
                prompt: `¡Casi! Inténtalo otra vez. ${itemPrompt(item)}`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'encouraging',
                error: 'respuesta incorrecta',
            };
        },

        isGameCommand(text = ''): boolean {
            const normalized = normalizeForMatch(text);
            return END_FRAMES.some((frame) => normalized.includes(frame))
                || HINT_FRAMES.some((frame) => hasToken(normalized, frame))
                || SKIP_FRAMES.some((frame) => hasToken(normalized, frame));
        },
    };
}
