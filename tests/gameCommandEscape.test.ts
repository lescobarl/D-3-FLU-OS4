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
