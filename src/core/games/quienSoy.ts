// ============================================================
// src/core/games/quienSoy.ts
// ¿Quién soy? (plan-juegos §4). Motor puro sin I/O.
//
// FLU piensa un animal y da pistas PROGRESIVAS (de la más general
// a la más específica). El niño adivina tras cada pista.
//
// Controles del jugador:
//   "pista" / "ayuda" / "no sé" → siguiente pista
//   "paso" / "me rindo" → revela el animal y salta
// Acierto → +1 punto, siguiente animal. Incorrecta → reintenta.
// Fin al alcanzar `rounds` animales.
//
// El RNG es inyectable vía options.random para tests deterministas.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';

export interface QuienSoyItem {
    nombre: string;
    pistas: string[];
    keywords?: string[];
}

export const QUIEN_SOY_BANK: readonly QuienSoyItem[] = Object.freeze([
    {
        nombre: 'leon',
        pistas: ['Vivo en la selva.', 'Soy muy fuerte y valiente.', 'Tengo una melena enorme.', 'Rujo fuerte: ¡grrr!'],
    },
    {
        nombre: 'elefante',
        pistas: ['Soy el animal más grande de la tierra.', 'Tengo una trompa larga.', 'Mis orejas son muy grandes.', 'Tengo colmillos de marfil.'],
    },
    {
        nombre: 'delfin',
        pistas: ['Vivo en el mar.', 'Soy muy inteligente y juguetón.', 'Salto sobre el agua.', 'No soy un pez, soy un mamífero.'],
    },
    {
        nombre: 'tortuga',
        pistas: ['Me muevo muy despacio.', 'Llevo mi casa a cuestas.', 'Vivo muchísimos años.', 'Me escondo dentro de mi caparazón.'],
    },
    {
        nombre: 'buho',
        keywords: ['buho', 'lechuza'],
        pistas: ['Salgo de noche.', 'Tengo los ojos muy grandes.', 'Vuelo en silencio.', 'Hago "uuu uuu".'],
    },
    {
        nombre: 'gato',
        pistas: ['Me gusta dormir mucho.', 'Digo "miau".', 'Cazo ratones.', 'Ronroneo cuando me acarician.'],
    },
    {
        nombre: 'canguro',
        pistas: ['Tengo una bolsa en la panza.', 'Salto muy alto.', 'Vivo en Australia.', 'Llevo a mi bebé en mi bolsa.'],
    },
    {
        nombre: 'pinguino',
        pistas: ['No puedo volar.', 'Vivo en el frío.', 'Voy vestido de negro y blanco.', 'Me deslizo sobre el hielo.'],
    },
    {
        nombre: 'abeja',
        keywords: ['abeja', 'abejita'],
        pistas: ['Soy muy pequeñita.', 'Hago algo muy dulce.', 'Vivo en una colmena.', 'Hago la miel.'],
    },
    {
        nombre: 'pavoreal',
        keywords: ['pavoreal', 'pavo real', 'pavo'],
        pistas: ['Tengo colores muy bonitos.', 'Tengo una cola enorme y colorida.', 'Abro mi cola como un abanico.', 'Soy un ave elegante.'],
    },
    {
        nombre: 'jirafa',
        pistas: ['Tengo el cuello muy largo.', 'Soy muy alta.', 'Como hojas de los árboles.', 'Tengo manchas en el cuerpo.'],
    },
    {
        nombre: 'mariposa',
        pistas: ['Antes era una oruga.', 'Tengo alas de colores.', 'Vuelo de flor en flor.', 'Soy muy ligera.'],
    },
]);

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = QUIEN_SOY_BANK.length;

const HINT_FRAMES: readonly string[] = Object.freeze([
    'pista', 'ayuda', 'ayudame', 'dame una pista', 'dame otra pista', 'otra pista', 'no se', 'no sé',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'me rindo', 'rindo', 'otro', 'siguiente', 'no se', 'no sé',
]);

const END_FRAMES: readonly string[] = Object.freeze([
    'salir del juego',
    'terminar el juego',
    'dejar de jugar',
    'ya no quiero jugar',
    'cerrar el juego',
]);

interface QuienSoyState {
    order: number[];
    cursor: number;
    clueIndex: number;
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
    const order = QUIEN_SOY_BANK.map((_, index) => index);
    for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

function itemAt(state: QuienSoyState): QuienSoyItem | null {
    const index = state.order[state.cursor];
    return index === undefined ? null : QUIEN_SOY_BANK[index];
}

function clueAt(state: QuienSoyState, item: QuienSoyItem): string {
    return item.pistas[Math.min(state.clueIndex, item.pistas.length - 1)];
}

function cluePrompt(state: QuienSoyState, item: QuienSoyItem): string {
    return `Pista ${state.clueIndex + 1}: ${clueAt(state, item)} ¿Quién soy?`;
}

export function createQuienSoyEngine(options?: { random?: RandomSource }): GameEngine {
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

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): QuienSoyState => {
        adoptRandom(cfg);
        const state: QuienSoyState = {
            order: shuffleOrder(rng),
            cursor: 0,
            clueIndex: 0,
            maxRounds: readRounds(cfg),
            phase: 'announce',
        };
        session.state = state as unknown as Record<string, unknown>;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'quien_soy',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession {
            adoptRandom(optionsConfig);
            return {
                id: 'quien_soy',
                state: {
                    order: shuffleOrder(rng),
                    cursor: 0,
                    clueIndex: 0,
                    maxRounds: readRounds(optionsConfig),
                    phase: 'announce',
                },
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as unknown as QuienSoyState;
            const item = itemAt(state);
            return {
                prompt: `¡Vamos a jugar a ¿Quién soy?! Soy un animal. ${item ? cluePrompt(state, item) : ''}`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'excited',
            };
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as unknown as QuienSoyState;

            if (state.phase === 'done') {
                return {
                    prompt: 'Ya terminamos de jugar ¿Quién soy?. ¿Jugamos otra vez?',
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
                    prompt: `¡Se acabaron los animales! Tu puntaje fue ${session.score}. ¡Muy bien!`,
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Dance',
                    emotion: 'happy',
                };
            }

            const normalized = normalizeForMatch(text);

            // ¿Pide otra pista?
            if (hasAnyToken(normalized, HINT_FRAMES)) {
                if (state.clueIndex + 1 >= item.pistas.length) {
                    return {
                        prompt: `Ya te di todas las pistas. ${cluePrompt(state, item)}`,
                        valid: false,
                        gameOver: false,
                        score: session.score,
                        animation: 'Idle',
                        emotion: 'thinking',
                    };
                }
                state.clueIndex += 1;
                return {
                    prompt: cluePrompt(state, item),
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'thinking',
                };
            }

            // ¿Intenta adivinar el animal?
            const answerKeywords = [item.nombre, ...(item.keywords ?? [])];
            if (hasAnyToken(normalized, answerKeywords)) {
                session.score += 1;
                session.round += 1;
                if (state.cursor + 1 >= state.maxRounds || state.cursor + 1 >= state.order.length) {
                    state.phase = 'done';
                    return {
                        prompt: `¡Correcto, era ${item.nombre}! Completaste ${state.maxRounds} animales con ${session.score} puntos. ¡Eres un gran detective!`,
                        valid: true,
                        gameOver: true,
                        score: session.score,
                        animation: 'Dance',
                        emotion: 'happy',
                    };
                }
                state.cursor += 1;
                state.clueIndex = 0;
                const next = itemAt(state);
                return {
                    prompt: `¡Correcto, era ${item.nombre}! Siguiente: Soy un animal. ${next ? cluePrompt(state, next) : ''}`,
                    valid: true,
                    gameOver: false,
                    score: session.score,
                    animation: 'Jump_in_place',
                    emotion: 'happy',
                };
            }

            // ¿Salta al siguiente animal?
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
                state.clueIndex = 0;
                const next = itemAt(state);
                return {
                    prompt: `¡Claro! Era ${item.nombre}. Siguiente: Soy un animal. ${next ? cluePrompt(state, next) : ''}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                };
            }

            // Respuesta incorrecta → reintenta el mismo animal.
            return {
                prompt: `¡Casi! Inténtalo otra vez. ${cluePrompt(state, item)}`,
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
