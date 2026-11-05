// ============================================================
// adivinaNumero — Motor puro de Adivina el número (plan-juegos §4).
//   - createAdivinaNumeroEngine({ random }) → GameEngine (RNG inyectable).
//   - FLU piensa un número en [min, max]; el niño adivina con
//     indicador frío/caliente (distancia al número oculto) y pistas
//     de paridad hasta pistasMax.
// Objetivo: validar el comportamiento REAL del motor con un RNG
// determinista (`() => 0` → pickNumber devuelve siempre min = 1).
// Sin dummies: cada prompt es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createAdivinaNumeroEngine } from '../src/core/games/adivinaNumero';

// random:()=>0 → pickNumber(min,max) = min + floor(0*range) = min.
// Con el rango por defecto [1,20], el número oculto es SIEMPRE 1.
function freshAdivina(config: Record<string, unknown> = {}) {
    const engine = createAdivinaNumeroEngine({ random: () => 0 });
    const session = engine.createSession(config);
    const startResult = engine.start(session, config);
    return { engine, session, startResult };
}

describe('adivinaNumero — inicio de partida', () => {
    test('start anuncia el rango [1,20] y el reto', () => {
        const { session, startResult } = freshAdivina();
        expect(startResult.prompt).toBe(
            '¡Vamos a jugar a adivinar el número! Estoy pensando en un número entre 1 y 20. ¿Cuál es?'
        );
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Idle');
        expect(startResult.emotion).toBe('excited');
        expect(session.round).toBe(1);
    });

    test('createSession devuelve una sesión serializable y plana', () => {
        const engine = createAdivinaNumeroEngine({ random: () => 0 });
        const session = engine.createSession({});
        expect(session).toMatchObject({ id: 'adivina_numero', score: 0, round: 1 });
        expect(session.state).toBeTypeOf('object');
        expect(JSON.parse(JSON.stringify(session))).toEqual(session);
    });
});

describe('adivinaNumero — acierto y fin', () => {
    test('adivina el número en el primer intento → +1 punto y fin', () => {
        const { engine, session } = freshAdivina();
        const result = engine.turn(session, '1');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(1);
        expect(result.animation).toBe('Dance');
        expect(result.prompt).toBe('¡Correcto! El número era 1. Lo adivinaste en 1 intento. ¡Eres un genio!');
    });

    test('número en letras: "uno" también acierta', () => {
        const { engine, session } = freshAdivina();
        const result = engine.turn(session, 'uno');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(1);
    });

    test('"paso" revela el número y termina', () => {
        const { engine, session } = freshAdivina();
        const result = engine.turn(session, 'paso');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(0);
        expect(result.prompt).toBe('¡El número era 1! Terminamos con 0 puntos. ¡Otra vez será!');
        expect(result.won).toBe(false);
    });
});

describe('adivinaNumero — pistas de paridad', () => {
    test('"dame una pista" revela la paridad del número oculto', () => {
        const { engine, session } = freshAdivina();
        const result = engine.turn(session, 'dame una pista');
        expect(result.valid).toBe(false);
        expect(result.prompt).toBe('Te doy una pista: mi número es impar.');
        expect(result.emotion).toBe('thinking');
        expect(session.round).toBe(1);
    });

    test('se agotan las pistas tras pistasMax', () => {
        const { engine, session } = freshAdivina({ pistasMax: 1 });
        engine.turn(session, 'pista'); // única pista disponible
        const result = engine.turn(session, 'ayuda');
        expect(result.prompt).toBe('Ya te di todas mis pistas. ¡Sigue adivinando!');
        expect(result.emotion).toBe('neutral');
    });
});

describe('adivinaNumero — frío/caliente y errores', () => {
    test('intento alto → "más pequeño", frío al inicio y caliente al acercarse', () => {
        const { engine, session } = freshAdivina();
        const first = engine.turn(session, '10');
        expect(first.valid).toBe(false);
        expect(first.prompt).toBe('Mi número es más pequeño que 10. Estás frío. Sigue intentando.');
        const second = engine.turn(session, '5');
        expect(second.prompt).toBe('Mi número es más pequeño que 5. ¡Estás caliente! Sigue intentando.');
        const win = engine.turn(session, '1');
        expect(win.valid).toBe(true);
        expect(win.score).toBe(1);
    });

    test('número fuera de rango → error amigable', () => {
        const { engine, session } = freshAdivina();
        const result = engine.turn(session, '25');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('número fuera de rango');
        expect(result.prompt).toBe('Mi número está entre 1 y 20. Inténtalo otra vez.');
    });

    test('sin número reconocido → error amigable', () => {
        const { engine, session } = freshAdivina();
        const result = engine.turn(session, 'hola que tal');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('no se reconoció ningún número');
        expect(result.prompt).toBe('No logré reconocer un número. Dime un número entre 1 y 20.');
    });
});

describe('adivinaNumero — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshAdivina();
        engine.turn(session, '1');
        const result = engine.turn(session, '5');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Ya terminamos de adivinar el número. ¿Jugamos otra vez?');
    });

    test('isGameCommand reconoce controles y frases de salida', () => {
        const engine = createAdivinaNumeroEngine({ random: () => 0 });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('dame una pista')).toBe(true);
        expect(engine.isGameCommand('paso')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('adivinaNumero — configuración (data-driven, sin hardcode)', () => {
    test('aplica min/max configurados y clamps de pistasMax', () => {
        const engine = createAdivinaNumeroEngine({ random: () => 0 });
        const session = engine.createSession({ min: 5, max: 10, pistasMax: 99 });
        const state = session.state as { number: number; min: number; max: number; pistasMax: number };
        expect(state.min).toBe(5);
        expect(state.max).toBe(10);
        expect(state.number).toBe(5); // rng 0 → min
        expect(state.pistasMax).toBe(10); // MAX clamp
    });
});
