// ============================================================
// veoVeo — Motor puro de Veo veo (plan-juegos §4).
//   - createVeoVeoEngine({ random }) → GameEngine (RNG inyectable).
//   - FLU anuncia una cosita por su PRIMERA LETRA; el niño adivina.
//     Validación por keywords con límites de palabra y sinónimos.
//     "pista"/"no sé" → pista de categoría; "paso" salta.
// Objetivo: validar el comportamiento REAL del motor con un RNG
// determinista (`() => 0.9999` → shuffleOrder devuelve el orden
// idéntico [0..11] → el primer objeto es VEO_VEO_BANK[0] = manzana).
// Sin dummies: cada prompt es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createVeoVeoEngine, VEO_VEO_BANK } from '../src/core/games/veoVeo';

// random:()=>0.9999 → Fisher-Yates elige siempre el propio índice →
// order = [0,1,...,11] (identidad). Primer objeto: VEO_VEO_BANK[0] = manzana.
function freshVeo(rounds = 3) {
    const engine = createVeoVeoEngine({ random: () => 0.9999 });
    const session = engine.createSession({ rounds });
    const startResult = engine.start(session, { rounds });
    return { engine, session, startResult };
}

describe('veoVeo — inicio de partida', () => {
    test('start anuncia el primer objeto por su letra (manzana → M)', () => {
        const { session, startResult } = freshVeo();
        expect(startResult.prompt).toBe(
            '¡Vamos a jugar a veo veo! Veo una cosita que empieza con la letra M y es una fruta roja y dulce. ¿Qué es?'
        );
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Idle');
        expect(startResult.emotion).toBe('excited');
        expect(session.round).toBe(1);
    });

    test('el banco tiene 12 objetos con estructura {nombre, categoria, keywords}', () => {
        expect(VEO_VEO_BANK).toHaveLength(12);
        for (const item of VEO_VEO_BANK) {
            expect(typeof item.nombre).toBe('string');
            expect(item.nombre.length).toBeGreaterThan(0);
            expect(typeof item.categoria).toBe('string');
            expect(Array.isArray(item.keywords)).toBe(true);
            expect(item.keywords.length).toBeGreaterThan(0);
        }
    });
});

describe('veoVeo — aciertos', () => {
    test('responde "manzana" → +1 y siguiente objeto (sol → S)', () => {
        const { engine, session } = freshVeo();
        const result = engine.turn(session, 'manzana');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
        expect(result.animation).toBe('Jump_in_place');
        expect(result.prompt).toBe(
            '¡Correcto, es manzana! Veo una cosita que empieza con la letra S y es una cosa del cielo que da calor. ¿Qué es?'
        );
    });

    test('completa la partida en 3 aciertos (alias "perrito" para perro)', () => {
        const { engine, session } = freshVeo(3);
        engine.turn(session, 'manzana'); // → sol
        engine.turn(session, 'sol');     // → perro
        const result = engine.turn(session, 'perrito');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(3);
        expect(result.prompt).toBe(
            '¡Correcto, es perro! Completaste 3 rondas de veo veo. ¡Eres un gran detective!'
        );
    });
});

describe('veoVeo — pistas y turnos incorrectos', () => {
    test('"dame una pista" revela la categoría', () => {
        const { engine, session } = freshVeo();
        const result = engine.turn(session, 'dame una pista');
        expect(result.valid).toBe(false);
        expect(result.prompt).toBe('¡Uy! Te doy una pista: es algo de una fruta roja y dulce. ¿Ya sabes qué es?');
        expect(result.emotion).toBe('thinking');
        expect(session.round).toBe(1);
    });

    test('respuesta incorrecta → reintenta el mismo objeto', () => {
        const { engine, session } = freshVeo();
        const result = engine.turn(session, 'gato');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBe('respuesta incorrecta');
        expect(result.prompt).toBe(            '¡Casi! Inténtalo otra vez. Veo una cosita que empieza con la letra M y es una fruta roja y dulce. ¿Qué es?');
        expect(session.round).toBe(1); // no avanza
    });

    test('"paso" salta al siguiente objeto sin puntuar', () => {
        const { engine, session } = freshVeo();
        const result = engine.turn(session, 'paso');
        expect(result.valid).toBe(false);
        expect(result.score).toBe(0);
        expect(session.round).toBe(2);
        expect(result.prompt).toBe(
            '¡Claro! Era manzana. Veo una cosita que empieza con la letra S y es una cosa del cielo que da calor. ¿Qué es?'
        );
    });

    test('saltar el último objeto termina la partida', () => {
        const { engine, session } = freshVeo(1);
        const result = engine.turn(session, 'paso');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Terminamos con 0 puntos. ¡Muy bien jugado!');
    });
});

describe('veoVeo — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshVeo(1);
        engine.turn(session, 'manzana');
        const result = engine.turn(session, 'hola');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Ya terminamos de jugar veo veo. ¿Jugamos otra vez?');
    });

    test('isGameCommand reconoce controles y frases de salida', () => {
        const engine = createVeoVeoEngine({ random: () => 0.9999 });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('dame una pista')).toBe(true);
        expect(engine.isGameCommand('paso')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('veoVeo — configuración (data-driven, sin hardcode)', () => {
    test('aplica clamps de rounds (1..12)', () => {
        const engine = createVeoVeoEngine({ random: () => 0.9999 });
        const session = engine.createSession({ rounds: 99 });
        const state = session.state as { maxRounds: number };
        expect(state.maxRounds).toBe(12); // MAX_ROUNDS = VEO_VEO_BANK.length
    });
});
