// ============================================================
// riddles — Motor puro de Adivinanzas (plan-juegos §4).
//   - createRiddlesEngine({ random }) → GameEngine (RNG inyectable).
//   - Banco local de 12 adivinanzas; validación por keywords con
//     límites de palabra ("espera" NO responde "pera").
// Objetivo: validar el comportamiento REAL del motor con un RNG
// determinista (`() => 0.9999` → shuffleOrder devuelve el orden
// idéntico [0..11] → la primera adivinanza es la del banco[0] = pera).
// Sin dummies: cada prompt es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createRiddlesEngine, RIDDLE_BANK } from '../src/core/games/riddles';

// random:()=>0.9999 → Fisher-Yates elige siempre el propio índice →
// order = [0,1,...,11] (identidad). Primera adivinanza: RIDDLE_BANK[0] = pera.
function freshRiddles(rounds = 3) {
    const engine = createRiddlesEngine({ random: () => 0.9999 });
    const session = engine.createSession({ rounds });
    const startResult = engine.start(session, { rounds });
    return { engine, session, startResult };
}

describe('riddles — inicio de partida', () => {
    test('start anuncia la primera adivinanza (pera)', () => {
        const { session, startResult } = freshRiddles();
        expect(startResult.prompt).toBe(
            '¡Vamos a jugar a las adivinanzas! Soy una fruta con forma de gota, mi piel es verde o amarilla y por dentro soy blanca y jugosa ¿Qué soy?'
        );
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(session.round).toBe(1);
    });

    test('el banco tiene 12 adivinanzas con estructura {pregunta, respuesta[], pista}', () => {
        expect(RIDDLE_BANK).toHaveLength(12);
        for (const riddle of RIDDLE_BANK) {
            expect(typeof riddle.pregunta).toBe('string');
            expect(riddle.pregunta.length).toBeGreaterThan(0);
            expect(Array.isArray(riddle.respuesta)).toBe(true);
            expect(riddle.respuesta.length).toBeGreaterThan(0);
            expect(typeof riddle.pista).toBe('string');
        }
    });
});

describe('riddles — respuesta correcta', () => {
    test('responde "es la pera" → acierto, siguiente adivinanza (reloj)', () => {
        const { engine, session } = freshRiddles();
        const result = engine.turn(session, 'es la pera');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
        expect(result.prompt).toBe(
            '¡Correcto, era pera! Siguiente: Tengo manecillas pero no soy un animal, y te digo la hora sin parar. ¿Qué soy?'
        );
        expect(result.animation).toBe('Jump_in_place');
    });

    test('completa la partida en 3 aciertos', () => {
        const { engine, session } = freshRiddles(3);
        engine.turn(session, 'es la pera');   // → reloj
        engine.turn(session, 'el reloj');     // → plátano
        const result = engine.turn(session, 'plátano');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(3);
        expect(result.prompt).toBe('¡Correcto, era platano! Completaste 3 adivinanzas con 3 puntos. ¡Eres muy listo!');
    });
});

describe('riddles — respuesta incorrecta y límites de palabra', () => {
    test('respuesta incorrecta → reintenta la misma adivinanza', () => {
        const { engine, session } = freshRiddles();
        const result = engine.turn(session, 'caballo');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBe('respuesta incorrecta');
        expect(result.prompt).toBe(
            '¡Casi! Inténtalo otra vez. Soy una fruta con forma de gota, mi piel es verde o amarilla y por dentro soy blanca y jugosa ¿Qué soy?'
        );
        expect(session.round).toBe(1); // no avanza
    });

    test('límite de palabra: "espera" NO responde "pera"', () => {
        const { engine, session } = freshRiddles();
        engine.turn(session, 'es la pera'); // → reloj
        const result = engine.turn(session, 'espera');
        expect(result.valid).toBe(false);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
        expect(result.prompt).toBe(
            '¡Casi! Inténtalo otra vez. Tengo manecillas pero no soy un animal, y te digo la hora sin parar. ¿Qué soy?'
        );
    });

    test('alias aceptado: "banana" responde la adivinanza del plátano', () => {
        const { engine, session } = freshRiddles();
        engine.turn(session, 'es la pera'); // → reloj
        engine.turn(session, 'el reloj');   // → plátano
        const result = engine.turn(session, 'banana');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('¡Correcto, era platano! Completaste 3 adivinanzas con 3 puntos. ¡Eres muy listo!');
    });
});

describe('riddles — controles del jugador (pista / saltar)', () => {
    test('"pista" devuelve la pista de la adivinanza actual', () => {
        const { engine, session } = freshRiddles();
        const result = engine.turn(session, 'dame una pista');
        expect(result.valid).toBe(false);
        expect(result.prompt).toBe('Aquí va una pista: Es una fruta que empieza con la letra "pe".');
        expect(result.emotion).toBe('thinking');
        expect(session.round).toBe(1);
    });

    test('"no sé" entrega pista (no salta: hint tiene prioridad)', () => {
        const { engine, session } = freshRiddles();
        const result = engine.turn(session, 'no sé');
        expect(result.prompt).toBe('Aquí va una pista: Es una fruta que empieza con la letra "pe".');
        expect(session.round).toBe(1);
    });

    test('"paso" salta a la siguiente adivinanza sin puntuar', () => {
        const { engine, session } = freshRiddles();
        const result = engine.turn(session, 'paso');
        expect(result.valid).toBe(false);
        expect(result.score).toBe(0);
        expect(session.round).toBe(2);
        expect(result.prompt).toBe(
            '¡Claro! Aquí va otra: Tengo manecillas pero no soy un animal, y te digo la hora sin parar. ¿Qué soy?'
        );
    });

    test('saltar la última adivinanza termina la partida', () => {
        const { engine, session } = freshRiddles(1);
        const result = engine.turn(session, 'paso');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Terminamos con 0 puntos. ¡Muy bien jugado!');
    });
});

describe('riddles — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshRiddles(1);
        engine.turn(session, 'pera');
        const result = engine.turn(session, 'hola');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Ya terminamos las adivinanzas. ¿Jugamos otra vez?');
    });

    test('isGameCommand reconoce controles y frases de salida', () => {
        const engine = createRiddlesEngine({ random: () => 0.9999 });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('dame una pista')).toBe(true);
        expect(engine.isGameCommand('otra')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});
