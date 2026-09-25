// ============================================================
// trabalenguas — Motor puro de Trabalenguas (plan-juegos §Fase 3).
//   - createTrabalenguasEngine({ random }) → GameEngine (RNG inyectable).
//   - FLU dice un trabalenguas; el niño debe repetir las palabras
//     clave (`claves`). "pista"/"no sé" → repite despacio; "paso" salta.
// Objetivo: validar el comportamiento REAL del motor con un RNG
// determinista (`() => 0.9999` → Fisher-Yates identidad → el primer
// trabalenguas es TRABALENGUAS_BANK[0]).
// Sin dummies: cada prompt es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createTrabalenguasEngine, TRABALENGUAS_BANK } from '../src/core/games/trabalenguas';

// random:()=>0.9999 → j = floor(0.9999*(i+1)) = i → order = [0,1,...,7] (identidad).
// Primer trabalenguas: TRABALENGUAS_BANK[0] = 'Tres tristes tigres...'.
function freshTrabalenguas(rounds = 3) {
    const engine = createTrabalenguasEngine({ random: () => 0.9999 });
    const session = engine.createSession({ rounds });
    const startResult = engine.start(session, { rounds });
    return { engine, session, startResult };
}

describe('trabalenguas — inicio de partida', () => {
    test('start anuncia el primer trabalenguas para repetir', () => {
        const { session, startResult } = freshTrabalenguas();
        expect(startResult.prompt).toBe(
            '¡Vamos a jugar con trabalenguas! Tres tristes tigres tragaban trigo en un trigal. Repítelo después de mí.'
        );
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Idle');
        expect(startResult.emotion).toBe('excited');
        expect(session.round).toBe(1);
    });

    test('el banco tiene 8 trabalenguas con estructura {texto, claves, pista}', () => {
        expect(TRABALENGUAS_BANK).toHaveLength(8);
        for (const item of TRABALENGUAS_BANK) {
            expect(typeof item.texto).toBe('string');
            expect(item.texto.length).toBeGreaterThan(0);
            expect(Array.isArray(item.claves)).toBe(true);
            expect(item.claves.length).toBeGreaterThan(0);
            expect(typeof item.pista).toBe('string');
        }
    });

    test('createSession devuelve una sesión serializable y plana', () => {
        const { session } = freshTrabalenguas();
        expect(session.id).toBe('trabalenguas');
        expect(Array.isArray(session.state.order)).toBe(true);
        expect(session.state.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        expect(session.state.cursor).toBe(0);
        expect(session.state.maxRounds).toBe(3);
        expect(session.state.phase).toBe('announce');
        const roundTrip = JSON.parse(JSON.stringify(session));
        expect(roundTrip.state.order).toEqual(session.state.order);
        expect(roundTrip.state.maxRounds).toBe(3);
    });
});

describe('trabalenguas — respuesta correcta', () => {
    test('repite las claves → +1 y siguiente trabalenguas (Pepe)', () => {
        const { engine, session } = freshTrabalenguas();
        const result = engine.turn(session, 'tres tristes tigres tragaban trigo en un trigal');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
        expect(result.animation).toBe('Jump_in_place');
        expect(result.emotion).toBe('happy');
        expect(result.prompt).toBe(
            '¡Muy bien! Siguiente: Pepe pica papas con un pico, papas pica Pepe. Repítelo después de mí.'
        );
    });

    test('completa la partida en 3 trabalenguas', () => {
        const { engine, session } = freshTrabalenguas();
        engine.turn(session, 'tres tristes tigres tragaban trigo'); // → Pepe
        engine.turn(session, 'pepe pica papas');                    // → cielo
        const result = engine.turn(session, 'el cielo esta enladrillado');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(3);
        expect(result.animation).toBe('Dance');
        expect(result.prompt).toBe(
            '¡Lengua rápida! Completaste 3 trabalenguas con 3 puntos. ¡Eres muy listo!'
        );
    });
});

describe('trabalenguas — respuesta incorrecta', () => {
    test('sin todas las claves → reintenta el mismo trabalenguas', () => {
        const { engine, session } = freshTrabalenguas();
        const result = engine.turn(session, 'tres tigres');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBe('repite no válido');
        expect(session.round).toBe(1);
        expect(result.prompt).toBe(
            '¡Casi! Inténtalo otra vez: Tres tristes tigres tragaban trigo en un trigal.'
        );
        expect(result.emotion).toBe('encouraging');
    });
});

describe('trabalenguas — controles del jugador (pista / saltar)', () => {
    test('"pista" repite despacio con la pista del trabalenguas actual', () => {
        const { engine, session } = freshTrabalenguas();
        const result = engine.turn(session, 'dame una pista');
        expect(result.valid).toBe(false);
        expect(result.prompt).toBe(
            'Vamos despacio: Tres tristes tigres tragaban trigo en un trigal. Recuerda: Unos animales rayados que comían trigo.'
        );
        expect(result.emotion).toBe('thinking');
        expect(session.round).toBe(1);
    });

    test('"no sé" salta al siguiente trabalenguas (en SKIP_FRAMES, no pista)', () => {
        const { engine, session } = freshTrabalenguas();
        const result = engine.turn(session, 'no sé');
        expect(result.valid).toBe(false);
        expect(result.score).toBe(0);
        expect(session.round).toBe(2);
        expect(result.prompt).toBe(
            '¡Claro! Aquí va otro: Pepe pica papas con un pico, papas pica Pepe. Repítelo después de mí.'
        );
        expect(result.emotion).toBe('neutral');
    });

    test('"paso" salta al siguiente trabalenguas sin puntuar', () => {
        const { engine, session } = freshTrabalenguas();
        const result = engine.turn(session, 'paso');
        expect(result.valid).toBe(false);
        expect(result.score).toBe(0);
        expect(session.round).toBe(2);
        expect(result.prompt).toBe(
            '¡Claro! Aquí va otro: Pepe pica papas con un pico, papas pica Pepe. Repítelo después de mí.'
        );
        expect(result.emotion).toBe('neutral');
    });

    test('saltar el último trabalenguas termina la partida', () => {
        const { engine, session } = freshTrabalenguas(1);
        const result = engine.turn(session, 'paso');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Terminamos con 0 puntos. ¡Muy bien jugado!');
    });
});

describe('trabalenguas — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshTrabalenguas(1);
        engine.turn(session, 'tres tristes tigres tragaban trigo en un trigal');
        const result = engine.turn(session, 'hola');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Ya terminamos los trabalenguas. ¿Jugamos otra vez?');
    });

    test('isGameCommand reconoce controles y frases de salida', () => {
        const engine = createTrabalenguasEngine({ random: () => 0.9999 });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('dame una pista')).toBe(true);
        expect(engine.isGameCommand('paso')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('trabalenguas — configuración (data-driven, sin hardcode)', () => {
    test('aplica rounds y clamps al rango [1,8]', () => {
        const { session } = freshTrabalenguas(2);
        expect(session.state.maxRounds).toBe(2);

        const low = createTrabalenguasEngine({ random: () => 0.9999 });
        const lowSession = low.createSession({ rounds: -5 });
        expect(lowSession.state.maxRounds).toBe(1);

        const high = createTrabalenguasEngine({ random: () => 0.9999 });
        const highSession = high.createSession({ rounds: 99 });
        expect(highSession.state.maxRounds).toBe(8);

        const alias = createTrabalenguasEngine({ random: () => 0.9999 });
        const aliasSession = alias.createSession({ defaultRounds: 4 });
        expect(aliasSession.state.maxRounds).toBe(4);
    });
});
