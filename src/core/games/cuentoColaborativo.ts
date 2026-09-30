// ============================================================
// src/core/games/cuentoColaborativo.ts
// Cuento colaborativo (plan-juegos §Fase 3, Riesgo 3).
// Motor puro sin I/O.
//
// FLU y el niño inventan un cuento turno a turno. FLU abre con
// un inicio del banco local y va hilando frases; el niño agrega
// sus propias oraciones (cualquier texto libre es una aportación).
//
// El banco local SIEMPRE permite continuar de forma determinista
// (Riesgo 4: no depende de Gemini para avanzar). En el catálogo se
// marca `requiresApi: true` para que la capa de App pueda enriquecer
// la historia con Gemini cuando esté disponible; si no, el motor
// local basta.
//
// Controles:
//   "pista" / "ayuda"      → FLU continúa la historia
//   "paso" / "sigue"       → FLU continúa la historia
// Fin al completar `turnos` oraciones (contando el inicio).
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnResult } from './types';
import { END_GAME_FRAMES, HELP_CORE_FRAMES, adoptRandom, clamp, gameOverResult, hasAnyToken, matchesEndGameFrames, normalizeForMatch, turnResult } from './gameUtils';

export interface CuentoItem {
    inicio: string;
    continuaciones: readonly string[];
    cierre: string;
}

export const CUENTO_BANK: readonly CuentoItem[] = Object.freeze([
    {
        inicio: 'Había una vez un conejito llamado Tito que vivía en un bosque mágico.',
        continuaciones: Object.freeze([
            'Tito encontró una zanahoria gigante que brillaba con luz propia.',
            'De pronto, escuchó un ruido suave detrás de un árbol grande.',
            'Una mariposa azul lo invitó a seguirla por el sendero.',
            'Caminaron juntos hasta un río de colores que cantaba.',
            'Al otro lado del río había un castillo hecho de dulces.',
            'El castillo lo cuidaba un dragón amigable que sonreía.',
            'El dragón les ofreció compartir su tesoro de estrellas.',
            'Tito y sus amigos volvieron a casa con el bolsillo lleno de sueños.',
        ]),
        cierre: 'Y colorín colorado, este cuento se ha acabado.',
    },
    {
        inicio: 'En un pequeño pueblo, una gatita llamada Luna soñaba con volar.',
        continuaciones: Object.freeze([
            'Una noche, una estrella fugaz le regaló unas alas brillantes.',
            'Luna voló sobre las casas y saludó a todos los vecinos.',
            'Conoció a un búho sabio que le enseñó a planear despacio.',
            'Juntos descubrieron una nube con forma de corazón.',
            'La nube la llevó hasta el arcoíris más hermoso que había visto.',
            'Desde arriba vio su casa y a su familia esperándola.',
            'Luna aprendió que volar es bonito, pero volver a casa es mejor.',
        ]),
        cierre: 'Y desde esa noche, Luna voló cada vez que quiso.',
    },
]);

const DEFAULT_TURNOS = 4;
const MAX_TURNOS = 8;

const HINT_FRAMES: readonly string[] = Object.freeze([
    ...HELP_CORE_FRAMES,
    'no se', 'no sé', 'sigue tu', 'tu sigue',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'paso', 'sigue', 'continuemos', 'que sigue', 'luego', 'adelante', 'y luego',
]);

const END_FRAMES: readonly string[] = END_GAME_FRAMES;

type RandomSource = () => number;

interface CuentoColaborativoState {
    cuento: string[];
    cierre: string;
    continuaciones: readonly string[];
    maxTurnos: number;
    phase: 'announce' | 'done';
}

function closePrompt(state: CuentoColaborativoState, _score: number): string {
    const historia = state.cuento.join(' ');
    return `¡Nuestro cuento está completo! ${historia} ${state.cierre} Fin de nuestro cuento. ¿Te gustó cómo quedó?`;
}

export function createCuentoColaborativoEngine(options?: { random?: RandomSource }): GameEngine<CuentoColaborativoState> {
    let rng: RandomSource = options?.random ?? Math.random;

    const readTurnos = (cfg: Record<string, unknown> | undefined): number => {
        const turnos = Number(cfg?.turnos) || Number(cfg?.defaultTurnos) || DEFAULT_TURNOS;
        return clamp(turnos, 2, MAX_TURNOS);
    };

    const buildState = (cfg: Record<string, unknown> | undefined): CuentoColaborativoState => {
        rng = adoptRandom(rng, cfg);
        const item = CUENTO_BANK[Math.floor(rng() * CUENTO_BANK.length)];
        return {
            cuento: [item.inicio],
            cierre: item.cierre,
            continuaciones: item.continuaciones,
            maxTurnos: readTurnos(cfg),
            phase: 'announce',
        };
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): CuentoColaborativoState => {
        const state: CuentoColaborativoState = buildState(cfg);
        session.state = state;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'cuento_colaborativo',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<CuentoColaborativoState> {
            return {
                id: 'cuento_colaborativo',
                state: buildState(optionsConfig),
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as CuentoColaborativoState;
            return turnResult(`¡Vamos a inventar un cuento juntos! Yo empiezo: "${state.cuento[0]}" ¿Qué pasa después?`, session.score, { emotion: 'excited' });
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as CuentoColaborativoState;

            if (state.phase === 'done') {
                return gameOverResult('Ya terminamos nuestro cuento. ¿Inventamos otro?', session.score);
            }

            const normalized = normalizeForMatch(text);

            // ¿Pide pista o que FLU continúe? Solo si la frase ES el control: el
            // texto libre del niño que contenga "sigue"/"luego" debe ser aportación.
            const isControl = HINT_FRAMES.includes(normalized) || SKIP_FRAMES.includes(normalized);
            if (isControl) {
                const frase = state.continuaciones[Math.floor(rng() * state.continuaciones.length)];
                state.cuento.push(frase);
                if (state.cuento.length >= state.maxTurnos) {
                    state.phase = 'done';
                    return gameOverResult(closePrompt(state, session.score), session.score, {
                        animation: 'Dance',
                    });
                }
                return turnResult(`Yo continúo: "${frase}" ¿Y luego qué pasa?`, session.score, { emotion: 'thinking' });
            }

            // El niño aporta su propia oración.
            const aporte = text.trim();
            if (aporte) {
                state.cuento.push(aporte);
                session.score += 1;
                session.round += 1;
                if (state.cuento.length >= state.maxTurnos) {
                    state.phase = 'done';
                    return gameOverResult(closePrompt(state, session.score), session.score, {
                        won: true,
                        valid: true,
                        animation: 'Dance',
                    });
                }
                return turnResult(`¡Qué bonita frase! La agrego a nuestro cuento: "${aporte}" ¿Y luego qué pasa?`, session.score, { valid: true, animation: 'Jump_in_place', emotion: 'happy' });
            }

            return turnResult(`Cuéntame qué pasa en nuestra historia. ${state.cuento[state.cuento.length - 1]} ¿Y luego?`, session.score, { emotion: 'encouraging', error: 'texto vacío' });
        },

        isGameCommand(text = ''): boolean {
            const normalized = normalizeForMatch(text);
            return matchesEndGameFrames(normalized, END_FRAMES)
                || HINT_FRAMES.some((frame) => hasAnyToken(normalized, [frame]))
                || SKIP_FRAMES.some((frame) => hasAnyToken(normalized, [frame]));
        },
    };
}
// Superficie de comandos PUBLICADA como dato, con nombre CALIFICADO por motor:
// los simbolos exportados deben ser unicos (un `HINT_FRAMES` por modulo choca).
export const CUENTO_COLABORATIVO_COMMAND_FRAMES = Object.freeze({ HINT_FRAMES, SKIP_FRAMES, END_FRAMES })
