// ============================================================
// Guard — con partida activa, la conversación NO queda secuestrada
// ------------------------------------------------------------
// Causa raíz del ciclo: `resolveGameCommandFromText` convertía TODO texto
// en `turn` si había partida activa, y `isGameCommand` no tenía consumidor.
// Así, "¿qué otro juego podemos jugar?" iba al motor de lotería, que no lo
// reconocía y repetía la misma carta para siempre.
// Este guard ejecuta el enrutador real con una partida activa.
// ============================================================
import { describe, it, expect, afterEach } from 'vitest';
import { resolveGameCommandFromText } from '../src/voice/lib/gameCommands.js';
import { setActiveGameSession, clearActiveGameSession } from '../src/core/games/gameSessionStore';
import { createLoteriaEngine } from '../src/core/games/loteria';
import { GAME_IDS, getGameEngine } from '../src/core/games/gameCatalog';

function withActiveLoteria(): void {
    const engine = createLoteriaEngine({ random: () => 0.5 });
    const session = engine.createSession({ tablaSize: 3 });
    engine.start(session, { tablaSize: 3 });
    setActiveGameSession(session);
}

describe('gameCommands — con partida activa no se secuestra la conversación', () => {
    afterEach(() => clearActiveGameSession());

    it('preguntar por otro juego devuelve MENÚ (no turno) [rompe el ciclo]', () => {
        withActiveLoteria();
        const result = resolveGameCommandFromText('¿qué otro juego podemos jugar?');
        expect(result?.action).toBe('menu');
    });

    it('pedir un juego concreto devuelve SWITCH al nuevo juego', () => {
        withActiveLoteria();
        const result = resolveGameCommandFromText('juguemos a las adivinanzas');
        expect(result?.action).toBe('switch');
        expect(result?.gameId).toBe('adivinanzas');
    });

    it('una pregunta que NO es del juego devuelve null (la responde la IA)', () => {
        withActiveLoteria();
        expect(resolveGameCommandFromText('¿cómo estás?')).toBeNull();
    });

    it('salir del juego sigue terminando la partida', () => {
        withActiveLoteria();
        expect(resolveGameCommandFromText('salir del juego')?.action).toBe('end');
    });

    it('una respuesta PROPIA del juego sigue siendo turno', () => {
        withActiveLoteria();
        const result = resolveGameCommandFromText('la tengo');
        expect(result?.action).toBe('turn');
        expect(result?.playerText).toBe('la tengo');
    });

    it('sin partida activa, una frase suelta no inicia nada', () => {
        expect(resolveGameCommandFromText('hola flu')).toBeNull();
    });
});

// ------------------------------------------------------------
// GENÉRICO: la salida no puede depender del juego concreto.
// ------------------------------------------------------------
describe('gameCommands — la salida del ciclo es GENÉRICA (todos los juegos)', () => {
    afterEach(() => clearActiveGameSession());

    const FRASES = {
        menu: [
            'vamos a jugar otra cosa',
            'qué otro juego podemos jugar',
            'quiero cambiar de juego',
        ],
        peticion: [
            'platícame de los aviones',
            'cuéntame sobre los dinosaurios',
            'háblame de la luna',
            '¿cómo estás?',
            'estás ahí',
        ],
        salida: ['salir del juego', 'ya no quiero jugar', 'alto al juego', 'ya no para para de jugar'],
    };

    for (const id of GAME_IDS) {
        it(`"${id}": menú, petición general y salida se resuelven FUERA del motor`, () => {
            const engine = getGameEngine(id);
            expect(engine).not.toBeNull();
            const session = engine!.createSession({});
            engine!.start(session, {});
            setActiveGameSession(session);

            for (const phrase of FRASES.menu) {
                expect(resolveGameCommandFromText(phrase)?.action, phrase).toBe('menu');
            }
            for (const phrase of FRASES.peticion) {
                expect(resolveGameCommandFromText(phrase), phrase).toBeNull();
            }
            for (const phrase of FRASES.salida) {
                expect(resolveGameCommandFromText(phrase)?.action, phrase).toBe('end');
            }

            clearActiveGameSession();
        });
    }

    it('una respuesta abierta del jugador sigue siendo turno (no se rompe el juego)', () => {
        const engine = getGameEngine('simon_dice')!;
        const session = engine.createSession({});
        engine.start(session, {});
        setActiveGameSession(session);
        expect(resolveGameCommandFromText('baila')?.action).toBe('turn');
    });
});

// ------------------------------------------------------------
// DEFECTO MEDIDO (log del dueño): con la lotería activa, "alto al juego" y
// "ya no para para de jugar" NO terminaban la partida: el enrutador los
// resolvía como `turn` y el motor cantaba otra carta. La lista de salidas sólo
// tenía frases largas y sólo la lotería conocía las cortas.
// ------------------------------------------------------------
describe('gameCommands — frases reales de salida del dueño', () => {
    afterEach(() => clearActiveGameSession());

    const SALIDAS = [
        'alto al juego',
        'alto el juego',
        'ya no para para de jugar', // ASR literal del reporte
        'para de jugar',
        'para el juego',
        'parar el juego',
        'deten el juego',
        'detener el juego',
        'acaba el juego',
        'alto',
    ];

    it.each(SALIDAS)('con partida activa, "%s" → end', (phrase) => {
        withActiveLoteria();
        expect(resolveGameCommandFromText(phrase)?.action, phrase).toBe('end');
    });

    it('los comandos de OTRO dominio siguen sin secuestrarse', () => {
        withActiveLoteria();
        expect(resolveGameCommandFromText('crea una alarma hoy a las 5:59')).toBeNull();
        expect(resolveGameCommandFromText('apunta comprar pan')).toBeNull();
        expect(resolveGameCommandFromText('que hora es')).toBeNull();
    });

    it('no se dispara por subcadena: "salto" y "determina" NO terminan la partida', () => {
        withActiveLoteria();
        expect(resolveGameCommandFromText('salto')).not.toMatchObject({ action: 'end' });
        expect(resolveGameCommandFromText('determina la respuesta')).not.toMatchObject({ action: 'end' });
    });
});
