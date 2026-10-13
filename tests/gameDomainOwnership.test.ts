// ============================================================
// EL DOMINIO DE JUEGOS TIENE DUENO PARA TODA ORDEN DE JUEGO.
// (y la salida, la pausa, el eco y la fila valen para TODOS los juegos)
//
// POR QUE EXISTE (medido, log del dueno 2026-09-28 18:11:56-18:12:47; sonda
// temporal sobre las funciones REALES, borrada tras medir):
//   - 'vamos a jugar Adivina quien' no la reconoce NADIE: intent=null, bare=null,
//     gameCmd=null, domain=null. La contesta el LLM, que ANUNCIA la partida
//     ("Claro! Vamos a jugar a Adivina quien") sin que exista partida.
//   - con la loteria activa esa misma orden se consume como JUGADA del motor
//     (los marcos del motor son tokens sueltos: 'vamos' esta en NEXT_FRAMES).
//   - con la loteria EN PAUSA, 'si' / 'dale' / 'adelante' la retoman y se comen
//     el turno.
//   - el eco de la COLA del TTS entra como turno de persona.
//   - una locucion reemitida abre FILA DUPLICADA.
//
// REGLA VIGILADA (una sola, para todos los juegos y todas las puertas):
//   "toda orden de juego tiene dueno, ningun turno se pierde y ningun juego se
//    inventa". El catalogo es la UNICA puerta de entrada.
//
// Este guard NO repite el muro del nombre CONOCIDO con partida activa
// (gameStartRequestNotInGameAction.test.ts) ni el del turno ajeno (P7.48):
// esos siguen siendo suyos. Aqui se vigila el hueco que quedo abierto.
// ============================================================
import { readFileSync } from 'node:fs';
import { describe, test, expect, afterEach, beforeEach } from 'vitest';
import {
    resolveGameCommandFromText,
    consumesGameTurn,
} from '../src/voice/lib/gameCommands';
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter';
import { GAME_IDS } from '../src/core/games/gameCatalog';
import {
    setActiveGameSession,
    clearActiveGameSession,
    suspendActiveGameSession,
    noteGameTurn,
    isGameSuspended,
    getActiveGameSession,
} from '../src/core/games/gameSessionStore';
import { isAssistantVoiceEcho } from '../src/voice/lib/conversationStream';
import { commitUserTurnRow } from '../src/voice/lib/conversationTurnRow';
import { unavailableGameMessage } from '../src/app/gameActions';
import { useIntegrationStore } from '../src/store/integrationStore';
import type { GameSession } from '../src/core/games/types';

const session = (id: string): GameSession =>
    ({ id, state: {}, score: 0, round: 1 }) as unknown as GameSession;

/** Un nombre que NO existe en el catalogo: el caso del dueno. */
const JUEGO_INEXISTENTE = [
    'vamos a jugar Adivina quien',
    'quiero jugar a adivina quien',
    'juguemos adivina quien',
    'vamos a jugar al futbol',
];
/** Orden de juego SIN nombre: tampoco la poseia nadie. */
const ORDEN_SIN_NOMBRE = ['vamos a jugar', 'quiero jugar a algo', 'empecemos a jugar'];

describe('1. orden de juego con nombre FUERA del catalogo: la posee el dominio', () => {
    afterEach(() => clearActiveGameSession());

    test.each(JUEGO_INEXISTENTE)('sin partida: "%s" -> unavailable (antes: null -> lo contestaba el LLM)', (frase) => {
        clearActiveGameSession();
        const game = resolveGameCommandFromText(frase);
        expect(game).toEqual({ action: 'unavailable' });
    });

    test.each(ORDEN_SIN_NOMBRE)('sin partida: "%s" -> unavailable (pide un juego, no lo nombra)', (frase) => {
        clearActiveGameSession();
        expect(resolveGameCommandFromText(frase)).toEqual({ action: 'unavailable' });
    });

    test('el ARBITRO la entrega al dominio `game`, no a la IA', () => {
        clearActiveGameSession();
        const res = resolveDeterministicCommand('vamos a jugar Adivina quien');
        expect(res.matched).toBe(true);
        expect(res.domain).toBe('game');
        expect(res.action).toMatchObject({ action: 'unavailable' });
    });

    test('la respuesta es HONESTA: ofrece el catalogo y no anuncia el juego que no existe', () => {
        const texto = unavailableGameMessage();
        expect(texto).toMatch(/no lo tengo|no esta|no existe/i);
        expect(texto).toContain('Loteria');
        expect(texto.toLowerCase()).not.toContain('adivina quien');
    });

    test('una NEGACION no es una orden ("no quiero jugar a adivina quien")', () => {
        clearActiveGameSession();
        expect(resolveGameCommandFromText('no quiero jugar a adivina quien')).toBeNull();
        expect(resolveDeterministicCommand('no quiero jugar a adivina quien').domain).not.toBe('game');
    });
});

describe('2. con partida viva, la orden de juego AJENA no se consume como jugada', () => {
    afterEach(() => clearActiveGameSession());

    test.each(JUEGO_INEXISTENTE)('loteria activa: "%s" -> unavailable (antes: {loteria, turn})', (frase) => {
        setActiveGameSession(session('loteria'));
        expect(resolveGameCommandFromText(frase)).toEqual({
            gameId: 'loteria',
            action: 'unavailable',
        });
    });

    test('y la partida activa queda EN PAUSA (no la borra: sigue viva)', () => {
        setActiveGameSession(session('loteria'));
        const accion = resolveGameCommandFromText('vamos a jugar Adivina quien');
        noteGameTurn(consumesGameTurn(accion));
        expect(isGameSuspended()).toBe(true);
        expect(getActiveGameSession()?.id).toBe('loteria');
    });

    test('los comandos PROPIOS del juego siguen siendo jugada (no se rompe la partida)', () => {
        setActiveGameSession(session('loteria'));
        expect(resolveGameCommandFromText('siguiente')).toMatchObject({ action: 'turn' });
        expect(resolveGameCommandFromText('loteria')).toMatchObject({ action: 'turn' });
    });
});

describe('3. la PAUSA la levanta una ORDEN DE JUEGO o un comando EXPLICITO del motor', () => {
    beforeEach(() => {
        setActiveGameSession(session('loteria'));
        suspendActiveGameSession();
    });
    afterEach(() => clearActiveGameSession());

    test.each(['si', 'dale', 'adelante', 'vamos', 'ok', 'vale'])(
        'en pausa, la afirmacion suelta "%s" NO es jugada (el turno es de su dueno real)',
        (frase) => {
            expect(resolveGameCommandFromText(frase)).toBeNull();
        },
    );

    // Regla 19 de AGENTS.md: la partida "se RETOMA con ... un comando del motor".
    // Antes el gate de pausa corria ANTES del comando del motor y "siguiente
    // carta"/"pista" caian a la IA sin cantar (defecto medido 17:22:33).
    test.each(['siguiente', 'pista', 'repite', 'paso'])(
        'en pausa, el comando del motor "%s" SI retoma (turn)',
        (frase) => {
            expect(resolveGameCommandFromText(frase)).toMatchObject({ gameId: 'loteria', action: 'turn' });
        },
    );

    // El GRITO de victoria no es una orden: en pausa no retoma la partida.
    test('en pausa, el grito "loteria" NO retoma (no es una orden)', () => {
        expect(resolveGameCommandFromText('loteria')).toBeNull();
    });

    test('en pausa, una ORDEN explicita si la retoma', () => {
        expect(resolveGameCommandFromText('vamos a jugar loteria')).toEqual({
            gameId: 'loteria',
            action: 'start',
        });
        expect(resolveGameCommandFromText('cambia a trivia')).toEqual({
            gameId: 'trivia',
            action: 'switch',
        });
        expect(resolveGameCommandFromText('que juegos hay')).toMatchObject({ action: 'menu' });
        expect(resolveGameCommandFromText('salir del juego')).toMatchObject({ action: 'end' });
    });

    test('en pausa, una orden a un juego que NO existe sigue siendo del dominio', () => {
        expect(resolveGameCommandFromText('vamos a jugar Adivina quien')).toMatchObject({
            action: 'unavailable',
        });
    });
});

describe('4. la SALIDA es de los 21 juegos por igual', () => {
    afterEach(() => clearActiveGameSession());

    test.each(GAME_IDS)('%s se cierra con "salir del juego"', (id) => {
        setActiveGameSession(session(id as string));
        expect(resolveGameCommandFromText('salir del juego')).toEqual({
            gameId: id,
            action: 'end',
        });
    });

    test.each(GAME_IDS)('%s tambien con "termina el juego" y "basta"', (id) => {
        setActiveGameSession(session(id as string));
        expect(resolveGameCommandFromText('termina el juego')).toMatchObject({ action: 'end' });
        expect(resolveGameCommandFromText('basta')).toMatchObject({ action: 'end' });
    });
});

describe('5. el eco de la COLA del TTS no abre turno de persona', () => {
    const DICHO_POR_FLU =
        'He notado que repeti la informacion sobre los ratones. Te gustaria que continuemos con la loteria o prefieres que te cuente algo mas?';

    test('la cola de lo que FLU acaba de decir es ECO (antes: false)', () => {
        expect(isAssistantVoiceEcho('o prefieres que te cuente algo mas esta', DICHO_POR_FLU)).toBe(true);
    });

    test('la cola pegada al turno real tambien es ECO', () => {
        expect(
            isAssistantVoiceEcho(
                'o prefieres que te cuente algo mas esta Okay flu estabamos jugando Adivina quien',
                DICHO_POR_FLU,
            ),
        ).toBe(true);
    });

    test('una frase CORTA que no es cola no se marca (el detector no borra contenido real)', () => {
        expect(isAssistantVoiceEcho('pon la alarma a las siete', DICHO_POR_FLU)).toBe(false);
    });

    test('la ventana de eco se ancla al FIN DEL HABLA (antes: a la fila de FLU, escrita antes de hablar)', () => {
        const hook = readFileSync('src/voice/hooks/useFluVoiceAssistant.js', 'utf8');
        expect(hook).toContain('getLastCompletedSpeechAt');
        expect(readFileSync('src/voice/lib/fluSpeech.js', 'utf8')).toContain('export function getLastCompletedSpeechAt');
    });
});

describe('6. una locucion = una fila (reemision que crece)', () => {
    const userRows = () => useIntegrationStore.getState().conversationHistory.filter((r) => r.role === 'user');
    beforeEach(() => useIntegrationStore.getState().resetConversationHistory());

    test('la reemision de 18:12:06 no abre una segunda fila', () => {
        commitUserTurnRow({ text: 'Okay Flow empiezas', turnId: 1 });
        commitUserTurnRow({ text: 'Okay Flow empiezas Okay Flow empieza tu', turnId: 1 });
        // La reemision NO abre fila nueva y NO reescribe el texto ya insertado: la
        // conversacion solo se INSERTA (spec del dueno 2026-10-12).
        expect(userRows()).toHaveLength(1);
        expect(userRows()[0].text, 'append-only: la fila insertada no se reescribe').toBe('Okay Flow empiezas');
    });

    test('la reemision de 18:12:34 (eco + frase) no abre una segunda fila', () => {
        commitUserTurnRow({ text: 'o prefieres que te cuente algo mas esta', turnId: 2 });
        commitUserTurnRow({
            text: 'o prefieres que te cuente algo mas esta Okay flu estabamos jugando Adivina quien',
            turnId: 2,
        });
        expect(userRows()).toHaveLength(1);
    });

    test('una locucion DISTINTA (turno distinto) si es otra fila', () => {
        commitUserTurnRow({ text: 'Okay Flow empiezas', turnId: 3 });
        commitUserTurnRow({ text: 'Okay Flow pon la alarma', turnId: 4 });
        expect(userRows()).toHaveLength(2);
    });
});

describe('7. NO REGRESION: el turno ajeno sigue ganando (P7.48)', () => {
    afterEach(() => clearActiveGameSession());

    test('con loteria activa, los comandos de otros dominios NO son jugada', () => {
        setActiveGameSession(session('loteria'));
        expect(resolveGameCommandFromText('genera una imagen de un gato')).toBeNull();
        expect(resolveGameCommandFromText('crea una cita para manana a las 3')).toBeNull();
        expect(resolveDeterministicCommand('crea una cita para manana a las 3').domain).toBe('agendaCommand');
        expect(resolveDeterministicCommand('borra el cloro de la nota del super').domain).toBe('note');
    });

    test('y una pregunta general durante la partida la responde la IA', () => {
        setActiveGameSession(session('loteria'));
        expect(resolveGameCommandFromText('que sabes de los ratones')).toBeNull();
    });
});
