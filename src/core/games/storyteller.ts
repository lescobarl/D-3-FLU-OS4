// ============================================================
// src/core/games/storyteller.ts
// Cuentacuentos (plan-juegos §Fase 4, "Cambios necesarios" §4).
// Define el CONTRATO de cuento: escenas `{ texto, animacion, emocion }`
// con `escenasMax` (cfg `cuentacuentos.escenasMax`, default 4).
//
// Motor puro sin I/O con banco local determinista (Riesgo 4: los
// juegos deterministas nunca dependen de Gemini). FLU también puede
// ingerir escenas externas (contrato narrate de Gemini) vía
// `engine.narrate(session, scenes, cfg)`.
//
// Flujo:
//   start   → elige un cuento local y anuncia título + primera escena
//   turn    → "sigue"/"y luego" avanza a la siguiente escena
//   narrate → sustituye el cuento por escenas externas (Gemini)
//   Fin al narrar la última escena ("colorín colorado").
// ============================================================
import type { GameEngine } from './gameEngine';
import type { AvatarAnimation, GameNarrativeScene, GameSession, GameTurnResult } from './types';
import {
    RandomSource,
    clamp,
    normalizeForMatch,
    hasToken,
    hasAnyToken,
    pickRandom,
} from './gameUtils';

export type StoryScene = GameNarrativeScene;

export interface Story {
    titulo: string;
    escenas: StoryScene[];
}

export const DEFAULT_ESCENAS_MAX = 4;

export const STORY_BANK: readonly Story[] = Object.freeze([
    {
        titulo: 'El conejito que perdió sus orejas',
        escenas: [
            { texto: 'Había una vez un conejito llamado Bunny que una mañana despertó sin sus orejas.', animacion: 'Idle', emocion: 'curious' },
            { texto: 'Bunny buscó por toda la casa: debajo de la cama, en el cajón de los calcetines y hasta en la taza de zanahorias.', animacion: 'Walk', emocion: 'thinking' },
            { texto: 'De pronto vio a su amiga la ardilla saltando muy feliz... ¡con las orejas de Bunny puestas como si fueran alas!', animacion: 'Jump_in_place', emocion: 'happy' },
            { texto: 'La ardilla se las devolvió con una sonrisa y desde entonces Bunny guarda sus orejas en una caja muy especial. Colorín colorado, este cuento se ha acabado.', animacion: 'Dance', emocion: 'happy' },
        ],
    },
    {
        titulo: 'La estrella que quería jugar',
        escenas: [
            { texto: 'En el cielo vivía una estrellita que estaba muy aburrida de brillar solita todas las noches.', animacion: 'Idle', emocion: 'sad' },
            { texto: 'Una noche bajó despacito a la Tierra y aterrizó justo en el patio de una niña llamada Sofía.', animacion: 'Walk', emocion: 'curious' },
            { texto: 'Sofía y la estrellita jugaron a las escondidas entre las flores y rieron sin parar hasta que salió el sol.', animacion: 'Jump_in_place', emocion: 'excited' },
            { texto: 'La estrellita volvió a su lugar en el cielo, pero cada noche le guiña un ojo a Sofía. Colorín colorado, este cuento se ha acabado.', animacion: 'Dance', emocion: 'happy' },
        ],
    },
    {
        titulo: 'El dragón que le daba miedo el fuego',
        escenas: [
            { texto: 'En la montaña vivía un dragón llamado Dante que era enorme y fuerte, pero le daba muchísimo miedo el fuego.', animacion: 'Idle', emocion: 'curious' },
            { texto: 'Cuando sus amigos le pedían que lanzara una llamita para encender la fogata, Dante temblaba y se escondía.', animacion: 'Walk', emocion: 'sad' },
            { texto: 'Un día, un pajarito le enseñó que el fuego no da miedo si se usa con cuidado y siempre con un adulto cerca.', animacion: 'Jump_in_place', emocion: 'excited' },
            { texto: 'Dante aprendió a encender velitas para las tortas de cumpleaños y se volvió el dragón más querido del valle. Colorín colorado, este cuento se ha acabado.', animacion: 'Dance', emocion: 'happy' },
        ],
    },
    {
        titulo: 'La tortuga que no se rendía',
        escenas: [
            { texto: 'En el bosque vivía una tortuguita llamada Tula que soñaba con ganar la carrera del estanque.', animacion: 'Idle', emocion: 'curious' },
            { texto: 'Tula era lenta, pero cada mañana practicaba un poquito más, aunque los conejos se burlaran de ella.', animacion: 'Walk', emocion: 'sad' },
            { texto: 'El día de la carrera, Tula no llegó primera, pero no se rindió y cruzó la meta con una gran sonrisa.', animacion: 'Walk', emocion: 'happy' },
            { texto: 'Todos aplaudieron su esfuerzo y Tula entendió que lo importante no es llegar rápido, sino no rendirse nunca. Colorín colorado, este cuento se ha acabado.', animacion: 'Dance', emocion: 'happy' },
        ],
    },
    {
        titulo: 'El robot que quería aprender',
        escenas: [
            { texto: '{nombre} encontró en el desván un robot viejito llamado Robi que parpadeaba con curiosidad.', animacion: 'Idle', emocion: 'curious' },
            { texto: 'Robi no sabía sumar ni leer, pero {nombre} le enseñó las letras del abecedario con mucha paciencia.', animacion: 'Walk', emocion: 'thinking' },
            { texto: 'Cada tarde jugaban a contar estrellas y Robi aprendió tan rápido que sorprendió a todos.', animacion: 'Jump_in_place', emocion: 'excited' },
            { texto: 'Ahora Robi y {nombre} son inseparables: juntos resuelven adivinanzas y sueñan con nuevos inventos. Colorín colorado, este cuento se ha acabado.', animacion: 'Dance', emocion: 'happy' },
        ],
    },
    {
        titulo: 'El tesoro del jardín',
        escenas: [
            { texto: '{nombre} encontró en el jardín de la abuela un mapa dibujado con tiza que señalaba un tesoro escondido.', animacion: 'Idle', emocion: 'curious' },
            { texto: 'Siguiendo las pistas, {nombre} cruzó el sendero de los girasoles y encontró una cajita bajo el rosal.', animacion: 'Walk', emocion: 'thinking' },
            { texto: 'Dentro había semillas mágicas de colores y una nota que decía: "Plántalas y comparte su belleza".', animacion: 'Jump_in_place', emocion: 'excited' },
            { texto: '{nombre} plantó las semillas junto a la abuela y el jardín floreció como nunca. Colorín colorado, este cuento se ha acabado.', animacion: 'Dance', emocion: 'happy' },
        ],
    },
]);

const HINT_FRAMES: readonly string[] = Object.freeze([
    'pista', 'ayuda', 'ayudame', 'no se', 'no sé',
]);

const SKIP_FRAMES: readonly string[] = Object.freeze([
    'sigue', 'siguiente', 'y luego', 'y despues', 'continua', 'continúa', 'otro cuento', 'otra historia',
]);

const END_FRAMES: readonly string[] = Object.freeze([
    'salir del juego',
    'terminar el juego',
    'dejar de jugar',
    'ya no quiero jugar',
    'cerrar el juego',
    'fin del cuento',
]);

const KNOWN_ANIMATIONS: readonly string[] = Object.freeze([
    'Dance', 'Run', 'Walk', 'Jump_in_place', 'Idle',
]);

/** Sanitiza escenas del contrato externo: filtra sin texto, normaliza y acota a escenasMax. */
export function sanitizeScenes(
    scenes: readonly StoryScene[] | undefined,
    escenasMax = DEFAULT_ESCENAS_MAX,
): StoryScene[] {
    if (!Array.isArray(scenes)) return [];
    const capped = clamp(scenes.length, 0, escenasMax);
    const clean: StoryScene[] = [];
    for (let index = 0; index < capped; index += 1) {
        const scene = scenes[index];
        if (!scene || typeof scene.texto !== 'string' || !scene.texto.trim()) continue;
        const sanitized: StoryScene = { texto: scene.texto.trim() };
        if (typeof scene.animacion === 'string' && scene.animacion.trim()) {
            sanitized.animacion = scene.animacion.trim();
        }
        if (typeof scene.emocion === 'string' && scene.emocion.trim()) {
            sanitized.emocion = scene.emocion.trim();
        }
        clean.push(sanitized);
    }
    return clean;
}

/**
 * Personaliza un cuento con el nombre de un participante (F2).
 * Sustituye el token `{nombre}` en título y escenas; si el título no
 * lleva token, lo antepone ("Un cuento para {nombre}: ...").
 * Sin participante devuelve el cuento sin cambios (determinista).
 */
export function personalizeStory(story: Story, participantName?: string): Story {
    const name = (participantName ?? '').trim();
    if (!name) return story;
    const token = /\{nombre\}/gi;
    const replace = (text: string): string => text.replace(token, name);
    const titulo = /\{nombre\}/i.test(story.titulo)
        ? replace(story.titulo)
        : `Un cuento para ${name}: ${story.titulo}`;
    return {
        titulo,
        escenas: story.escenas.map((scene) => ({ ...scene, texto: replace(scene.texto) })),
    };
}

interface StorytellerState {
    escenas: StoryScene[];
    cursor: number;
    maxEscenas: number;
    phase: 'announce' | 'narrating' | 'done';
    titulo: string;
    source: 'local' | 'external';
}

function readEscenasMax(cfg: Record<string, unknown> | undefined): number {
    const value = Number(cfg?.escenasMax) || Number(cfg?.maxEscenas) || DEFAULT_ESCENAS_MAX;
    return clamp(value, 1, 12);
}

function toAnimation(value: string | undefined): AvatarAnimation {
    return value && KNOWN_ANIMATIONS.includes(value) ? (value as AvatarAnimation) : 'Idle';
}

function sceneResult(state: StorytellerState, scene: StoryScene, titlePrefix = ''): GameTurnResult {
    const isLast = state.cursor + 1 >= state.escenas.length;
    return {
        prompt: `${titlePrefix}${scene.texto}`,
        valid: false,
        gameOver: isLast,
        score: 0,
        animation: toAnimation(scene.animacion),
        emotion: scene.emocion || 'neutral',
    };
}

export function createCuentacuentosEngine(options?: { random?: RandomSource }): GameEngine {
    let rng: RandomSource = options?.random ?? Math.random;

    const buildState = (cfg: Record<string, unknown> | undefined): StorytellerState => {
        if (cfg && typeof cfg.random === 'function') {
            rng = cfg.random as RandomSource;
        }
        const raw = pickRandom(STORY_BANK, rng);
        const participantName = typeof cfg?.participantName === 'string' ? cfg.participantName : '';
        const story = personalizeStory(raw, participantName);
        return {
            escenas: sanitizeScenes(story.escenas, readEscenasMax(cfg)),
            cursor: 0,
            maxEscenas: readEscenasMax(cfg),
            phase: 'announce',
            titulo: story.titulo,
            source: 'local',
        };
    };

    const reset = (session: GameSession, cfg: Record<string, unknown> | undefined): StorytellerState => {
        const state = buildState(cfg);
        session.state = state as unknown as Record<string, unknown>;
        session.score = 0;
        session.round = 1;
        return state;
    };

    return {
        id: 'cuentacuentos',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession {
            const state = buildState(optionsConfig);
            return {
                id: 'cuentacuentos',
                state: state as unknown as Record<string, unknown>,
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            reset(session, optionsConfig);
            const state = session.state as unknown as StorytellerState;
            const scene = state.escenas[0];
            if (!scene) {
                state.phase = 'done';
                return {
                    prompt: 'No tengo ningún cuento preparado ahora. ¿Jugamos otra cosa?',
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                };
            }
            state.phase = 'narrating';
            return {
                prompt: `¡Vamos a contar un cuento! Se llama "${state.titulo}". ${scene.texto}`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: toAnimation(scene.animacion),
                emotion: scene.emocion || 'excited',
            };
        },

        turn(session: GameSession, text = ''): GameTurnResult {
            const state = session.state as unknown as StorytellerState;

            if (state.phase === 'done') {
                return {
                    prompt: 'Ya terminamos el cuento. ¿Jugamos otra cosa?',
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'happy',
                };
            }

            const normalized = normalizeForMatch(text);

            // ¿Pide ayuda? (solo repite la instrucción)
            if (hasAnyToken(normalized, HINT_FRAMES)) {
                return {
                    prompt: 'Solo dime "sigue" para que continúe el cuento, o "terminar el juego" si quieres parar.',
                    valid: false,
                    gameOver: false,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'thinking',
                };
            }

            // ¿Avanza a la siguiente escena?
            if (hasAnyToken(normalized, SKIP_FRAMES)) {
                state.cursor += 1;
                const scene = state.escenas[state.cursor];
                if (!scene) {
                    state.phase = 'done';
                    return {
                        prompt: 'Y colorín colorado, este cuento se ha acabado. ¡Me encantó contarlo contigo!',
                        valid: false,
                        gameOver: true,
                        score: session.score,
                        animation: 'Dance',
                        emotion: 'happy',
                    };
                }
                return sceneResult(state, scene);
            }

            // No reconoció → invita a seguir.
            return {
                prompt: '¿Quieres que siga el cuento? Dime "sigue".',
                valid: false,
                gameOver: false,
                score: session.score,
                animation: 'Idle',
                emotion: 'encouraging',
                error: 'respuesta no reconocida',
            };
        },

        narrate(session: GameSession, scenes: GameNarrativeScene[], optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            if (optionsConfig && typeof optionsConfig.random === 'function') {
                rng = optionsConfig.random as RandomSource;
            }
            const state: StorytellerState = {
                escenas: sanitizeScenes(scenes, readEscenasMax(optionsConfig)),
                cursor: 0,
                maxEscenas: readEscenasMax(optionsConfig),
                phase: 'narrating',
                titulo: 'un cuento especial',
                source: 'external',
            };
            session.state = state as unknown as Record<string, unknown>;
            session.score = 0;
            session.round = 1;
            const scene = state.escenas[0];
            if (!scene) {
                state.phase = 'done';
                return {
                    prompt: 'No recibí las escenas del cuento. Prueba de nuevo o pídeme un cuento de mi libro.',
                    valid: false,
                    gameOver: true,
                    score: session.score,
                    animation: 'Idle',
                    emotion: 'neutral',
                    error: 'cuento vacío',
                };
            }
            return {
                prompt: `Vamos a contar ${state.titulo}. ${scene.texto}`,
                valid: false,
                gameOver: false,
                score: session.score,
                animation: toAnimation(scene.animacion),
                emotion: scene.emocion || 'excited',
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
