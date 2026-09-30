// ============================================================
// src/core/games/loteria.ts
// Lotería mexicana por VOZ — FLU es solo el CANTADOR.
// Motor puro sin I/O. Banco local de cartas `{ id, nombre, copla }`.
//
// Reglas REALES:
//   - Los CARTONES los tienen los jugadores; FLU no los conoce ni los crea.
//   - FLU canta el mazo carta por carta (copla).
//   - "ok flu repite" → repite la carta actual.
//   - "siguiente" / "otra" / "canta otra" → canta la siguiente.
//   - "ok flu lotería" → ALGUIEN ganó: FLU lo declara y termina la partida.
//   - No hay "la tengo"/"no la tengo", ni tablas internas, ni puntaje, ni
//     marcaje: nadie marca en voz alta, cada quien marca su cartón en silencio.
// Multijugador POR NATURALEZA: no importa QUIÉN hable; cualquier grito de
// "lotería" gana. No se necesita estado por jugador.
// ============================================================
import type { GameEngine } from './gameEngine';
import type { GameSession, GameTurnContext, GameTurnResult } from './types';
import { BARE_AFFIRMATION_FRAMES, END_GAME_FRAMES, HELP_CORE_FRAMES, RandomSource, adoptRandom, gameOverResult, hasAnyToken, hasGameOrderFrame, hasToken, isBareAffirmation, matchesEndGameFrames, normalizeForMatch, shuffleOrder, turnResult } from './gameUtils';

export interface LoteriaCard {
    id: string;
    nombre: string;
    copla: string;
}

export const LOTERIA_BANK: readonly LoteriaCard[] = Object.freeze([
    { id: 'el-gallo', nombre: 'El gallo', copla: 'El que la cantó a San Pedro.' },
    { id: 'el-diablo', nombre: 'El diablo', copla: 'Pórtate bien, cuatito. Si no, te lleva el coloradito.' },
    { id: 'la-dama', nombre: 'La dama', copla: 'Puliendo el paso por toda la calle real.' },
    { id: 'el-catrin', nombre: 'El catrín', copla: 'Don Ferruco en la alameda, su bastón quería tirar.' },
    { id: 'el-paraguas', nombre: 'El paraguas', copla: 'Para el sol y para el agua.' },
    { id: 'la-sirena', nombre: 'La sirena', copla: 'Medio cuerpo de señora se divisa en altamar.' },
    { id: 'la-escalera', nombre: 'La escalera', copla: 'Súbeme paso a pasito. No quieras pegar brinquitos.' },
    { id: 'la-botella', nombre: 'La botella', copla: 'La herramienta del borracho.' },
    { id: 'el-barril', nombre: 'El barril', copla: 'Tanto bebió el albañil que quedó como barril.' },
    { id: 'el-arbol', nombre: 'El árbol', copla: 'El que a buen árbol se arrima, buena sombra le cobija.' },
    { id: 'el-melon', nombre: 'El melón', copla: 'Me lo das o me lo quitas.' },
    { id: 'el-valiente', nombre: 'El valiente', copla: '¿Por qué le corres, cobarde, trayendo tan buen puñal?' },
    { id: 'el-gorrito', nombre: 'El gorrito', copla: 'El gorrito que me ponen.' },
    { id: 'la-muerte', nombre: 'La muerte', copla: 'La muerte siriqui siaca.' },
    { id: 'la-pera', nombre: 'La pera', copla: 'El que espera, desespera.' },
    { id: 'la-bandera', nombre: 'La bandera', copla: 'Verde, blanco y colorado. La bandera del soldado.' },
    { id: 'el-bandolon', nombre: 'El bandolón', copla: 'Tocando su bandolón, está el mariachi Simón.' },
    { id: 'el-violonchelo', nombre: 'El violonchelo', copla: 'Creciendo se fue hasta el cielo, y como no fue violín, tuvo que ser violonchelo.' },
    { id: 'la-garza', nombre: 'La garza', copla: 'Al otro lado del río tengo mi banco de arena, donde se sienta mi chata pico de garza morena.' },
    { id: 'el-pajaro', nombre: 'El pájaro', copla: 'Tú me traes a puros brincos, como pájaro en la rama.' },
    { id: 'la-mano', nombre: 'La mano', copla: 'La mano de un criminal.' },
    { id: 'la-bota', nombre: 'La bota', copla: "Una bota igual que l'otra." },
    { id: 'la-luna', nombre: 'La luna', copla: 'El farol de los enamorados.' },
    { id: 'el-cotorro', nombre: 'El cotorro', copla: 'Cotorro, cotorro, saca la pata y empiézame a platicar.' },
    { id: 'el-borracho', nombre: 'El borracho', copla: '¡Ah, qué borracho tan necio! Ya no lo puedo aguantar.' },
    { id: 'el-negrito', nombre: 'El negrito', copla: 'El que se comió el azúcar.' },
    { id: 'el-corazon', nombre: 'El corazón', copla: 'No me extrañes, corazón, que regreso en el camión.' },
    { id: 'la-sandia', nombre: 'La sandía', copla: 'La barriga que Juan tenía era empacho de sandía.' },
    { id: 'el-tambor', nombre: 'El tambor', copla: "No te arrugues, cuero viejo, que te quiero pa'tambor." },
    { id: 'el-camaron', nombre: 'El camarón', copla: 'Camarón que se duerme, se lo lleva la corriente.' },
    { id: 'las-jaras', nombre: 'Las jaras', copla: 'Las jaras del indio Adán, donde pegan, dan.' },
    { id: 'el-musico', nombre: 'El músico', copla: 'El músico trompa de hule ya no me quiere tocar.' },
    { id: 'la-arana', nombre: 'La araña', copla: 'Atarántamela a palos. No me la dejes llegar.' },
    { id: 'el-soldado', nombre: 'El soldado', copla: "Uno, dos y tres. El soldado p'al cuartel." },
    { id: 'la-estrella', nombre: 'La estrella', copla: 'La guía de los marineros.' },
    { id: 'el-cazo', nombre: 'El cazo', copla: 'El caso que te hago es poco.' },
    { id: 'el-mundo', nombre: 'El mundo', copla: 'Este mundo es una bola y nosotros un balón.' },
    { id: 'el-apache', nombre: 'El apache', copla: '¡Ah, Chihuahua! Cuánto apache con pantalón y huarache.' },
    { id: 'el-nopal', nombre: 'El nopal', copla: 'Al nopal lo van a ver nomás cuando tiene tunas.' },
    { id: 'el-alacran', nombre: 'El alacrán', copla: 'El que con la cola pica, le dan una paliza.' },
    { id: 'la-rosa', nombre: 'La rosa', copla: 'Rosita, Rosaura, ven que te quiero ahora.' },
    { id: 'la-calavera', nombre: 'La calavera', copla: 'Al pasar por el panteón, me encontré un calaverón.' },
    { id: 'la-campana', nombre: 'La campana', copla: 'Tú con la campana y yo con tu hermana.' },
    { id: 'el-cantarito', nombre: 'El cantarito', copla: 'Tanto va el cántaro al agua que se quiebra y te moja las enaguas.' },
    { id: 'el-venado', nombre: 'El venado', copla: 'Saltando va buscando, pero no ve nada.' },
    { id: 'el-sol', nombre: 'El sol', copla: 'Solo solo te quedaste de cobija de los pobres.' },
    { id: 'la-corona', nombre: 'La corona', copla: 'El sombrero de los reyes.' },
    { id: 'la-chalupa', nombre: 'La chalupa', copla: 'Rema rema va Lupita sentada en su chalupita.' },
    { id: 'el-pino', nombre: 'El pino', copla: 'Fresco y oloroso en todo tiempo hermoso.' },
    { id: 'el-pescado', nombre: 'El pescado', copla: 'El que por la boca muere, aunque mudo fuere.' },
    { id: 'la-palma', nombre: 'La palma', copla: 'Palmero sube a la palma y bájame un coco real.' },
    { id: 'la-maceta', nombre: 'La maceta', copla: "El que nace pa'maceta, no sale del corredor." },
    { id: 'el-arpa', nombre: 'El arpa', copla: "Arpa vieja de mi suegra, ya no sirves pa'tocar." },
    { id: 'la-rana', nombre: 'La rana', copla: 'Al ver a la verde rana, qué brinco pegó tu hermana.' },
]);

const REPEAT_FRAMES: readonly string[] = Object.freeze([
    'repite', 'repetir', ...HELP_CORE_FRAMES,
    'no escuche', 'no escuché', 'otra vez',
]);

// Órdenes de avance PROPIAS de la lotería. Las afirmaciones sueltas ("sí",
// "dale", "adelante") NO se re-enumeran aquí: en la lotería el jugador no
// "responde", un "sí"/"continúa" significa "canta la siguiente", pero el
// CONJUNTO de afirmaciones tiene dueño único (`BARE_AFFIRMATION_FRAMES`), así
// que se compone. Re-enumerarlo era una segunda copia del mismo dato.
const OWN_ORDERS: readonly string[] = Object.freeze([
    'siguiente', 'otra', 'canta otra', 'siguiente carta', 'paso', 'sigo', 'otra carta', 'next',
]);

const NEXT_FRAMES: readonly string[] = Object.freeze([...OWN_ORDERS, ...BARE_AFFIRMATION_FRAMES]);

const END_FRAMES: readonly string[] = END_GAME_FRAMES;

interface LoteriaState {
    /** Orden del MAZO (cantadas): permutación completa del banco. */
    order: number[];
    cursor: number;
    /** Participante que gritó lotería (si lo hay). */
    winner: string | null;
    phase: 'announce' | 'done';
}

function cardAt(state: LoteriaState): LoteriaCard | null {
    const index = state.order[state.cursor];
    return index === undefined ? null : LOTERIA_BANK[index];
}

function cantarPrompt(state: LoteriaState, intro = 'Siguiente carta: '): string {
    const card = cardAt(state);
    if (!card) return 'Ya se me acabaron las cartas.';
    return `${intro}${card.copla}`;
}

export function createLoteriaEngine(options?: { random?: RandomSource }): GameEngine<LoteriaState> {
    let rng: RandomSource = options?.random ?? Math.random;

    const buildState = (cfg: Record<string, unknown> | undefined): LoteriaState => {
        rng = adoptRandom(rng, cfg);
        return {
            order: shuffleOrder(rng, LOTERIA_BANK.length),
            cursor: 0,
            winner: null,
            phase: 'announce',
        };
    };

    const advanceFrom = (state: LoteriaState, session: GameSession): GameTurnResult => {
        state.cursor += 1;
        if (!cardAt(state)) {
            state.phase = 'done';
            return gameOverResult(
                    '¡Se acabaron las cartas! ¿Jugamos otra vez?',
                    session.score,
                    { emotion: 'encouraging' },
                );
        }
        return turnResult(cantarPrompt(state), session.score);
    };

    return {
        id: 'loteria',

        createSession(optionsConfig: Record<string, unknown> = {}): GameSession<LoteriaState> {
            return {
                id: 'loteria',
                state: buildState(optionsConfig),
                score: 0,
                round: 1,
            };
        },

        start(session: GameSession, optionsConfig: Record<string, unknown> = {}): GameTurnResult {
            const state = buildState(optionsConfig);
            session.state = state;
            session.score = 0;
            session.round = 1;
            const first = cardAt(state);
            return turnResult(`¡Vamos a jugar a la lotería! Yo canto las cartas y cada quien marca su cartón. Primera carta: ${first ? first.copla : ''}`, session.score, { emotion: 'excited' });
        },

        turn(session: GameSession, text = '', context?: GameTurnContext): GameTurnResult {
            const state = session.state as LoteriaState;

            if (state.phase === 'done') {
                return gameOverResult(
                    state.winner
                        ? `¡${state.winner} ganó la lotería! ¿Jugamos otra vez?`
                        : 'Ya terminamos la lotería. ¿Jugamos otra vez?',
                    session.score,
                );
            }

            const card = cardAt(state);
            if (!card) {
                state.phase = 'done';
                return advanceFrom(state, session);
            }

            const normalized = normalizeForMatch(text);

            // "¡Lotería!" → alguien completó su cartón: gana.
            // El GRITO de victoria es "loterA-a" SUELTO. Una ORDEN DE ARRANQUE
            // ("vamos a jugar loterA-a") contiene la misma palabra y NO es un grito:
            // consumirla declaraba ganador con UNA carta cantada (defecto medido).
            if (hasToken(normalized, 'loteria') && !hasGameOrderFrame(normalized)) {
                state.phase = 'done';
                // Nombre legible si viene; si no, el id SOLO si no es un UUID crudo.
                const rawName = String(context?.playerName || '').trim();
                const rawId = String(context?.playerId || '').trim();
                const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                    rawId,
                );
                state.winner = rawName || (rawId && !uuidLike ? rawId : '') || null;
                return gameOverResult(
                    state.winner
                        ? `¡LOTERÍA! ¡Ganó ${state.winner}! ¡A celebrar!`
                        : '¡LOTERÍA! ¡Ganaste! ¡A celebrar!',
                    session.score,
                    { won: true, valid: true, animation: 'Dance' },
                );
            }

            // "repite" / "pista" → repetir la carta actual.
            if (hasAnyToken(normalized, REPEAT_FRAMES)) {
                return turnResult(`La carta es: ${card.nombre}. ${card.copla}`, session.score, { emotion: 'thinking' });
            }

            // "siguiente" / "otra" → canta la siguiente.
            if (hasAnyToken(normalized, NEXT_FRAMES)) {
                session.round += 1;
                return advanceFrom(state, session);
            }

            // No entendió → repite la carta actual.
            return turnResult(`La carta es: ${card.nombre}. ${card.copla}`, session.score, { emotion: 'encouraging', error: 'respuesta no reconocida' });
        },

        isGameCommand(text = ''): boolean {
            const normalized = normalizeForMatch(text);
            return matchesEndGameFrames(normalized, END_FRAMES)
                || REPEAT_FRAMES.some((frame) => hasToken(normalized, frame))
                || NEXT_FRAMES.some((frame) => hasToken(normalized, frame))
                || (hasToken(normalized, 'loteria') && !hasGameOrderFrame(normalized));
        },

        // La VOZ del juego puede RETOMAR una partida en pausa con una orden
        // explicita ("siguiente carta", "pista", "repite"). El grito de victoria
        // NO es una orden: en pausa no retoma (sigue siendo del turno de su dueno).
        isExplicitOrder(text = ''): boolean {
            const normalized = normalizeForMatch(text);
            if (hasToken(normalized, 'loteria') && !hasGameOrderFrame(normalized)) return false;
            if (matchesEndGameFrames(normalized, END_FRAMES)) return true;
            if (REPEAT_FRAMES.some((frame) => hasToken(normalized, frame))) return true;
            return NEXT_FRAMES.some((frame) => hasToken(normalized, frame)) && !isBareAffirmation(normalized);
        },
    };
}
// Superficie de comandos PUBLICADA como dato, con nombre CALIFICADO por motor:
// los simbolos exportados deben ser unicos (un `HINT_FRAMES` por modulo choca).
export const LOTERIA_COMMAND_FRAMES = Object.freeze({ REPEAT_FRAMES, NEXT_FRAMES, END_FRAMES })
