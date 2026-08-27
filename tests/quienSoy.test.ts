// ============================================================
// quienSoy — Motor puro de ¿Quién soy? (plan-juegos §4).
//   - createQuienSoyEngine({ random }) → GameEngine (RNG inyectable).
//   - FLU piensa un animal y da pistas PROGRESIVAS; el niño adivina
//     tras cada pista. "pista"/"no sé" → siguiente pista; "paso" salta.
// Objetivo: validar el comportamiento REAL del motor con un RNG
// determinista (`() => 0.9999` → shuffleOrder devuelve el orden
// idéntico [0..11] → el primer animal es QUIEN_SOY_BANK[0] = leon).
// Sin dummies: cada prompt es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createQuienSoyEngine, QUIEN_SOY_BANK } from '../src/core/games/quienSoy';

// random:()=>0.9999 → Fisher-Yates elige siempre el propio índice →
// order = [0,1,...,11] (identidad). Primer animal: QUIEN_SOY_BANK[0] = leon.
function freshQuien(rounds = 3) {
    const engine = createQuienSoyEngine({ random: () => 0.9999 });
    const session = engine.createSession({ rounds });
    const startResult = engine.start(session, { rounds });
    return { engine, session, startResult };
}

describe('quienSoy — inicio de partida', () => {
    test('start anuncia el primer animal con su pista 1 (leon)', () => {
        const { session, startResult } = freshQuien();
        expect(startResult.prompt).toBe(
            '¡Vamos a jugar a ¿Quién soy?! Soy un animal. Pista 1: Vivo en la selva. ¿Quién soy?'
        );
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Idle');
        expect(startResult.emotion).toBe('excited');
        expect(session.round).toBe(1);
    });

    test('el banco tiene 12 animales con estructura {nombre, pistas[]}', () => {
        expect(QUIEN_SOY_BANK).toHaveLength(12);
        for (const item of QUIEN_SOY_BANK) {
            expect(typeof item.nombre).toBe('string');
            expect(item.nombre.length).toBeGreaterThan(0);
            expect(Array.isArray(item.pistas)).toBe(true);
            expect(item.pistas.length).toBeGreaterThan(0);
        }
    });
});

describe('quienSoy — aciertos', () => {
    test('responde "leon" → +1 y siguiente animal (elefante)', () => {
        const { engine, session } = freshQuien();
        const result = engine.turn(session, 'leon');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
        expect(result.animation).toBe('Jump_in_place');
        expect(result.prompt).toBe(
            '¡Correcto, era leon! Siguiente: Soy un animal. Pista 1: Soy el animal más grande de la tierra. ¿Quién soy?'
        );
    });

    test('completa la partida en 3 aciertos', () => {
        const { engine, session } = freshQuien(3);
        engine.turn(session, 'leon');      // → elefante
        engine.turn(session, 'elefante');  // → delfin
        const result = engine.turn(session, 'delfin');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(3);
        expect(result.prompt).toBe(
            '¡Correcto, era delfin! Completaste 3 animales con 3 puntos. ¡Eres un gran detective!'
        );
    });

    test('keyword alias: "lechuza" adivina el buho', () => {
        const { engine, session } = freshQuien(5);
        engine.turn(session, 'leon');      // → elefante
        engine.turn(session, 'elefante');  // → delfin
        engine.turn(session, 'delfin');    // → tortuga
        engine.turn(session, 'tortuga');   // → buho
        const result = engine.turn(session, 'lechuza');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe(
            '¡Correcto, era buho! Completaste 5 animales con 5 puntos. ¡Eres un gran detective!'
        );
    });
});

describe('quienSoy — pistas progresivas', () => {
    test('"dame una pista" avanza a la siguiente pista', () => {
        const { engine, session } = freshQuien();
        const result = engine.turn(session, 'dame una pista');
        expect(result.valid).toBe(false);
        expect(result.prompt).toBe('Pista 2: Soy muy fuerte y valiente. ¿Quién soy?');
        expect(result.emotion).toBe('thinking');
        expect(session.round).toBe(1);
    });

    test('"no sé" entrega pista (no salta: hint tiene prioridad)', () => {
        const { engine, session } = freshQuien();
        const result = engine.turn(session, 'no sé');
        expect(result.prompt).toBe('Pista 2: Soy muy fuerte y valiente. ¿Quién soy?');
        expect(session.round).toBe(1);
    });

    test('tras la última pista, avisa que se agotaron', () => {
        const { engine, session } = freshQuien();
        engine.turn(session, 'pista'); // Pista 2
        engine.turn(session, 'pista'); // Pista 3
        engine.turn(session, 'pista'); // Pista 4
        const result = engine.turn(session, 'pista');
        expect(result.prompt).toBe('Ya te di todas las pistas. Pista 4: Rujo fuerte: ¡grrr! ¿Quién soy?');
    });
});

describe('quienSoy — turnos incorrectos y saltos', () => {
    test('respuesta incorrecta → reintenta el mismo animal', () => {
        const { engine, session } = freshQuien();
        const result = engine.turn(session, 'perro');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBe('respuesta incorrecta');
        expect(result.prompt).toBe('¡Casi! Inténtalo otra vez. Pista 1: Vivo en la selva. ¿Quién soy?');
        expect(session.round).toBe(1); // no avanza
    });

    test('"paso" salta al siguiente animal sin puntuar', () => {
        const { engine, session } = freshQuien();
        const result = engine.turn(session, 'paso');
        expect(result.valid).toBe(false);
        expect(result.score).toBe(0);
        expect(session.round).toBe(2);
        expect(result.prompt).toBe(
            '¡Claro! Era leon. Siguiente: Soy un animal. Pista 1: Soy el animal más grande de la tierra. ¿Quién soy?'
        );
    });

    test('saltar el último animal termina la partida', () => {
        const { engine, session } = freshQuien(1);
        const result = engine.turn(session, 'paso');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Terminamos con 0 puntos. ¡Muy bien jugado!');
    });
});

describe('quienSoy — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshQuien(1);
        engine.turn(session, 'leon');
        const result = engine.turn(session, 'hola');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Ya terminamos de jugar ¿Quién soy?. ¿Jugamos otra vez?');
    });

    test('isGameCommand reconoce controles y frases de salida', () => {
        const engine = createQuienSoyEngine({ random: () => 0.9999 });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('dame una pista')).toBe(true);
        expect(engine.isGameCommand('paso')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('quienSoy — configuración (data-driven, sin hardcode)', () => {
    test('aplica clamps de rounds (1..12)', () => {
        const engine = createQuienSoyEngine({ random: () => 0.9999 });
        const session = engine.createSession({ rounds: 99 });
        const state = session.state as { maxRounds: number };
        expect(state.maxRounds).toBe(12); // MAX_ROUNDS = QUIEN_SOY_BANK.length
    });
});
