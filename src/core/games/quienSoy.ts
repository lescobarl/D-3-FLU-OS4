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
import { normalizeForMatch, hasToken, hasAnyToken, adoptRandom, readRounds, END_GAME_FRAMES, matchesEndGameFrames, shuffleOrder, gameOverResult } from './gameUtils';

export interface QuienSoyItem {
    nombre: string;
    pistas: string[];
    /**
     * Rasgo observable que revela cada pista, en el MISMO orden y con la MISMA
     * longitud que `pistas`. Es lo que hace medible "la pista aporta": si el
     * jugador solo sabe los rasgos revelados hasta ahora, los animales que
     * siguen siendo posibles son los que tienen TODOS esos rasgos. Una pista
     * cuyo rasgo no descarta a nadie es relleno, y hay guard que lo impide.
     */
    revela: QuienSoyRasgo[];
    /** Rasgos que el animal TIENE de verdad (vocabulario cerrado). */
    rasgos: QuienSoyRasgo[];
    keywords?: string[];
    /** Atributos sí/no del animal (vocabulario compartido, para 20 preguntas). */
    atributos?: Partial<Record<QuienSoyAttribute, boolean>>;
}

/** Atributos sí/no soportados (vocabulario cerrado y documentado). */
export type QuienSoyAttribute =
    | 'vuela' | 'agua' | 'grande' | 'mamifero' | 'plumas' | 'insecto';

/**
 * Vocabulario CERRADO de rasgos observables de una pista. Cada rasgo agrupa a
 * los animales que lo comparten, y eso es lo que permite medir si una pista
 * acota o no. Añadir un animal al banco obliga a declarar sus rasgos; el guard
 * de calibración comprueba que sigue siendo adivinable.
 */
export type QuienSoyRasgo =
    | 'mamifero' | 'ave' | 'insecto' | 'reptil'
    | 'vuela' | 'acuatico' | 'grande'
    | 'felino' | 'melena' | 'rugido' | 'bigotes' | 'ronroneo'
    | 'trompa' | 'colmillos' | 'cuello_largo' | 'manchas'
    | 'salta_ola' | 'inteligente' | 'salta_alto' | 'bolsa' | 'australia'
    | 'nocturno' | 'ojos_grandes' | 'ulula' | 'cola_abanico' | 'plumas_coloridas'
    | 'blanco_y_negro' | 'hielo' | 'colmena' | 'miel'
    | 'oruga' | 'alas_coloridas' | 'caparazon' | 'lento';

export const QUIEN_SOY_BANK: readonly QuienSoyItem[] = Object.freeze([
    {
        nombre: 'leon',
        pistas: ['Soy un mamífero: tengo pelo y de pequeño tomé leche de mi mamá.', 'Soy un felino: ando a cuatro patas y tengo garras.', 'Tengo una melena enorme.', 'Rujo fuerte: ¡grrr!'],
        revela: ['mamifero', 'felino', 'melena', 'rugido'],
        rasgos: ['mamifero', 'felino', 'melena', 'rugido'],
        atributos: { vuela: false, agua: false, grande: true, mamifero: true, plumas: false, insecto: false },
    },
    {
        nombre: 'elefante',
        pistas: ['Soy un mamífero muy grande.', 'Soy el animal más grande de la tierra.', 'Tengo una trompa larga.', 'Tengo colmillos de marfil.'],
        revela: ['mamifero', 'grande', 'trompa', 'colmillos'],
        rasgos: ['mamifero', 'grande', 'trompa', 'colmillos'],
        atributos: { vuela: false, agua: false, grande: true, mamifero: true, plumas: false, insecto: false },
    },
    {
        nombre: 'delfin',
        pistas: ['Soy un mamífero que vive en el agua.', 'Vivo en el mar y nado muy rápido.', 'Salto sobre el agua.', 'Soy muy inteligente y juguetón.'],
        revela: ['mamifero', 'acuatico', 'salta_ola', 'inteligente'],
        rasgos: ['mamifero', 'acuatico', 'salta_ola', 'inteligente'],
        atributos: { vuela: false, agua: true, grande: false, mamifero: true, plumas: false, insecto: false },
    },
    {
        nombre: 'tortuga',
        pistas: ['Nado en el agua, pero salgo a respirar.', 'Soy un reptil: tengo escamas.', 'Llevo mi casa a cuestas.', 'Me muevo muy despacio.'],
        revela: ['acuatico', 'reptil', 'caparazon', 'lento'],
        rasgos: ['acuatico', 'reptil', 'caparazon', 'lento'],
        atributos: { vuela: false, agua: false, grande: false, mamifero: false, plumas: false, insecto: false },
    },
    {
        nombre: 'buho',
        keywords: ['buho', 'lechuza'],
        pistas: ['Soy un ave y tengo plumas.', 'Salgo de noche.', 'Tengo los ojos muy grandes.', 'Hago "uuu uuu".'],
        revela: ['ave', 'nocturno', 'ojos_grandes', 'ulula'],
        rasgos: ['ave', 'nocturno', 'ojos_grandes', 'ulula'],
        atributos: { vuela: true, agua: false, grande: false, mamifero: false, plumas: true, insecto: false },
    },
    {
        nombre: 'gato',
        pistas: ['Soy un mamífero pequeñito que vive en casa.', 'Soy un felino y tengo las uñas muy afiladas.', 'Tengo bigotes largos y sensibles.', 'Ronroneo cuando me acarician.'],
        revela: ['mamifero', 'felino', 'bigotes', 'ronroneo'],
        rasgos: ['mamifero', 'felino', 'bigotes', 'ronroneo'],
        atributos: { vuela: false, agua: false, grande: false, mamifero: true, plumas: false, insecto: false },
    },
    {
        nombre: 'canguro',
        pistas: ['Soy un mamífero y llevo a mis crías conmigo.', 'Salto muy alto.', 'Tengo una bolsa en la panza.', 'Vivo en Australia.'],
        revela: ['mamifero', 'salta_alto', 'bolsa', 'australia'],
        rasgos: ['mamifero', 'salta_alto', 'bolsa', 'australia'],
        atributos: { vuela: false, agua: false, grande: false, mamifero: true, plumas: false, insecto: false },
    },
    {
        nombre: 'pinguino',
        pistas: ['Soy un ave, pero no puedo volar.', 'Nado muy bien y vivo donde hace mucho frío.', 'Voy vestido de negro y blanco.', 'Me deslizo sobre el hielo.'],
        revela: ['ave', 'acuatico', 'blanco_y_negro', 'hielo'],
        rasgos: ['ave', 'acuatico', 'blanco_y_negro', 'hielo'],
        atributos: { vuela: false, agua: true, grande: false, mamifero: false, plumas: true, insecto: false },
    },
    {
        nombre: 'abeja',
        keywords: ['abeja', 'abejita'],
        pistas: ['Soy muy pequeñita y tengo alas.', 'Soy un insecto, no un ave.', 'Vivo en una colmena.', 'Hago la miel.'],
        revela: ['vuela', 'insecto', 'colmena', 'miel'],
        rasgos: ['vuela', 'insecto', 'colmena', 'miel'],
        atributos: { vuela: true, agua: false, grande: false, mamifero: false, plumas: false, insecto: true },
    },
    {
        nombre: 'pavoreal',
        keywords: ['pavoreal', 'pavo real', 'pavo'],
        pistas: ['Soy un ave con muchísimas plumas.', 'Puedo volar, aunque prefiero caminar.', 'Abro mi cola como un abanico.', 'Mis plumas brillan con muchos colores.'],
        revela: ['ave', 'vuela', 'cola_abanico', 'plumas_coloridas'],
        rasgos: ['ave', 'vuela', 'cola_abanico', 'plumas_coloridas'],
        atributos: { vuela: true, agua: false, grande: false, mamifero: false, plumas: true, insecto: false },
    },
    {
        nombre: 'jirafa',
        pistas: ['Soy un mamífero que come plantas.', 'Soy tan alta que casi toco las nubes.', 'Tengo el cuello muy largo.', 'Tengo manchas en el cuerpo.'],
        revela: ['mamifero', 'grande', 'cuello_largo', 'manchas'],
        rasgos: ['mamifero', 'grande', 'cuello_largo', 'manchas'],
        atributos: { vuela: false, agua: false, grande: true, mamifero: true, plumas: false, insecto: false },
    },
    {
        nombre: 'mariposa',
        pistas: ['Tengo alas y soy muy ligera.', 'Soy un insecto de jardín.', 'Antes era una oruga.', 'Tengo alas de colores.'],
        revela: ['vuela', 'insecto', 'oruga', 'alas_coloridas'],
        rasgos: ['vuela', 'insecto', 'oruga', 'alas_coloridas'],
        atributos: { vuela: true, agua: false, grande: false, mamifero: false, plumas: false, insecto: true },
    },
]);

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = QUIEN_SOY_BANK.length;

/**
 * Minimo de candidatos que debe dejar la PRIMERA pista: si resolviera el juego
 * de golpe no habria juego. Es parte del invariante de calibracion.
 */
export const MIN_CANDIDATOS_PRIMERA = 3;

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
    return gameOverResult(
        won
            ? `¡Sí! Adiviné tu animal. ¡Soy un gran detective!`
            : '¡Me rindo! ¿Cuál era tu animal? La próxima te adivino.',
        session.score,
        {
            valid: won,
            won,
            animation: won ? 'Dance' : 'Idle',
            emotion: won ? 'happy' : 'encouraging',
        },
    );
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

const END_FRAMES: readonly string[] = END_GAME_FRAMES;

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

/**
 * Una pista es una NEGACION cuando se define por lo que el animal NO es o NO
 * puede hacer ("No puedo volar.", "No soy un pez..."). Es vocabulario de apoyo:
 * solo informa DESPUES de una pista positiva que acote el espacio.
 */
const NEGATION_CLAUSE = /^\s*no\b/i;

/**
 * Secuencia REAL de pistas de un animal: primero las positivas y despues las
 * negaciones (orden relativo preservado). Duena unica del orden de las pistas;
 * la leen `clueAt` y el tope de "pista".
 *
 * INVARIANTE (guardado por test): la primera pista nunca es una negacion. Si lo
 * fuera, la partida es inganable: "No puedo volar" describe a 9 de los 12
 * animales del banco y no descarta nada (defecto medido 22:11:37).
 */
export function quienSoyHints(item: QuienSoyItem): string[] {
    const positivas = item.pistas.filter((pista) => !NEGATION_CLAUSE.test(pista));
    const negaciones = item.pistas.filter((pista) => NEGATION_CLAUSE.test(pista));
    return [...positivas, ...negaciones];
}

/**
 * CALIBRACION de un animal: cuantos animales siguen siendo posibles despues de
 * cada pista. Es la medida del defecto "pistas vagas/inutiles" y la lee el guard
 * de tests/quienSoy.test.ts.
 *
 * Un animal es candidato si tiene TODOS los rasgos revelados hasta ese momento.
 * Invariante que hace jugable la partida:
 *   - la primera pista NUNCA resuelve (deja al menos MIN_CANDIDATOS_PRIMERA);
 *   - mientras haya mas de un candidato, cada pista siguiente DEBE descartar
 *     alguno (una pista que no descarta nada es relleno);
 *   - la ultima pista deja EXACTAMENTE un candidato (se puede adivinar).
 */
export function quienSoyNarrowing(
    item: QuienSoyItem,
    bank: readonly QuienSoyItem[] = QUIEN_SOY_BANK,
): number[] {
    const revelados: QuienSoyRasgo[] = [];
    return item.revela.map((rasgo) => {
        revelados.push(rasgo);
        return bank.filter((candidato) => revelados.every((r) => candidato.rasgos.includes(r))).length;
    });
}

/** Categoria del animal segun el vocabulario de atributos (plumas/mamifero/insecto). */
export function quienSoyCategory(item: QuienSoyItem): string {
    if (item.atributos?.insecto === true) return 'insecto';
    if (item.atributos?.plumas === true) return 'ave';
    if (item.atributos?.mamifero === true) return 'mamifero';
    return 'otro';
}

type RandomSource = () => number;

function itemAt(state: QuienSoyState): QuienSoyItem | null {
    const index = state.order[state.cursor];
    return index === undefined ? null : QUIEN_SOY_BANK[index];
}

function clueAt(state: QuienSoyState, item: QuienSoyItem): string {
    const pistas = quienSoyHints(item);
    return pistas[Math.min(state.clueIndex, pistas.length - 1)] ?? '';
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

export function createQuienSoyEngine(options?: { random?: RandomSource }): GameEngine<QuienSoyState> {
    let rng: RandomSource = options?.random ?? Math.random;
    const buildState = (cfg: Record<string, unknown> | undefined): QuienSoyState => {
        rng = adoptRandom(rng, cfg);
        return {
            order: shuffleOrder(rng, QUIEN_SOY_BANK.length),
            cursor: 0,
            clueIndex: 0,
            maxRounds: readRounds(cfg, DEFAULT_ROUNDS, MAX_ROUNDS),
            phase: 'announce',
            mentioned: [],
            mode: 'kid',
            candidatos: [],
            asked: [],
            fluGuess: null,
        };
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): QuienSoyState => {
        const state: QuienSoyState = buildState(cfg);
        session.state = state;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'quien_soy',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<QuienSoyState> {
            return {
                id: 'quien_soy',
                state: buildState(optionsConfig),
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as QuienSoyState;
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
            const state = session.state as QuienSoyState;

            if (state.phase === 'done') {
                return gameOverResult('Ya terminamos de jugar ¿Quién soy?. ¿Jugamos otra vez?', session.score);
            }

            const item = itemAt(state);
            if (!item) {
                state.phase = 'done';
                return gameOverResult(
                        `¡Se acabaron los animales! Tu puntaje fue ${session.score}. ¡Muy bien!`,
                        session.score,
                        { animation: 'Dance' },
                    );
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
                if (state.clueIndex + 1 >= quienSoyHints(item).length) {
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
                    return gameOverResult(
                            `¡Correcto, era ${item.nombre}! Completaste ${state.maxRounds} animales con ${session.score} puntos. ¡Eres un gran detective!`,
                            session.score,
                            { valid: true, won: true, animation: 'Dance' },
                        );
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

            /**
             * Cierra el animal en curso y pasa al siguiente. DUENO UNICO del
             * avance: lo usan el salto explicito ("paso") y el fallo cuando YA se
             * dieron todas las pistas (antes repetia la ultima pista para siempre,
             * asi que la partida no avanzaba ni aportaba informacion nueva).
             * `apertura` es como se dice que el animal se acabo.
             */
            const cerrarAnimal = (apertura: string): GameTurnResult => {
                session.round += 1;
                if (state.cursor + 1 >= state.maxRounds || state.cursor + 1 >= state.order.length) {
                    state.phase = 'done';
                    return gameOverResult(
                            `Terminamos con ${session.score} puntos. ¡Muy bien jugado!`,
                            session.score,
                            { animation: 'Dance' },
                        );
                }
                advanceSkippingMentioned(state);
                const next = itemAt(state);
                return {
                    prompt: `${apertura} Era ${item.nombre}. Siguiente: Soy un animal. ${next ? cluePrompt(state, next) : ''}`,
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                };
            };

            // ¿Salta al siguiente animal?
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                return cerrarAnimal('¡Claro!');
            }

            // Respuesta incorrecta → reintenta el mismo animal CON PISTA NUEVA.
            // Antes repetia la misma pista indefinidamente ("Pista 1"), asi que el
            // jugador no acumulaba informacion y la partida era inganable. El fallo
            // avanza el cursor de pistas (hasta la ultima). El "¡Casi!" solo se dice
            // si el animal nombrado es del banco y de la MISMA categoria: "un perro"
            // contra un pinguino no es un "casi" (defecto medido 22:11:37).
            const pistasSequencia = quienSoyHints(item);
            const namedSameCategory = QUIEN_SOY_BANK.some((bankItem) =>
                hasAnyToken(normalized, [bankItem.nombre, ...(bankItem.keywords ?? [])])
                && quienSoyCategory(bankItem) === quienSoyCategory(item));
            if (state.clueIndex + 1 >= pistasSequencia.length) {
                // Ya se dieron TODAS las pistas y vuelve a fallar: repetir la ultima
                // no aporta nada y dejaba la partida en bucle. Se revela y se pasa al
                // siguiente con el MISMO avance del salto (sin puntuar el acierto:
                // no lo hubo).
                return cerrarAnimal('¡Se acabaron las pistas!');
            }
            state.clueIndex += 1;
            return {
                prompt: `${namedSameCategory ? '¡Casi! Inténtalo otra vez.' : 'No, ese no es. Inténtalo otra vez.'} ${cluePrompt(state, item)}`,
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
            return matchesEndGameFrames(normalized, END_FRAMES)
                || HINT_FRAMES.some((frame) => hasToken(normalized, frame))
                || SKIP_FRAMES.some((frame) => hasToken(normalized, frame));
        },
    };
}
// Superficie de comandos PUBLICADA como dato, con nombre CALIFICADO por motor:
// los simbolos exportados deben ser unicos (un `HINT_FRAMES` por modulo choca).
export const QUIEN_SOY_COMMAND_FRAMES = Object.freeze({ SWAP_FRAMES, AFFIRMATIVE_FRAMES, NEGATIVE_FRAMES, HINT_FRAMES, SKIP_FRAMES, END_FRAMES })
