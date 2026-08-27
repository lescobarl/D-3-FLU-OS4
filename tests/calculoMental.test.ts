// ============================================================
// calculoMental — Motor puro de Cálculo mental (plan-juegos §4).
//   - createCalculoMentalEngine({ random }) → GameEngine (RNG inyectable).
//   - FLU propone una operación (suma/resta) acotada por maxSuma;
//     el niño responde el resultado. Fallo → reintenta la misma;
//     "paso" revela la respuesta y salta.
// Objetivo: validar el comportamiento REAL del motor con un RNG
// determinista (`() => 0` → pickRandom elige '+', a=1 y b=1 →
// la operación es siempre 1 + 1 = 2). Sin dummies: cada prompt es
// el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createCalculoMentalEngine } from '../src/core/games/calculoMental';

// random:()=>0 → op = operaciones[0] = '+'; a = 1 + floor(0*9) = 1;
// b = 1 + floor(0*9) = 1 → la operación es siempre 1 + 1 = 2.
function freshCalculo(rounds = 3, config: Record<string, unknown> = {}) {
    const engine = createCalculoMentalEngine({ random: () => 0 });
    const session = engine.createSession({ rounds, ...config });
    const startResult = engine.start(session, { rounds, ...config });
    return { engine, session, startResult };
}

describe('calculoMental — inicio de partida', () => {
    test('start anuncia la primera operación (1 + 1)', () => {
        const { session, startResult } = freshCalculo();
        expect(startResult.prompt).toBe('¡Vamos a jugar a cálculo mental! ¿Cuánto es 1 más 1?');
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Idle');
        expect(startResult.emotion).toBe('excited');
        expect(session.round).toBe(1);
    });

    test('createSession devuelve una sesión serializable y plana', () => {
        const engine = createCalculoMentalEngine({ random: () => 0 });
        const session = engine.createSession({});
        expect(session).toMatchObject({ id: 'calculo_mental', score: 0, round: 1 });
        expect(session.state).toBeTypeOf('object');
        expect(JSON.parse(JSON.stringify(session))).toEqual(session);
    });
});

describe('calculoMental — turnos correctos', () => {
    test('respuesta correcta → +1 punto y siguiente operación', () => {
        const { engine, session } = freshCalculo();
        const result = engine.turn(session, '2');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
        expect(result.animation).toBe('Jump_in_place');
        expect(result.prompt).toBe('¡Correcto! 1 más 1 es 2. Siguiente: ¿Cuánto es 1 más 1?');
    });

    test('número en letras: "dos" también acierta', () => {
        const { engine, session } = freshCalculo();
        const result = engine.turn(session, 'dos');
        expect(result.valid).toBe(true);
        expect(result.score).toBe(1);
    });

    test('completa la partida al llegar a rounds (3 operaciones)', () => {
        const { engine, session } = freshCalculo(3);
        engine.turn(session, '2');
        engine.turn(session, '2');
        const result = engine.turn(session, '2');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(3);
        expect(result.prompt).toBe('¡Perfecto! Completaste 3 operaciones con 3 puntos. ¡Eres una calculadora humana!');
    });

    test('con rounds=1 termina en un solo turno', () => {
        const { engine, session } = freshCalculo(1);
        const result = engine.turn(session, '2');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('¡Perfecto! Completaste 1 operaciones con 1 puntos. ¡Eres una calculadora humana!');
    });
});

describe('calculoMental — resta (rama de sustracción)', () => {
    test('rng 0.99 → op "-", 10 menos 10 = 0 y "cero" acierta', () => {
        const engine = createCalculoMentalEngine({ random: () => 0.99 });
        const session = engine.createSession({});
        const startResult = engine.start(session, {});
        expect(startResult.prompt).toBe('¡Vamos a jugar a cálculo mental! ¿Cuánto es 10 menos 10?');
        const result = engine.turn(session, 'cero');
        expect(result.valid).toBe(true);
        expect(result.score).toBe(1);
        expect(result.prompt).toBe('¡Correcto! 10 menos 10 es 0. Siguiente: ¿Cuánto es 10 menos 10?');
    });
});

describe('calculoMental — turnos incorrectos', () => {
    test('respuesta incorrecta → reintenta la misma operación', () => {
        const { engine, session } = freshCalculo();
        const result = engine.turn(session, '5');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBe('respuesta incorrecta');
        expect(result.prompt).toBe('¡Casi! Inténtalo otra vez. ¿Cuánto es 1 más 1?');
        expect(session.round).toBe(1); // no avanza
    });

    test('sin número reconocido → error amigable', () => {
        const { engine, session } = freshCalculo();
        const result = engine.turn(session, 'hola que tal');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('no se reconoció ningún número');
        expect(result.prompt).toBe('No logré reconocer un número. ¿Cuánto es 1 más 1?');
    });

    test('"paso" salta revelando la respuesta', () => {
        const { engine, session } = freshCalculo();
        const result = engine.turn(session, 'paso');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(session.round).toBe(2);
        expect(result.prompt).toBe('Era 2. ¿Cuánto es 1 más 1?');
    });

    test('saltar la última operación termina la partida', () => {
        const { engine, session } = freshCalculo(1);
        const result = engine.turn(session, 'paso');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Terminamos con 0 puntos. ¡Muy bien jugado!');
    });
});

describe('calculoMental — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshCalculo(1);
        engine.turn(session, '2');
        const result = engine.turn(session, '5');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Ya terminamos de jugar cálculo mental. ¿Jugamos otra vez?');
    });

    test('isGameCommand reconoce controles y frases de salida', () => {
        const engine = createCalculoMentalEngine({ random: () => 0 });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('paso')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('calculoMental — configuración (data-driven, sin hardcode)', () => {
    test('filtra operaciones inválidas y aplica clamps (rounds/maxSuma)', () => {
        const engine = createCalculoMentalEngine({ random: () => 0 });
        const session = engine.createSession({ rounds: 99, maxSuma: 99, operaciones: ['+', 'x', '-'] });
        const state = session.state as { operaciones: string[]; maxRounds: number; maxSuma: number };
        expect(state.operaciones).toEqual(['+', '-']);
        expect(state.maxRounds).toBe(10); // MAX_ROUNDS
        expect(state.maxSuma).toBe(50);   // MAX_SUMA
    });
});
