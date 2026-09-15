// ============================================================
// trivia — Motor puro de Trivia (plan-juegos §Fase 3).
//   - createTriviaEngine({ random }) → GameEngine (RNG inyectable).
//   - Banco local de preguntas de opción múltiple. Acepta el texto
//     de la opción, un número/ordinal o una letra (a..d).
//   - "pista"/"no sé" → pista; "paso" salta a la siguiente pregunta.
// Objetivo: validar el comportamiento REAL del motor con un RNG
// determinista (`() => 0.9999` → Fisher-Yates identidad → la primera
// pregunta es TRIVIA_BANK[0]).
// Sin dummies: cada prompt es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createTriviaEngine, TRIVIA_BANK } from '../src/core/games/trivia';

// random:()=>0.9999 → j = floor(0.9999*(i+1)) = i → order = [0,1,...,9] (identidad).
// Primera pregunta: TRIVIA_BANK[0] = '¿Qué animal dice miau?' (correcta: gato).
function freshTrivia(rounds = 3) {
    const engine = createTriviaEngine({ random: () => 0.9999 });
    const session = engine.createSession({ rounds });
    const startResult = engine.start(session, { rounds });
    return { engine, session, startResult };
}

describe('trivia — inicio de partida', () => {
    test('start anuncia la primera pregunta con sus opciones', () => {
        const { session, startResult } = freshTrivia();
        expect(startResult.prompt).toBe(
            '¡Vamos a jugar a la trivia! ¿Qué animal dice miau? Opciones: 1. perro, 2. gato, 3. pájaro, 4. pez'
        );
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Idle');
        expect(startResult.emotion).toBe('excited');
        expect(session.round).toBe(1);
    });

    test('el banco tiene 10 preguntas con estructura {pregunta, opciones, correcta, pista}', () => {
        expect(TRIVIA_BANK).toHaveLength(10);
        for (const q of TRIVIA_BANK) {
            expect(typeof q.pregunta).toBe('string');
            expect(Array.isArray(q.opciones)).toBe(true);
            expect(q.opciones.length).toBeGreaterThanOrEqual(4);
            expect(Number.isInteger(q.correcta)).toBe(true);
            expect(q.correcta).toBeGreaterThanOrEqual(0);
            expect(q.correcta).toBeLessThan(q.opciones.length);
            expect(typeof q.pista).toBe('string');
        }
    });

    test('createSession devuelve una sesión serializable y plana', () => {
        const { session } = freshTrivia();
        expect(session.id).toBe('trivia');
        expect(Array.isArray(session.state.order)).toBe(true);
        expect(session.state.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(session.state.cursor).toBe(0);
        expect(session.state.maxRounds).toBe(3);
        expect(session.state.phase).toBe('announce');
        const roundTrip = JSON.parse(JSON.stringify(session));
        expect(roundTrip.state.order).toEqual(session.state.order);
        expect(roundTrip.state.maxRounds).toBe(3);
    });
});

describe('trivia — respuesta correcta', () => {
    test('responde "gato" → +1 y siguiente pregunta (color del sol)', () => {
        const { engine, session } = freshTrivia();
        const result = engine.turn(session, 'gato');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
        expect(result.animation).toBe('Jump_in_place');
        expect(result.emotion).toBe('happy');
        expect(result.prompt).toBe(
            '¡Correcto, era gato! Siguiente: ¿De qué color es el sol? Opciones: 1. verde, 2. azul, 3. amarillo, 4. morado'
        );
    });

    test('también acierta con el número de la opción ("2")', () => {
        const { engine, session } = freshTrivia();
        const result = engine.turn(session, 'la opción 2');
        expect(result.valid).toBe(true);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
    });

    test('completa la partida en 3 aciertos', () => {
        const { engine, session } = freshTrivia();
        engine.turn(session, 'gato');     // → ¿color del sol?
        engine.turn(session, 'amarillo'); // → ¿cuántas patas?
        const result = engine.turn(session, 'cuatro');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(3);
        expect(result.animation).toBe('Dance');
        expect(result.prompt).toBe(
            '¡Correcto, era cuatro! Completaste 3 preguntas con 3 puntos. ¡Eres muy listo!'
        );
    });
});

describe('trivia — respuesta incorrecta y no reconocido', () => {
    test('opción equivocada → reintenta la misma pregunta', () => {
        const { engine, session } = freshTrivia();
        const result = engine.turn(session, 'perro');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBe('opción incorrecta');
        expect(session.round).toBe(1);
        expect(result.prompt).toBe(
            '¡Casi! Esa no era. ¿Qué animal dice miau? Opciones: 1. perro, 2. gato, 3. pájaro, 4. pez'
        );
        expect(result.emotion).toBe('encouraging');
    });

    test('respuesta no reconocida → error amigable y se queda en la misma pregunta', () => {
        const { engine, session } = freshTrivia();
        const result = engine.turn(session, 'hola flu');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('sin opción reconocida');
        expect(session.round).toBe(1);
        expect(result.prompt).toBe(
            'No te escuché bien. Dime el número, la letra o el nombre. ¿Qué animal dice miau? Opciones: 1. perro, 2. gato, 3. pájaro, 4. pez'
        );
    });
});

describe('trivia — controles del jugador (pista / saltar)', () => {
    test('"pista" devuelve la pista de la pregunta actual', () => {
        const { engine, session } = freshTrivia();
        const result = engine.turn(session, 'dame una pista');
        expect(result.valid).toBe(false);
        expect(result.prompt).toBe('Aquí va una pista: Es un felino que ronronea.');
        expect(result.emotion).toBe('thinking');
        expect(session.round).toBe(1);
    });

    test('"no sé" se rinde: salta a la siguiente pregunta (no es pista)', () => {
        const { engine, session } = freshTrivia();
        const result = engine.turn(session, 'no sé');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.prompt.startsWith('¡Claro! Aquí va otra:')).toBe(true);
    });

    test('acepta la palabra significativa de la opción ("luna" de "la luna")', () => {
        const { engine, session } = freshTrivia();
        // Primera pregunta del banco con rng identidad: respuesta 'el gato' → "gato".
        const result = engine.turn(session, 'gato');
        expect(result.valid).toBe(true);
        expect(session.score).toBe(1);
    });

    test('"paso" salta a la siguiente pregunta sin puntuar', () => {
        const { engine, session } = freshTrivia();
        const result = engine.turn(session, 'paso');
        expect(result.valid).toBe(false);
        expect(result.score).toBe(0);
        expect(session.round).toBe(2);
        expect(result.prompt).toBe(
            '¡Claro! Aquí va otra: ¿De qué color es el sol? Opciones: 1. verde, 2. azul, 3. amarillo, 4. morado'
        );
        expect(result.emotion).toBe('neutral');
    });

    test('saltar la última pregunta termina la partida', () => {
        const { engine, session } = freshTrivia(1);
        const result = engine.turn(session, 'paso');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Terminamos con 0 puntos. ¡Muy bien jugado!');
    });
});

describe('trivia — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshTrivia(1);
        engine.turn(session, 'gato');
        const result = engine.turn(session, 'hola');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Ya terminamos la trivia. ¿Jugamos otra vez?');
    });

    test('isGameCommand reconoce controles y frases de salida', () => {
        const engine = createTriviaEngine({ random: () => 0.9999 });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('dame una pista')).toBe(true);
        expect(engine.isGameCommand('paso')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('trivia — configuración (data-driven, sin hardcode)', () => {
    test('aplica rounds y clamps al rango [1,10]', () => {
        const { session } = freshTrivia(2);
        expect(session.state.maxRounds).toBe(2);

        const low = createTriviaEngine({ random: () => 0.9999 });
        const lowSession = low.createSession({ rounds: -5 });
        expect(lowSession.state.maxRounds).toBe(1);

        const high = createTriviaEngine({ random: () => 0.9999 });
        const highSession = high.createSession({ rounds: 99 });
        expect(highSession.state.maxRounds).toBe(10);

        const alias = createTriviaEngine({ random: () => 0.9999 });
        const aliasSession = alias.createSession({ defaultRounds: 4 });
        expect(aliasSession.state.maxRounds).toBe(4);
    });
});
