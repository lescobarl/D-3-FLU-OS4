// ============================================================
// cuenta_conmigo — Motor puro de Cuenta conmigo (plan-juegos §Fase 3).
//   - createCuentaConmigoEngine() → GameEngine (contador puro, sin RNG).
//   - FLU dice "1" y el niño dice el número siguiente (dígitos o
//     palabras). "pista"/"no sé" → revela el que sigue; "paso" salta.
// Objetivo: validar el comportamiento REAL del motor.
// Sin dummies: cada prompt es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createCuentaConmigoEngine } from '../src/core/games/cuentaConmigo';

function freshCuentaConmigo(hasta = 10) {
    const engine = createCuentaConmigoEngine();
    const session = engine.createSession({ hasta });
    const startResult = engine.start(session, { hasta });
    return { engine, session, startResult };
}

describe('cuenta_conmigo — inicio de partida', () => {
    test('start anuncia el conteo del 1 al 10 y pide el siguiente número', () => {
        const { session, startResult } = freshCuentaConmigo();
        expect(startResult.prompt).toBe(
            '¡Vamos a contar juntos del 1 al 10! Yo digo 1. ¿Qué número sigue?'
        );
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Idle');
        expect(startResult.emotion).toBe('excited');
        expect(session.round).toBe(1);
    });

    test('createSession devuelve una sesión serializable y plana', () => {
        const { session } = freshCuentaConmigo();
        expect(session.id).toBe('cuenta_conmigo');
        expect(session.state.siguiente).toBe(2);
        expect(session.state.hasta).toBe(10);
        expect(session.state.phase).toBe('announce');
        const roundTrip = JSON.parse(JSON.stringify(session));
        expect(roundTrip.state.siguiente).toBe(2);
        expect(roundTrip.state.hasta).toBe(10);
        expect(roundTrip.state.phase).toBe('announce');
    });
});

describe('cuenta_conmigo — respuesta correcta', () => {
    test('dice "dos" → +1 punto y pide el número siguiente', () => {
        const { engine, session } = freshCuentaConmigo();
        const result = engine.turn(session, 'dos');
        expect(result.prompt).toBe('¡Sí, el 2! Ahora dime: ¿qué número sigue después del 2?');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(1);
        expect(result.animation).toBe('Jump_in_place');
        expect(result.emotion).toBe('happy');
    });

    test('también acierta con el dígito "3"', () => {
        const { engine, session } = freshCuentaConmigo();
        engine.turn(session, '2');
        const result = engine.turn(session, '3');
        expect(result.prompt).toBe('¡Sí, el 3! Ahora dime: ¿qué número sigue después del 3?');
        expect(result.valid).toBe(true);
        expect(result.score).toBe(2);
    });

    test('completa la partida con hasta:5 en 4 aciertos', () => {
        const { engine, session } = freshCuentaConmigo(5);
        let result;
        result = engine.turn(session, '2');
        result = engine.turn(session, '3');
        result = engine.turn(session, '4');
        result = engine.turn(session, '5');
        expect(result.prompt).toBe(
            '¡Contamos del 1 al 5! Dijiste 4 números seguidos. ¡Eres un gran contador!'
        );
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(4);
        expect(result.animation).toBe('Dance');
        expect(result.emotion).toBe('happy');
    });

    test('completa la partida por defecto en 9 aciertos (del 2 al 10)', () => {
        const { engine, session } = freshCuentaConmigo();
        let result = engine.turn(session, '2');
        for (let n = 3; n <= 10; n += 1) {
            result = engine.turn(session, String(n));
        }
        expect(result.prompt).toBe(
            '¡Contamos del 1 al 10! Dijiste 9 números seguidos. ¡Eres un gran contador!'
        );
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(9);
    });
});

describe('cuenta_conmigo — respuesta incorrecta', () => {
    test('número equivocado ("4" cuando sigue el 2) → reintenta el mismo número', () => {
        const { engine, session } = freshCuentaConmigo();
        const result = engine.turn(session, '4');
        expect(result.prompt).toBe('Casi... Estamos en el 1. ¿Qué número va después?');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(0);
        expect(result.error).toBe('número incorrecto');
        expect(result.emotion).toBe('encouraging');
    });
});

describe('cuenta_conmigo — controles del jugador (pista / saltar)', () => {
    test('"pista" revela el número que sigue', () => {
        const { engine, session } = freshCuentaConmigo();
        const result = engine.turn(session, 'pista');
        expect(result.prompt).toBe('El número que sigue es el 2. Dilo para seguir contando.');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.emotion).toBe('thinking');
    });

    test('"no sé" entrega pista (no salta: hint tiene prioridad)', () => {
        const { engine, session } = freshCuentaConmigo();
        const result = engine.turn(session, 'no sé');
        expect(result.prompt).toBe('El número que sigue es el 2. Dilo para seguir contando.');
        expect(result.score).toBe(0);
        expect(session.state.siguiente).toBe(2);
    });

    test('"paso" salta al siguiente número sin puntuar', () => {
        const { engine, session } = freshCuentaConmigo();
        const result = engine.turn(session, 'paso');
        expect(result.prompt).toBe('El 2. Ahora dime el que sigue.');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(0);
        expect(session.state.siguiente).toBe(3);
    });

    test('saltar el último número termina la partida', () => {
        const { engine, session } = freshCuentaConmigo(3);
        engine.turn(session, 'paso');
        const result = engine.turn(session, 'paso');
        expect(result.prompt).toBe('Terminamos de contar hasta 3. ¡Muy bien jugado!');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(true);
        expect(result.animation).toBe('Dance');
        expect(result.emotion).toBe('happy');
    });
});

describe('cuenta_conmigo — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshCuentaConmigo(3);
        engine.turn(session, '2');
        engine.turn(session, '3');
        const result = engine.turn(session, 'hola flu');
        expect(result.prompt).toBe('Ya terminamos de contar. ¿Contamos otra vez?');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(true);
        expect(result.emotion).toBe('happy');
    });

    test('isGameCommand reconoce controles y frases de salida', () => {
        const engine = createCuentaConmigoEngine();
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('dame una pista')).toBe(true);
        expect(engine.isGameCommand('no sé')).toBe(true);
        expect(engine.isGameCommand('paso')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('cuenta_conmigo — configuración (data-driven, sin hardcode)', () => {
    test('aplica hasta y clamps al rango [3,20]', () => {
        const engine = createCuentaConmigoEngine();
        expect(engine.createSession({ hasta: 5 }).state.hasta).toBe(5);
        expect(engine.createSession({ hasta: 2 }).state.hasta).toBe(3);
        expect(engine.createSession({ hasta: -5 }).state.hasta).toBe(3);
        expect(engine.createSession({ hasta: 99 }).state.hasta).toBe(20);
        expect(engine.createSession({ hasta: 0 }).state.hasta).toBe(10);
        expect(engine.createSession({}).state.hasta).toBe(10);
    });
});
