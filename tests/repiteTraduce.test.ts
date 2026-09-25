// ============================================================
// repiteTraduce — Motor puro de "Repite y traduce" (plan-juegos §Fase 3).
//   - createRepiteTraduceEngine({ random }) → GameEngine (RNG inyectable).
//   - FLU dice una palabra en español; el niño la traduce al inglés
//     (se acepta el español o el inglés por keyword).
//     "pista"/"no sé" → da la traducción; "paso" salta.
// Objetivo: validar el comportamiento REAL del motor con un RNG
// determinista (`() => 0.9999` → Fisher-Yates identidad → la primera
// palabra es REPITE_BANK[0] = { es: 'perro', en: 'dog' }).
// Sin dummies: cada prompt es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createRepiteTraduceEngine, REPITE_BANK } from '../src/core/games/repiteTraduce';

// random:()=>0.9999 → j = floor(0.9999*(i+1)) = i → order = [0..9] (identidad).
// Primera palabra: REPITE_BANK[0] = 'perro' → 'dog'.
function freshRepite(rounds = 3) {
    const engine = createRepiteTraduceEngine({ random: () => 0.9999 });
    const session = engine.createSession({ rounds });
    const startResult = engine.start(session, { rounds });
    return { engine, session, startResult };
}

describe('repiteTraduce — inicio de partida', () => {
    test('start anuncia la primera palabra (perro)', () => {
        const { session, startResult } = freshRepite();
        expect(startResult.prompt).toBe(
            '¡Vamos a practicar inglés! ¿Cómo se dice "perro" en inglés?'
        );
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Idle');
        expect(startResult.emotion).toBe('excited');
        expect(session.round).toBe(1);
    });

    test('el banco tiene 10 palabras con estructura {es, en, pista}', () => {
        expect(REPITE_BANK).toHaveLength(10);
        for (const item of REPITE_BANK) {
            expect(typeof item.es).toBe('string');
            expect(item.es.length).toBeGreaterThan(0);
            expect(typeof item.en).toBe('string');
            expect(item.en.length).toBeGreaterThan(0);
            expect(typeof item.pista).toBe('string');
            expect(item.pista.length).toBeGreaterThan(0);
        }
    });

    test('createSession devuelve una sesión serializable y plana', () => {
        const { session } = freshRepite();
        expect(session.id).toBe('repite_traduce');
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

describe('repiteTraduce — respuesta correcta', () => {
    test('dice "dog" → +1 y siguiente palabra (gato)', () => {
        const { engine, session } = freshRepite();
        const result = engine.turn(session, 'dog');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
        expect(result.animation).toBe('Jump_in_place');
        expect(result.emotion).toBe('happy');
        expect(result.prompt).toBe(
            '¡Muy bien! "perro" es "dog". Siguiente: ¿Cómo se dice "gato" en inglés?'
        );
    });

    test('completa la partida en 3 palabras', () => {
        const { engine, session } = freshRepite();
        engine.turn(session, 'dog');     // → gato
        engine.turn(session, 'cat');     // → casa
        const result = engine.turn(session, 'house');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(3);
        expect(result.animation).toBe('Dance');
        expect(result.prompt).toBe(
            '¡Muy bien! "casa" es "house" en inglés. Completaste 3 palabras con 3 puntos. ¡Eres muy listo!'
        );
    });
});

describe('repiteTraduce — respuesta incorrecta', () => {
    test('palabra equivocada → reintenta la misma palabra', () => {
        const { engine, session } = freshRepite();
        const result = engine.turn(session, 'caballo');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBe('traducción incorrecta');
        expect(session.round).toBe(1);
        expect(result.prompt).toBe(
            '¡Casi! "perro" en inglés se dice "dog". Inténtalo otra vez.'
        );
        expect(result.emotion).toBe('encouraging');
    });
});

describe('repiteTraduce — controles del jugador (pista / saltar)', () => {
    test('"pista" da la traducción de la palabra actual', () => {
        const { engine, session } = freshRepite();
        const result = engine.turn(session, 'dame una pista');
        expect(result.valid).toBe(false);
        expect(result.prompt).toBe(
            '"perro" en inglés se dice "dog". Es el mejor amigo del hombre y dice guau. Ahora repítelo.'
        );
        expect(result.emotion).toBe('thinking');
        expect(session.round).toBe(1);
    });

    test('"no se" entrega pista (no salta: hint tiene prioridad)', () => {
        const { engine, session } = freshRepite();
        const result = engine.turn(session, 'no se');
        expect(result.prompt).toBe(
            '"perro" en inglés se dice "dog". Es el mejor amigo del hombre y dice guau. Ahora repítelo.'
        );
        expect(session.round).toBe(1);
    });

    test('"paso" salta a la siguiente palabra sin puntuar', () => {
        const { engine, session } = freshRepite();
        const result = engine.turn(session, 'paso');
        expect(result.valid).toBe(false);
        expect(result.score).toBe(0);
        expect(session.round).toBe(2);
        expect(result.prompt).toBe(
            '¡Claro! Aquí va otra: ¿Cómo se dice "gato" en inglés?'
        );
        expect(result.emotion).toBe('neutral');
    });

    test('saltar la última palabra termina la partida', () => {
        const { engine, session } = freshRepite(1);
        const result = engine.turn(session, 'paso');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Terminamos con 0 puntos. ¡Muy bien jugado!');
    });
});

describe('repiteTraduce — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshRepite(1);
        engine.turn(session, 'dog');
        const result = engine.turn(session, 'hola');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Ya terminamos de practicar inglés. ¿Jugamos otra vez?');
    });

    test('isGameCommand reconoce controles y frases de salida', () => {
        const engine = createRepiteTraduceEngine({ random: () => 0.9999 });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('dame una pista')).toBe(true);
        expect(engine.isGameCommand('paso')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('repiteTraduce — configuración (data-driven, sin hardcode)', () => {
    test('aplica rounds y clamps al rango [1,10]', () => {
        const { session } = freshRepite(2);
        expect(session.state.maxRounds).toBe(2);

        const low = createRepiteTraduceEngine({ random: () => 0.9999 });
        const lowSession = low.createSession({ rounds: -5 });
        expect(lowSession.state.maxRounds).toBe(1);

        const high = createRepiteTraduceEngine({ random: () => 0.9999 });
        const highSession = high.createSession({ rounds: 99 });
        expect(highSession.state.maxRounds).toBe(10);

        const alias = createRepiteTraduceEngine({ random: () => 0.9999 });
        const aliasSession = alias.createSession({ defaultRounds: 4 });
        expect(aliasSession.state.maxRounds).toBe(4);
    });
});
