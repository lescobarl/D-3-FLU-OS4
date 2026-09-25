// ============================================================
// Guard — el contexto multiusuario es genérico (todos los juegos)
// ------------------------------------------------------------
// `turn` ahora recibe un 3.er argumento opcional `{ playerId }`. Este guard
// recorre TODOS los ids y exige que ningún motor se rompa al recibirlo, y que
// la atribución por jugador solo la aprovechen los juegos multiusuario.
// ============================================================
import { describe, it, expect } from 'vitest';
import { GAME_IDS, getGameEngine } from '../src/core/games/gameCatalog';

describe('juegos — turn con contexto de jugador (genérico)', () => {
    for (const id of GAME_IDS) {
        it(`"${id}": turn(session, text, { playerId }) no se rompe`, () => {
            const engine = getGameEngine(id);
            expect(engine).not.toBeNull();
            const session = engine!.createSession({});
            engine!.start(session, {});
            const result = engine!.turn(session, 'hola flu', { playerId: 'p1' });
            expect(result).toBeDefined();
            expect(typeof result.prompt).toBe('string');
        });
    }
});
