// ============================================================
// src/core/games/riddles.ts
// Adivinanzas (plan-juegos §4). Motor puro sin I/O.
//
// Banco local de 12 adivinanzas `{ pregunta, respuesta[], pista }`.
// Validación por keywords normalizadas (sin acentos, límites de
// palabra → "espera" NO responde "pera").
//
// Controles del jugador:
//   "pista" / "ayuda"        → pista de la adivinanza actual
//   "otra" / "siguiente"     → saltar a la siguiente
//   "sigo" / "no sé"         → saltar (no sabe la respuesta)
// Respuesta correcta → +1 punto, siguiente adivinanza.
// Incorrecta → reintenta la misma.
// Fin al alcanzar `rounds` adivinanzas.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';
import { END_GAME_FRAMES, HELP_CORE_FRAMES, adoptRandom, baseSession, gamePrompt, hasAnyToken, isEngineCommand, readRounds, runGuessTurn, shuffleOrder, turnResult } from './gameUtils';

export interface Riddle {
    pregunta: string;
    respuesta: string[];
    pista: string;
}

export const RIDDLE_BANK: readonly Riddle[] = Object.freeze([
    {
        pregunta: 'Soy una fruta con forma de gota, mi piel es verde o amarilla y por dentro soy blanca y jugosa',
        respuesta: ['pera'],
        pista: 'Es una fruta que empieza con la letra "pe".',
    },
    {
        pregunta: 'Tengo manecillas pero no soy un animal, y te digo la hora sin parar.',
        respuesta: ['reloj'],
        pista: 'Lo usas para no llegar tarde.',
    },
    {
        pregunta: 'Soy amarillo, me pela un mono y soy la fruta favorita de un gorila.',
        respuesta: ['platano', 'banana', 'guineo'],
        pista: 'Es una fruta larga y amarilla.',
    },
    {
        pregunta: 'Tengo hojas pero no soy un árbol, y dentro de mí hay historias por contar.',
        respuesta: ['libro'],
        pista: 'Lo abres para leer un cuento.',
    },
    {
        pregunta: 'Vuelo de noche, no tengo plumas y duermo colgado cabeza abajo.',
        respuesta: ['murcielago', 'vampiro'],
        pista: 'Es un animal que chilla y vuela de noche.',
    },
    {
        pregunta: 'Brillo de noche, cambio de forma y acompaño a las estrellas.',
        respuesta: ['luna'],
        pista: 'La ves en el cielo por la noche.',
    },
    {
        pregunta: 'Soy agua pero no me puedes beber, me pones al sol y desaparezco.',
        respuesta: ['hielo'],
        pista: 'Lo pones en el refresco para que esté frío.',
    },
    {
        pregunta: 'Tengo cuatro patas pero no camino, y en la comida me usas de apoyo.',
        respuesta: ['mesa'],
        pista: 'Ahí pones los platos para comer.',
    },
    {
        pregunta: 'Tengo muchas teclas pero no soy un piano, y conmigo escribes en la computadora.',
        respuesta: ['teclado'],
        pista: 'Sirve para escribir letras en la pantalla.',
    },
    {
        pregunta: 'Me pones en el cuerpo, tengo botones y mangas, y me quitas para dormir.',
        respuesta: ['camisa', 'camiseta', 'playera'],
        pista: 'Es una prenda de ropa que te pones arriba.',
    },
    {
        pregunta: 'Aparezco después de la lluvia, tengo siete colores y no puedes tocarme.',
        respuesta: ['arcoiris', 'arco iris'],
        pista: 'Aparezco en el cielo cuando llueve y brilla el sol.',
    },
    {
        pregunta: 'Tengo una llama arriba, me prenden en la torta y alumbro en la oscuridad.',
        respuesta: ['vela', 'candela'],
        pista: 'La apagas soplando después de pedir un deseo.',
    },
]);

const DEFAULT_ROUNDS = 3;
const MAX_ROUNDS = RIDDLE_BANK.length;

const HINT_FRAMES: readonly string[] = Object.freeze([
    ...HELP_CORE_FRAMES,
    'dame una pista', 'no se', 'no sé',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'otra', 'siguiente', 'otra adivinanza', 'sigo', 'paso', 'no se', 'no sé',
]);

const END_FRAMES: readonly string[] = END_GAME_FRAMES;

interface RiddlesState {
    order: number[];
    cursor: number;
    maxRounds: number;
    phase: 'announce' | 'done';
}

type RandomSource = () => number;

function riddleAt(state: RiddlesState): Riddle | null {
    const index = state.order[state.cursor];
    return index === undefined ? null : RIDDLE_BANK[index];
}

const currentPrompt = (state: RiddlesState) =>
    gamePrompt(state, riddleAt, (riddle) => `${riddle.pregunta} ¿Qué soy?`, 'Ya se me acabaron las adivinanzas.');

export function createRiddlesEngine(options?: { random?: RandomSource }): GameEngine<RiddlesState> {
    let rng: RandomSource = options?.random ?? Math.random;
    const buildState = (cfg: Record<string, unknown> | undefined): RiddlesState => {
        rng = adoptRandom(rng, cfg);
        return {
            order: shuffleOrder(rng, RIDDLE_BANK.length),
            cursor: 0,
            maxRounds: readRounds(cfg, DEFAULT_ROUNDS, MAX_ROUNDS),
            phase: 'announce',
        };
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): RiddlesState => {
        const state: RiddlesState = buildState(cfg);
        session.state = state;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'adivinanzas',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<RiddlesState> {
            return baseSession('adivinanzas', buildState(optionsConfig));
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            return turnResult(`¡Vamos a jugar a las adivinanzas! ${currentPrompt(session.state as RiddlesState)}`, session.score, { emotion: 'excited' });
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            return runGuessTurn<RiddlesState, NonNullable<ReturnType<typeof riddleAt>>>({
                session,
                state: session.state as RiddlesState,
                text,
                itemAt: riddleAt,
                matches: (normalized, riddle) => hasAnyToken(normalized, riddle.respuesta),
                hintFrames: HINT_FRAMES,
                skipFrames: SKIP_FRAMES,
                message: {
                    done: 'Ya terminamos las adivinanzas. ¿Jugamos otra vez?',
                    exhausted: ({ score }) => `¡Se acabaron las adivinanzas! Tu puntaje fue ${score}. ¡Muy bien!`,
                    hint: (riddle) => `Aquí va una pista: ${riddle.pista}`,
                    won: (riddle, { score, maxRounds }) =>
                        `¡Correcto, era ${riddle.respuesta[0]}! Completaste ${maxRounds} adivinanzas con ${score} puntos. ¡Eres muy listo!`,
                    correct: (riddle, next) =>
                        `¡Correcto, era ${riddle.respuesta[0]}! Siguiente: ${next ? next.pregunta : ''} ¿Qué soy?`,
                    skipped: (_riddle, next) => `¡Claro! Aquí va otra: ${next ? next.pregunta : ''} ¿Qué soy?`,
                    retry: (riddle) => `¡Casi! Inténtalo otra vez. ${riddle.pregunta} ¿Qué soy?`,
                },
            });
        },

        isGameCommand(text = ''): boolean {
            return isEngineCommand(text, { end: END_FRAMES, hint: HINT_FRAMES, skip: SKIP_FRAMES });
        },
    };
}
export const RIDDLES_COMMAND_FRAMES = Object.freeze({ HINT_FRAMES, SKIP_FRAMES, END_FRAMES })
