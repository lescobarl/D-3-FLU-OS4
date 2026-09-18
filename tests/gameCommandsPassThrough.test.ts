// ============================================================
// gameCommandsPassThrough — el juego NO secuestra otros comandos
// ------------------------------------------------------------
// Bug real: con la lotería activa, "crea una alarma hoy a las 5:59" caía en el
// paso "cualquier otra cosa → turn" y el juego la consumía ("La carta es…"):
// bloqueaba alarmas, notas y demás. Además no había salida corta.
// Invariante: con partida activa, los comandos accionables de OTRO dominio
// (agenda/notas) PASAN de largo; el juego sigue activo. La salida es explícita.
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveGameCommandFromText } from '../src/voice/lib/gameCommands';
import { setActiveGameSession, clearActiveGameSession } from '../src/core/games/gameSessionStore';

const LOTERIA_SESSION = {
    id: 'loteria',
    state: { order: [0, 1, 2], cursor: 0, winner: null, phase: 'announce' },
    score: 0,
    round: 1,
};

beforeEach(() => setActiveGameSession(LOTERIA_SESSION as never));
afterEach(() => clearActiveGameSession());

describe('con partida activa — no secuestra comandos de otros dominios', () => {
    it('crear una ALARMA pasa de largo (la ejecuta el enrutador normal)', () => {
        expect(resolveGameCommandFromText('crea una alarma hoy a las 5:59')).toBeNull();
    });

    it('una NOTA pasa de largo', () => {
        expect(resolveGameCommandFromText('apunta comprar pan')).toBeNull();
    });

    it('"siguiente" sigue siendo turno del juego', () => {
        expect(resolveGameCommandFromText('siguiente')).toMatchObject({ action: 'turn' });
    });

    it('una pregunta la responde la IA, no el motor', () => {
        expect(resolveGameCommandFromText('que hora es')).toBeNull();
    });
});

describe('salida del juego', () => {
    it('"salir", "basta" y "terminar" terminan la partida', () => {
        expect(resolveGameCommandFromText('salir del juego')).toMatchObject({ action: 'end' });
        expect(resolveGameCommandFromText('salir')).toMatchObject({ action: 'end' });
        expect(resolveGameCommandFromText('basta')).toMatchObject({ action: 'end' });
        expect(resolveGameCommandFromText('terminar')).toMatchObject({ action: 'end' });
    });
});

describe('sin partida activa', () => {
    it('un comando de agenda no inicia ningún juego', () => {
        clearActiveGameSession();
        expect(resolveGameCommandFromText('crea una alarma hoy a las 5:59')).toBeNull();
    });
});
