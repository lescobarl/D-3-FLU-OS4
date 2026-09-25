// ============================================================
// palabrasEncadenadas — Motor puro de Palabras encadenadas (plan-juegos §4).
//   - createPalabrasEncadenadasEngine({ random }) → GameEngine (RNG inyectable).
//   - FLU dice una palabra; el niño responde con otra que empieza
//     por la última letra de la anterior (+1 por enlace, sin
//     competitividad). Banco cerrado bajo encadenamiento.
// Objetivo: validar el comportamiento REAL del motor con un RNG
// determinista (`() => 0` → pickRandom elige siempre WORD_BANK[0]).
// Sin dummies: cada prompt es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createPalabrasEncadenadasEngine, WORD_BANK } from '../src/core/games/palabrasEncadenadas';

// random:()=>0 → pickRandom(WORD_BANK) = WORD_BANK[0] = 'avion' (termina en N).
// continuationFor(..., rng) con rng 0 elige siempre la primera candidata
// del banco: para 'nube' (E) → 'elefante'; para 'escoba' (A) → 'avion'.
function freshPalabras(rounds = 3) {
    const engine = createPalabrasEncadenadasEngine({ random: () => 0 });
    const session = engine.createSession({ rounds });
    const startResult = engine.start(session, { rounds });
    return { engine, session, startResult };
}

describe('palabrasEncadenadas — inicio de partida', () => {
    test('start anuncia la primera palabra (avion → N)', () => {
        const { session, startResult } = freshPalabras();
        expect(startResult.prompt).toBe(
            '¡Vamos a jugar a palabras encadenadas! Empiezo yo con avión. Di una palabra que empiece con la letra N.'
        );
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Idle');
        expect(startResult.emotion).toBe('excited');
        expect(session.round).toBe(1);
    });

    test('el banco está cerrado bajo encadenamiento (toda letra final tiene continuación)', () => {
        expect(WORD_BANK.length).toBeGreaterThan(0);
        for (const word of WORD_BANK) {
            expect(typeof word).toBe('string');
            expect(word.length).toBeGreaterThan(0);
        }
        // cada última letra tiene al menos una palabra que empieza con ella
        const letters = new Set(WORD_BANK.map((w) => w[w.length - 1]));
        for (const letter of letters) {
            expect(WORD_BANK.some((w) => w[0] === letter)).toBe(true);
        }
    });
});

describe('palabrasEncadenadas — enlaces válidos', () => {
    test('"nube" (empieza con N) → +1 y FLU continúa con "elefante"', () => {
        const { engine, session } = freshPalabras();
        const result = engine.turn(session, 'nube');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
        expect(result.animation).toBe('Jump_in_place');
        expect(result.prompt).toBe(
            '¡Genial, nube! Sigue tú: yo digo elefante. Di una palabra que empiece con la letra E.'
        );
    });

    test('completa la partida al llegar a rounds (3 enlaces)', () => {
        const { engine, session } = freshPalabras(3);
        engine.turn(session, 'nube');     // 1 → FLU: elefante (E)
        engine.turn(session, 'escoba');   // 2 → FLU: avion (N)
        const result = engine.turn(session, 'nube'); // 3 → fin
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(3);
        expect(result.prompt).toBe('¡Qué buena cadena! Encadenamos 3 palabras. ¡Eres muy creativo!');
    });
});

describe('palabrasEncadenadas — turnos incorrectos', () => {
    test('palabra que no empieza con la letra pedida → reintenta', () => {
        const { engine, session } = freshPalabras();
        const result = engine.turn(session, 'casa');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBe('la palabra no empieza con la letra pedida');
        expect(result.prompt).toBe('¡Casi! Tu palabra debe empezar con la letra N. Inténtalo otra vez.');
        expect(session.round).toBe(1); // no avanza
    });

    test('palabra fuera del banco → error amigable', () => {
        const { engine, session } = freshPalabras();
        const result = engine.turn(session, 'hola que tal');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('palabra desconocida');
        expect(result.prompt).toBe('No reconozco esa palabra. Di una palabra que empiece con la letra N.');
    });

    test('"paso" cierra la cadena con resumen', () => {
        const { engine, session } = freshPalabras();
        engine.turn(session, 'nube'); // 1 enlace
        const result = engine.turn(session, 'paso');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('¡Claro! La cadena quedó de 1 palabra. ¡Muy bien jugado!');
        expect(result.animation).toBe('Dance');
    });
});

describe('palabrasEncadenadas — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshPalabras(1);
        engine.turn(session, 'nube');
        const result = engine.turn(session, 'hola');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Ya terminamos de jugar palabras encadenadas. ¿Jugamos otra vez?');
    });

    test('isGameCommand reconoce controles y frases de salida', () => {
        const engine = createPalabrasEncadenadasEngine({ random: () => 0 });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('paso')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('palabrasEncadenadas — configuración (data-driven, sin hardcode)', () => {
    test('aplica clamps de rounds (1..10)', () => {
        const engine = createPalabrasEncadenadasEngine({ random: () => 0 });
        const session = engine.createSession({ rounds: 99 });
        const state = session.state as { maxRounds: number };
        expect(state.maxRounds).toBe(10); // MAX_ROUNDS
    });
});
