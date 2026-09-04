// ============================================================
// memoriaSecuencias — Motor puro de Memoria de secuencias
// (plan-juegos §Fase 3, Riesgo 3). Estilo simonDice con letras.
//   - createMemoriaSecuenciasEngine({ random }) → GameEngine.
//   - FLU anuncia una secuencia (A B) que crece cada ronda; el
//     jugador la repite en orden. Validación por subsecuencia
//     ordenada (tolerante a ruido de transcripción).
// Objetivo: validar el comportamiento REAL del motor con un RNG
// determinista (`() => 0` → buildSequence elige siempre
// MEMORY_LETTERS[0] = 'A' → secuencia inicial ['A','A']). Sin
// dummies: cada prompt es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import {
    createMemoriaSecuenciasEngine,
    MEMORY_LETTERS,
} from '../src/core/games/memoriaSecuencias';

// random:()=>0 → buildSequence(2) = ['A','A']; cada nueva ronda
// añade otra 'A' → ['A','A','A'], ['A','A','A','A'], ...
function freshMemoria(config: Record<string, unknown> = {}) {
    const engine = createMemoriaSecuenciasEngine({ random: () => 0 });
    const session = engine.createSession(config);
    const startResult = engine.start(session, config);
    return { engine, session, startResult };
}

describe('memoria_secuencias — inicio de partida', () => {
    test('start anuncia la secuencia inicial (A B)', () => {
        const { session, startResult } = freshMemoria();
        expect(startResult.prompt).toBe(
            '¡Vamos a entrenar la memoria! Memoriza esta secuencia: A A. Repítela en orden.'
        );
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Idle');
        expect(startResult.emotion).toBe('excited');
        expect(session.round).toBe(1);
    });

    test('MEMORY_LETTERS tiene 8 letras (A–H)', () => {
        expect(MEMORY_LETTERS).toHaveLength(8);
        expect(MEMORY_LETTERS).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    });

    test('createSession devuelve una sesión serializable y plana', () => {
        const engine = createMemoriaSecuenciasEngine({ random: () => 0 });
        const session = engine.createSession({});
        const state = session.state as Record<string, unknown>;
        expect(state.sequence).toEqual(['A', 'A']);
        expect(state.cursor).toBe(0);
        expect(state.maxRounds).toBe(3);
        expect(state.longMax).toBe(6);
        expect(state.phase).toBe('announce');
        // Serializable: JSON round-trip mantiene el estado completo.
        expect(JSON.parse(JSON.stringify(session))).toEqual(session);
    });
});

describe('memoria_secuencias — respuesta correcta', () => {
    test('"a a" repite la secuencia → +1 punto y crece a A A A', () => {
        const { engine, session } = freshMemoria();
        const result = engine.turn(session, 'a a');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
        expect(result.animation).toBe('Jump_in_place');
        expect(result.emotion).toBe('happy');
        expect(result.prompt).toBe('¡Exacto! A A. Siguiente secuencia: A A A. Repítela.');
    });

    test('tolerancia a ruido: "a x a" también acierta (subsecuencia ordenada)', () => {
        const { engine, session } = freshMemoria();
        const result = engine.turn(session, 'a x a');
        expect(result.valid).toBe(true);
        expect(result.score).toBe(1);
        expect(result.prompt).toBe('¡Exacto! A A. Siguiente secuencia: A A A. Repítela.');
    });

    test('completa la partida en 3 aciertos', () => {
        const { engine, session } = freshMemoria();
        engine.turn(session, 'a a');     // → A A A
        engine.turn(session, 'a a a');   // → A A A A
        const result = engine.turn(session, 'a a a a');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(3);
        expect(result.animation).toBe('Dance');
        expect(result.emotion).toBe('happy');
        expect(result.prompt).toBe(
            '¡Memoria de elefante! Completaste 3 rondas con 3 puntos. ¡Eres muy listo!'
        );
    });
});

describe('memoria_secuencias — respuesta incorrecta y no reconocido', () => {
    test('secuencia equivocada con letras → reintenta la misma secuencia', () => {
        const { engine, session } = freshMemoria();
        const result = engine.turn(session, 'a c');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBe('secuencia incorrecta');
        expect(result.emotion).toBe('encouraging');
        expect(result.prompt).toBe('Casi. La secuencia era A A. Inténtalo de nuevo.');
        expect(session.round).toBe(1); // no avanza
    });

    test('sin letras reconocidas → error amigable', () => {
        const { engine, session } = freshMemoria();
        const result = engine.turn(session, 'hola flu');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBe('sin letras reconocidas');
        expect(result.emotion).toBe('neutral');
        expect(result.prompt).toBe('No te escuché bien. Repite la secuencia: A A.');
    });
});

describe('memoria_secuencias — controles del jugador (pista / saltar)', () => {
    test('"dame una pista" repite la secuencia actual', () => {
        const { engine, session } = freshMemoria();
        const result = engine.turn(session, 'dame una pista');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.emotion).toBe('thinking');
        expect(result.prompt).toBe('La secuencia es: A A. Repítela en orden.');
        expect(session.round).toBe(1);
    });

    test('"paso" salta la ronda sin puntuar', () => {
        const { engine, session } = freshMemoria();
        const result = engine.turn(session, 'paso');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(0);
        expect(session.round).toBe(2);
        expect(result.emotion).toBe('neutral');
        expect(result.prompt).toBe('¡Claro! Siguiente secuencia: A A A. Repítela.');
    });

    test('saltar la última ronda termina la partida', () => {
        const { engine, session } = freshMemoria({ rounds: 1 });
        const result = engine.turn(session, 'paso');
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(0);
        expect(result.animation).toBe('Dance');
        expect(result.emotion).toBe('happy');
        expect(result.prompt).toBe('Terminamos con 0 puntos. ¡Muy bien jugado!');
    });
});

describe('memoria_secuencias — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshMemoria({ rounds: 1 });
        engine.turn(session, 'paso'); // termina
        const result = engine.turn(session, 'hola');
        expect(result.gameOver).toBe(true);
        expect(result.emotion).toBe('happy');
        expect(result.prompt).toBe('Ya terminamos con la memoria. ¿Jugamos otra vez?');
    });

    test('isGameCommand reconoce controles y frases de salida', () => {
        const engine = createMemoriaSecuenciasEngine({ random: () => 0 });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('dame una pista')).toBe(true);
        expect(engine.isGameCommand('paso')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('memoria_secuencias — configuración (data-driven, sin hardcode)', () => {
    test('aplica rounds y clamps al rango [1,6]', () => {
        // Por debajo del mínimo → clamp a 1.
        const min = createMemoriaSecuenciasEngine({ random: () => 0 }).createSession({ rounds: -5 }).state as {
            maxRounds: number;
        };
        expect(min.maxRounds).toBe(1);

        // Por encima del máximo → clamp a 6.
        const max = createMemoriaSecuenciasEngine({ random: () => 0 }).createSession({ rounds: 9 }).state as {
            maxRounds: number;
        };
        expect(max.maxRounds).toBe(6);

        // Alias defaultRounds funciona cuando no hay rounds.
        const alias = createMemoriaSecuenciasEngine({ random: () => 0 }).createSession({ defaultRounds: 2 }).state as {
            maxRounds: number;
        };
        expect(alias.maxRounds).toBe(2);
    });

    test('aplica longMax/longitudMax y clamps al rango [1,8]', () => {
        const engine = createMemoriaSecuenciasEngine({ random: () => 0 });

        const min = engine.createSession({ longMax: -2 }).state as { longMax: number };
        expect(min.longMax).toBe(1);

        const max = engine.createSession({ longMax: 9 }).state as { longMax: number };
        expect(max.longMax).toBe(8);

        const alias = engine.createSession({ longitudMax: 3 }).state as { longMax: number };
        expect(alias.longMax).toBe(3);
    });
});
