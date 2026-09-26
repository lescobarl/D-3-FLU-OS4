// ============================================================
// Una ORDEN DE ARRANQUE del juego ACTIVO nunca es una accion de partida.
//
// Defecto medido: con la loteria en curso, "Okay Flow vamos a jugar loteria"
// (eco/repeticion del arranque) llegaba al motor como `turn`; el motor Loteria
// declara victoria cuando el texto contiene el token "loteria" (el grito
// "!LOTERIA!"), que colisiona con el nombre del juego dentro de la orden de
// arranque. Resultado: la partida terminaba con UNA sola carta cantada.
//
// El criterio "es arranque" tiene DUENO UNICO: matchGameIntent (frame de juego
// + alias), el mismo que la ruta sin partida activa. Aqui no hay listas nuevas.
// ============================================================
import { describe, test, expect, afterEach } from 'vitest';
import { resolveGameCommandFromText } from '../src/voice/lib/gameCommands';
import { setActiveGameSession, clearActiveGameSession } from '../src/core/games/gameSessionStore';
import type { GameSession } from '../src/core/games/types';
const session = (id: string): GameSession =>
    ({ id, state: {}, score: 0, round: 1 }) as unknown as GameSession;
describe('arranque del juego activo NO se consume como turno', () => {
    afterEach(() => clearActiveGameSession());
    test('loteria activa + orden de arranque -> start (antes: turn -> victoria)', () => {
        setActiveGameSession(session('loteria'));
        expect(resolveGameCommandFromText('Okay Flow vamos a jugar loteria')).toEqual({
            gameId: 'loteria',
            action: 'start',
        });
        expect(resolveGameCommandFromText('vamos a jugar loteria')).toEqual({
            gameId: 'loteria',
            action: 'start',
        });
    });
    test('el GRITO de victoria sigue ganando (sin frame de arranque)', () => {
        setActiveGameSession(session('loteria'));
        expect(resolveGameCommandFromText('loteria')).toMatchObject({
            gameId: 'loteria',
            action: 'turn',
        });
        expect(resolveGameCommandFromText('loteria!')).toMatchObject({
            gameId: 'loteria',
            action: 'turn',
        });
    });
    test('los comandos propios del juego siguen siendo turno', () => {
        setActiveGameSession(session('loteria'));
        expect(resolveGameCommandFromText('siguiente')).toMatchObject({
            gameId: 'loteria',
            action: 'turn',
        });
    });
    test('generico: no es un caso de loteria', () => {
        setActiveGameSession(session('adivinanzas'));
        expect(resolveGameCommandFromText('vamos a jugar a las adivinanzas')).toEqual({
            gameId: 'adivinanzas',
            action: 'start',
        });
    });
    test('pedir OTRO juego sigue siendo switch (no se rompe el cambio)', () => {
        setActiveGameSession(session('adivinanzas'));
        expect(resolveGameCommandFromText('vamos a jugar loteria')).toEqual({
            gameId: 'loteria',
            action: 'switch',
        });
    });
    test('sin partida activa el arranque sigue siendo start', () => {
        clearActiveGameSession();
        expect(resolveGameCommandFromText('vamos a jugar loteria')).toEqual({
            gameId: 'loteria',
            action: 'start',
        });
    });
});
// ------------------------------------------------------------
// MURO GENERICO: el defecto no es de loteria. Para TODO juego del catalogo, su
// propia orden de arranque no puede clasificarse como accion de partida. Si
// algun juego colisiona (nombre == frame interno), aqui se ve: la lista sale del
// catalogo (unica fuente), sin enumerar juegos a mano.
// ------------------------------------------------------------
import { GAME_CATALOG } from '../src/core/games/gameCatalog';
describe('muro generico: arranque != turno en TODO el catalogo', () => {
    afterEach(() => clearActiveGameSession());
    test('ninguna orden de arranque de ningun juego se consume como turno', () => {
        const collisions: string[] = [];
        for (const entry of GAME_CATALOG) {
            const phrase = `vamos a jugar ${entry.aliases[0]}`;
            setActiveGameSession(session(entry.id));
            const resolved = resolveGameCommandFromText(phrase);
            if (resolved?.action === 'turn') collisions.push(`${entry.id} <- "${phrase}"`);
        }
        expect(collisions).toEqual([]);
    });
});
