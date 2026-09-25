// @vitest-environment node
// ============================================================
// loteriaAdvance — "sí"/"continúa" CANTA LA SIGUIENTE (no repite en ciclo)
// ------------------------------------------------------------
// Bug real: en la lotería, decir "sí" (la forma natural de seguir) caía en
// "respuesta no reconocida" y repetía la MISMA carta en bucle.
// Invariante: una afirmación avanza el mazo; un texto no reconocido repite.
// ============================================================
import { describe, it, expect } from 'vitest';
import { createLoteriaEngine } from '../src/core/games/loteria';

function seeded(seed = 1) {
    let s = seed;
    return () => {
        s = (s * 1103515245 + 12345) % 2147483648;
        return s / 2147483648;
    };
}

function freshGame() {
    const engine = createLoteriaEngine({ random: seeded(7) });
    const session = engine.createSession({});
    const start = engine.start(session, {});
    return { engine, session, start };
}

describe('lotería — avanzar con afirmaciones', () => {
    it('"sí" canta la SIGUIENTE carta (no repite la primera)', () => {
        const { engine, session, start } = freshGame();
        const after = engine.turn(session, 'sí');
        expect(after.prompt).toContain('Siguiente carta');
        expect(after.prompt).not.toBe(start.prompt);
    });

    it('"continúa" también avanza', () => {
        const { engine, session } = freshGame();
        const after = engine.turn(session, 'continúa');
        expect(after.prompt).toContain('Siguiente carta');
    });

    it('un texto no reconocido NO avanza (repite la carta actual)', () => {
        const { engine, session } = freshGame();
        const after = engine.turn(session, 'xyzzy');
        expect(after.prompt).toContain('La carta es');
        expect(after.error).toBe('respuesta no reconocida');
    });

    it('"lotería" gana y termina', () => {
        const { engine, session } = freshGame();
        const after = engine.turn(session, 'lotería');
        expect(after.gameOver).toBe(true);
        expect(after.won).toBe(true);
    });
});
