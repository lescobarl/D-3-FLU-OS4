// ============================================================
// ahorcado — Motor puro de Ahorcado (plan-juegos §Fase 3, Riesgo 3).
//   - createAhorcadoEngine({ random }) → GameEngine (RNG inyectable).
//   - Banco local de 15 palabras {palabra, pista}; se adivina letra
//     por letra (o la palabra completa) y FLU revela los aciertos.
//   - Controles: "pista"/"ayuda" revela la primera letra oculta;
//     "paso"/"siguiente" revela la palabra y salta.
// Objetivo: validar el comportamiento REAL del motor con un RNG
// determinista (`() => 0` → pickRandom devuelve AHORCADO_BANK[0] =
// "agua", pista "La bebes para tener sed."). Sin dummies: cada
// prompt es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createAhorcadoEngine, AHORCADO_BANK } from '../src/core/games/ahorcado';

// random:()=>0 → pickRandom(items) = items[floor(0*len)] = items[0] →
// la palabra siempre es AHORCADO_BANK[0] = "agua".
function freshAhorcado(config: Record<string, unknown> = {}) {
    const engine = createAhorcadoEngine({ random: () => 0 });
    const session = engine.createSession(config);
    const startResult = engine.start(session, config);
    return { engine, session, startResult };
}

describe('ahorcado — inicio de partida', () => {
    test('start anuncia la palabra oculta (agua, 4 letras)', () => {
        const { session, startResult } = freshAhorcado();
        expect(startResult.prompt).toBe(
            '¡Vamos a jugar al ahorcado! La palabra tiene 4 letras: _ _ _ _. Dime una letra.'
        );
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Idle');
        expect(startResult.emotion).toBe('excited');
        expect(session.round).toBe(1);
    });

    test('el banco tiene 15 palabras con estructura {palabra, pista}', () => {
        expect(AHORCADO_BANK).toHaveLength(15);
        for (const word of AHORCADO_BANK) {
            expect(typeof word.palabra).toBe('string');
            expect(word.palabra.length).toBeGreaterThan(0);
            expect(typeof word.pista).toBe('string');
            expect(word.pista.length).toBeGreaterThan(0);
        }
    });

    test('createSession devuelve una sesión serializable y plana', () => {
        const engine = createAhorcadoEngine({ random: () => 0 });
        const session = engine.createSession({});
        const state = session.state as Record<string, unknown>;
        expect(state.palabra).toBe('agua');
        expect(state.pista).toBe('La bebes para tener sed.');
        expect(state.adivinadas).toEqual([]);
        expect(state.intentos).toBe(6);
        expect(state.maxIntentos).toBe(6);
        expect(state.phase).toBe('announce');
        // Serializable: JSON round-trip mantiene el estado completo.
        expect(JSON.parse(JSON.stringify(session))).toEqual(session);
    });
});

describe('ahorcado — respuesta correcta (letra por letra)', () => {
    test('"a" revela la letra en la palabra', () => {
        const { engine, session } = freshAhorcado();
        const result = engine.turn(session, 'a');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(0);
        expect(result.animation).toBe('Jump_in_place');
        expect(result.emotion).toBe('happy');
        expect(result.prompt).toBe('¡La letra "a" está! a _ _ a Sigue así.');
        expect((session.state as { adivinadas: string[] }).adivinadas).toEqual(['a']);
    });

    test('la palabra completa "agua" gana la partida al instante', () => {
        const { engine, session } = freshAhorcado();
        const result = engine.turn(session, 'agua');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(1);
        expect(result.animation).toBe('Dance');
        expect(result.emotion).toBe('happy');
        expect(result.prompt).toBe('¡Correcto! La palabra era agua. ¡Eres muy listo!');
    });

    test('completa la palabra letra a letra hasta ganar', () => {
        const { engine, session } = freshAhorcado();
        engine.turn(session, 'a'); // → a _ _ a
        engine.turn(session, 'g'); // → a g _ a
        const result = engine.turn(session, 'u'); // completa "agua"
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(1);
        expect(result.prompt).toBe('¡Correcto! La palabra era agua. ¡Eres muy listo!');
    });
});

describe('ahorcado — respuesta incorrecta y límites de letra', () => {
    test('letra repetida → aviso amigable, sin castigo', () => {
        const { engine, session } = freshAhorcado();
        engine.turn(session, 'a');
        const result = engine.turn(session, 'a');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(0);
        expect(result.emotion).toBe('neutral');
        expect(result.prompt).toBe('La letra "a" ya la adivinaste. a _ _ a Dime otra letra.');
    });

    test('letra que no está → baja un intento', () => {
        const { engine, session } = freshAhorcado();
        const result = engine.turn(session, 'z');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBe('letra incorrecta');
        expect(result.emotion).toBe('encouraging');
        expect(result.prompt).toBe('La letra "z" no está. Quedan 5 intentos. _ _ _ _');
        expect((session.state as { intentos: number }).intentos).toBe(5);
    });

    test('sin letra reconocida → error amigable y se queda en la misma palabra', () => {
        const { engine, session } = freshAhorcado();
        const result = engine.turn(session, 'hola flu');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBe('sin letra reconocida');
        expect(result.prompt).toBe('No te escuché bien. Dime una letra o la palabra completa. _ _ _ _');
    });
});

describe('ahorcado — controles del jugador (pista / saltar)', () => {
    test('"dame una pista" revela la primera letra oculta y descuenta un intento', () => {
        const { engine, session } = freshAhorcado();
        const result = engine.turn(session, 'dame una pista');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.emotion).toBe('thinking');
        expect(result.prompt).toBe('Aquí va una pista: la letra "a" está en la palabra. a _ _ a Quedan 5 intentos.');
        expect((session.state as { intentos: number }).intentos).toBe(5);
    });

    test('"no sé" entrega pista (no salta: hint tiene prioridad)', () => {
        const { engine, session } = freshAhorcado();
        const result = engine.turn(session, 'no sé');
        expect(result.prompt).toBe('Aquí va una pista: la letra "a" está en la palabra. a _ _ a Quedan 5 intentos.');
        expect((session.state as { intentos: number }).intentos).toBe(5);
    });

    test('"paso" revela la palabra y termina sin puntuar', () => {
        const { engine, session } = freshAhorcado();
        const result = engine.turn(session, 'paso');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(0);
        expect(result.animation).toBe('Dance');
        expect(result.emotion).toBe('neutral');
        expect(result.prompt).toBe('La palabra era agua. ¡Jugamos otra y la adivinas!');
    });

    test('agotar los intentos termina la partida', () => {
        const { engine, session } = freshAhorcado({ intentos: 3 });
        engine.turn(session, 'z'); // Quedan 2
        engine.turn(session, 'x'); // Quedan 1
        const result = engine.turn(session, 'q'); // Se acaban
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(0);
        expect(result.prompt).toBe('Se acabaron los intentos. La palabra era agua. ¡Otra vez será!');
    });
});

describe('ahorcado — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshAhorcado();
        engine.turn(session, 'agua'); // gana
        const result = engine.turn(session, 'hola');
        expect(result.gameOver).toBe(true);
        expect(result.emotion).toBe('happy');
        expect(result.prompt).toBe('Ya terminamos el ahorcado. ¿Jugamos otra vez?');
    });

    test('isGameCommand reconoce controles y frases de salida', () => {
        const engine = createAhorcadoEngine({ random: () => 0 });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('dame una pista')).toBe(true);
        expect(engine.isGameCommand('paso')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('ahorcado — configuración (data-driven, sin hardcode)', () => {
    test('aplica intentos y clamps al rango [3,10]', () => {
        // Por debajo del mínimo → clamp a 3.
        const min = createAhorcadoEngine({ random: () => 0 }).createSession({ intentos: 2 }).state as {
            intentos: number;
            maxIntentos: number;
        };
        expect(min.intentos).toBe(3);
        expect(min.maxIntentos).toBe(3);

        // Por encima del máximo → clamp a 10.
        const max = createAhorcadoEngine({ random: () => 0 }).createSession({ intentos: 99 }).state as {
            intentos: number;
            maxIntentos: number;
        };
        expect(max.intentos).toBe(10);
        expect(max.maxIntentos).toBe(10);

        // Alias maxIntentos funciona cuando no hay intentos.
        const alias = createAhorcadoEngine({ random: () => 0 }).createSession({ maxIntentos: 4 }).state as {
            intentos: number;
            maxIntentos: number;
        };
        expect(alias.intentos).toBe(4);
        expect(alias.maxIntentos).toBe(4);
    });
});
