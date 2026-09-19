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
import { clamp, normalizeForMatch, hasToken, hasAnyToken } from './gameUtils';

export interface QuienSoyItem {
    nombre: string;
    pistas: string[];
    keywords?: string[];
    /** Atributos sí/no del animal (vocabulario compartido, para 20 preguntas). */
    atributos?: Partial<Record<QuienSoyAttribute, boolean>>;
}

/** Atributos sí/no soportados (vocabulario cerrado y documentado). */
export type QuienSoyAttribute =
    | 'vuela' | 'agua' | 'grande' | 'mamifero' | 'plumas' | 'insecto';

export const QUIEN_SOY_BANK: readonly QuienSoyItem[] = Object.freeze([
    {
        nombre: 'leon',
        pistas: ['Vivo en la selva.', 'Soy muy fuerte y valiente.', 'Tengo una melena enorme.', 'Rujo fuerte: ¡grrr!'],
        atributos: { vuela: false, agua: false, grande: true, mamifero: true, plumas: false, insecto: false },
    },
    {
        nombre: 'elefante',
        pistas: ['Soy el animal más grande de la tierra.', 'Tengo una trompa larga.', 'Mis orejas son muy grandes.', 'Tengo colmillos de marfil.'],
        atributos: { vuela: false, agua: false, grande: true, mamifero: true, plumas: false, insecto: false },
    },
    {
        nombre: 'delfin',
        pistas: ['Vivo en el mar.', 'Soy muy inteligente y juguetón.', 'Salto sobre el agua.', 'No soy un pez, soy un mamífero.'],
        atributos: { vuela: false, agua: true, grande: false, mamifero: true, plumas: false, insecto: false },
    },
    {
        nombre: 'tortuga',
        pistas: ['Me muevo muy despacio.', 'Llevo mi casa a cuestas.', 'Vivo muchísimos años.', 'Me escondo dentro de mi caparazón.'],
        atributos: { vuela: false, agua: false, grande: false, mamifero: false, plumas: false, insecto: false },
    },
    {
        nombre: 'buho',
        keywords: ['buho', 'lechuza'],
        pistas: ['Salgo de noche.', 'Tengo los ojos muy grandes.', 'Vuelo en silencio.', 'Hago "uuu uuu".'],
        atributos: { vuela: true, agua: false, grande: false, mamifero: false, plumas: true, insecto: false },
    },
    {
        nombre: 'gato',
        pistas: ['Me gusta dormir mucho.', 'Digo "miau".', 'Cazo ratones.', 'Ronroneo cuando me acarician.'],
        atributos: { vuela: false, agua: false, grande: false, mamifero: true, plumas: false, insecto: false },
    },
    {
        nombre: 'canguro',
        pistas: ['Tengo una bolsa en la panza.', 'Salto muy alto.', 'Vivo en Australia.', 'Llevo a mi bebé en mi bolsa.'],
        atributos: { vuela: false, agua: false, grande: false, mamifero: true, plumas: false, insecto: false },
    },
    {
        nombre: 'pinguino',
        pistas: ['No puedo volar.', 'Vivo en el frío.', 'Voy vestido de negro y blanco.', 'Me deslizo sobre el hielo.'],
        atributos: { vuela: false, agua: true, grande: false, mamifero: false, plumas: true, insecto: false },
    },
    {
        nombre: 'abeja',
        keywords: ['abeja', 'abejita'],
        pistas: ['Soy muy pequeñita.', 'Hago algo muy dulce.', 'Vivo en una colmena.', 'Hago la miel.'],
        atributos: { vuela: true, agua: false, grande: false, mamifero: false, plumas: false, insecto: true },
    },
    {
        nombre: 'pavoreal',
        keywords: ['pavoreal', 'pavo real', 'pavo'],
        pistas: ['Tengo colores muy bonitos.', 'Tengo una cola enorme y colorida.', 'Abro mi cola como un abanico.', 'Soy un ave elegante.'],
        atributos: { vuela: true, agua: false, grande: false, mamifero: false, plumas: true, insecto: false },
    },
    {
        nombre: 'jirafa',
        pistas: ['Tengo el cuello muy largo.', 'Soy muy alta.', 'Como hojas de los árboles.', 'Tengo manchas en el cuerpo.'],
        atributos: { vuela: false, agua: false, grande: true, mamifero: true, plumas: false, insecto: false },
    },
    {
        nombre: 'mariposa',
        pistas: ['Antes era una oruga.', 'Tengo alas de colores.', 'Vuelo de flor en flor.', 'Soy muy ligera.'],
        atributos: { vuela: true, agua: false, grande: false, mamifero: false, plumas: false, insecto: true },
    },
]);

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = QUIEN_SOY_BANK.length;

/**
 * Preguntas sí/no del jugador (20 preguntas): cada regla asocia tokens de la
 * pregunta con un atributo del animal. Una sola fuente: los atributos viven en
 * el banco; aquí solo se mapea la PREGUNTA.
 */
const SI_NO_RULES: ReadonlyArray<{ tokens: readonly string[]; attribute: QuienSoyAttribute }> =
    Object.freeze([
        { tokens: ['vuela', 'volar', 'alas'], attribute: 'vuela' },
        { tokens: ['agua', 'mar', 'nada'], attribute: 'agua' },
        { tokens: ['grande', 'enorme', 'gigante', 'alta', 'alto'], attribute: 'grande' },
        { tokens: ['mamifero', 'mamífero'], attribute: 'mamifero' },
        { tokens: ['plumas'], attribute: 'plumas' },
        { tokens: ['insecto', 'bicho'], attribute: 'insecto' },
    ]);

/** ¿El texto es una pregunta sí/no sobre un atributo conocido? */
function resolveSiNoQuestion(normalized: string): QuienSoyAttribute | null {
    for (const rule of SI_NO_RULES) {
        if (rule.tokens.some((token) => hasToken(normalized, token))) return rule.attribute;
    }
    return null;
}

// --- Rol invertido: el NIÑO piensa un animal y FLU pregunta sí/no -----------
// Reutiliza el banco y sus atributos (fuente única); sin banco nuevo.

const ATTRIBUTE_ORDER: readonly QuienSoyAttribute[] = Object.freeze([
    'vuela', 'agua', 'grande', 'mamifero', 'plumas', 'insecto',
]);

const ATTRIBUTE_QUESTIONS: Record<QuienSoyAttribute, string> = Object.freeze({
    vuela: '¿Tu animal vuela?',
    agua: '¿Vive en el agua?',
    grande: '¿Es grande?',
    mamifero: '¿Es un mamífero?',
    plumas: '¿Tiene plumas?',
    insecto: '¿Es un insecto?',
});

const SWAP_FRAMES: readonly string[] = Object.freeze([
    'yo pienso un animal', 'yo pienso mi animal', 'adivina mi animal', 'adivina el mio',
    'te toca adivinar', 'ahora adivinas tu', 'ahora adivina tu', 'yo escojo el animal',
    'yo escogi el animal', 'yo elijo el animal',
]);

const AFFIRMATIVE_FRAMES: readonly string[] = Object.freeze(['si', 'claro', 'correcto', 'yes', 'aja']);
const NEGATIVE_FRAMES: readonly string[] = Object.freeze(['no', 'nop', 'nel', 'no se']);

/** Mejor atributo para partir los candidatos en dos mitades (determinista). */
function bestSplitAttribute(
    candidatos: readonly number[],
    asked: readonly QuienSoyAttribute[],
): QuienSoyAttribute | null {
    let best: QuienSoyAttribute | null = null;
    let bestBalance = 0;
    for (const attribute of ATTRIBUTE_ORDER) {
        if (asked.includes(attribute)) continue;
        let yes = 0;
        for (const index of candidatos) {
            if (QUIEN_SOY_BANK[index].atributos?.[attribute] === true) yes += 1;
        }
        const no = candidatos.length - yes;
        if (yes === 0 || no === 0) continue;
        const balance = Math.min(yes, no);
        if (balance > bestBalance) {
            bestBalance = balance;
            best = attribute;
        }
    }
    return best;
}

function guessPrompt(nombre: string): string {
    return `¿Es un ${nombre}? Di "sí" o "no".`;
}

function askNext(state: QuienSoyState, session: GameSession): GameTurnResult {
    if (state.candidatos.length <= 1) {
        state.fluGuess = QUIEN_SOY_BANK[state.candidatos[0]]?.nombre ?? QUIEN_SOY_BANK[0].nombre;
        return {
            prompt: guessPrompt(state.fluGuess),
            valid: false,
            gameOver: false,
            score: session.score,
            animation: 'Idle',
            emotion: 'thinking',
        };
    }
    const attribute = bestSplitAttribute(state.candidatos, state.asked);
    if (!attribute) {
        state.fluGuess = QUIEN_SOY_BANK[state.candidatos[0]].nombre;
        return {
            prompt: guessPrompt(state.fluGuess),
            valid: false,
            gameOver: false,
            score: session.score,
            animation: 'Idle',
            emotion: 'thinking',
        };
    }
    state.asked.push(attribute);
    return {
        prompt: `${ATTRIBUTE_QUESTIONS[attribute]} Di "sí" o "no".`,
        valid: false,
        gameOver: false,
        score: session.score,
        animation: 'Idle',
        emotion: 'thinking',
    };
}

function finishFluGuessing(session: GameSession, state: QuienSoyState, won: boolean): GameTurnResult {
    state.phase = 'done';
    return {
        prompt: won
            ? `¡Sí! Adiviné tu animal. ¡Soy un gran detective!`
            : '¡Me rindo! ¿Cuál era tu animal? La próxima te adivino.',
        valid: won,
        gameOver: true,
        score: session.score,
        animation: won ? 'Dance' : 'Idle',
        emotion: won ? 'happy' : 'encouraging',
    };
}

function turnFluGuessing(session: GameSession, state: QuienSoyState, normalized: string): GameTurnResult {
    const affirmative = AFFIRMATIVE_FRAMES.some((token) => hasToken(normalized, token));
    const negative = NEGATIVE_FRAMES.some((token) => hasToken(normalized, token));
    const yes = affirmative && !negative;

    if (state.fluGuess) {
        if (yes) {
            session.score += 1;
            return finishFluGuessing(session, state, true);
        }
        state.candidatos = state.candidatos.filter(
            (index) => QUIEN_SOY_BANK[index].nombre !== state.fluGuess,
        );
        state.fluGuess = null;
        if (!state.candidatos.length) return finishFluGuessing(session, state, false);
        return askNext(state, session);
    }

    const asked = state.asked[state.asked.length - 1];
    if (asked) {
        state.candidatos = state.candidatos.filter(
            (index) => (QUIEN_SOY_BANK[index].atributos?.[asked] === true) === yes,
        );
        if (!state.candidatos.length) return finishFluGuessing(session, state, false);
    }
    return askNext(state, session);
}

const HINT_FRAMES: readonly string[] = Object.freeze([
    'pista', 'ayuda', 'ayudame', 'dame una pista', 'dame otra pista', 'otra pista', 'no se', 'no sé',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'me rindo', 'rindo', 'otro', 'siguiente',
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
    /** Índices del banco que el JUGADOR ya nombró: FLU no los reutiliza como objetivo. */
    mentioned: number[];
    /** 'kid' = FLU piensa el animal (actual); 'flu' = rol invertido, FLU adivina. */
    mode: 'kid' | 'flu';
    /** Índices del banco aún posibles cuando FLU adivina (rol invertido). */
    candidatos: number[];
    /** Atributos ya preguntados en el rol invertido. */
    asked: QuienSoyAttribute[];
    /** Animal que FLU va a confirmar; null mientras hace preguntas. */
    fluGuess: string | null;
}

type RandomSource = () => number;

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

/**
 * Avanza al siguiente objetivo SALTANDO los animales que el jugador ya nombró:
 * FLU no debe "pensar" un animal que el jugador acaba de decir.
 */
function advanceSkippingMentioned(state: QuienSoyState): void {
    state.cursor += 1;
    while (state.cursor < state.order.length && state.mentioned.includes(state.order[state.cursor])) {
        state.cursor += 1;
    }
    state.clueIndex = 0;
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
            mentioned: [],
            mode: 'kid',
            candidatos: [],
            asked: [],
            fluGuess: null,
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
                    mentioned: [],
                    mode: 'kid',
                    candidatos: [],
                    asked: [],
                    fluGuess: null,
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

            // Rol invertido: el niño pide pensar ÉL un animal → FLU pregunta sí/no.
            if (state.mode === 'kid' && SWAP_FRAMES.some((frame) => normalized.includes(frame))) {
                state.mode = 'flu';
                state.candidatos = QUIEN_SOY_BANK.map((_, index) => index);
                state.asked = [];
                state.fluGuess = null;
                return askNext(state, session);
            }
            if (state.mode === 'flu') {
                return turnFluGuessing(session, state, normalized);
            }

            // Recordar animales que el JUGADOR nombró (aunque falle): FLU no los
            // reutilizará como objetivo en los próximos turnos.
            QUIEN_SOY_BANK.forEach((bankItem, index) => {
                if (state.mentioned.includes(index)) return;
                const names = [bankItem.nombre, ...(bankItem.keywords ?? [])];
                if (hasAnyToken(normalized, names)) state.mentioned.push(index);
            });

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

            // ¿Pregunta sí/no (20 preguntas)? No gasta intento ni pista.
            const siNoAttribute = resolveSiNoQuestion(normalized);
            if (siNoAttribute) {
                const afirmativo = item.atributos?.[siNoAttribute] === true;
                return {
                    prompt: afirmativo ? 'Sí.' : 'No.',
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
                advanceSkippingMentioned(state);
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
                advanceSkippingMentioned(state);
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

