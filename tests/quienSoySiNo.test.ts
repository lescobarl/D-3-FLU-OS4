// ============================================================
// Guard — ¿Quién soy? soporta preguntas SÍ/NO (20 preguntas)
// ------------------------------------------------------------
// Antes el niño solo podía pedir pistas o adivinar; una pregunta "¿vuela?"
// se trataba como intento incorrecto. Ahora se responde con la verdad del
// animal (atributos del banco) sin gastar intentos.
// ============================================================
import { describe, it, expect } from 'vitest';
import { createQuienSoyEngine } from '../src/core/games/quienSoy';

function fresh() {
    const engine = createQuienSoyEngine({ random: () => 0.9999 });
    const session = engine.createSession({ rounds: 3 });
    engine.start(session, { rounds: 3 });
    return { engine, session };
}

describe('quien_soy — preguntas sí/no', () => {
    it('"¿vuela?" sobre el león responde "No." sin gastar intentos', () => {
        const { engine, session } = fresh();
        const result = engine.turn(session, '¿vuela?');
        expect(result.prompt).toBe('No.');
        expect(result.gameOver).toBe(false);
        expect(session.score).toBe(0);
    });

    it('"¿es grande?" sobre el león responde "Sí."', () => {
        const { engine, session } = fresh();
        expect(engine.turn(session, '¿es grande?').prompt).toBe('Sí.');
    });

    it('adivinar el animal sigue dando punto', () => {
        const { engine, session } = fresh();
        engine.turn(session, '¿vuela?');
        const win = engine.turn(session, 'leon');
        expect(win.valid).toBe(true);
        expect(session.score).toBe(1);
    });
});
