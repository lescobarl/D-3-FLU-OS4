// ============================================================
// abecedario — Motor puro del Abecedario (plan-juegos §Fase 3).
//   - createAbecedarioEngine({ random }) → GameEngine (RNG inyectable).
//   - FLU propone una letra; el niño dice una palabra que empiece
//     con esa letra (cualquier palabra válida por letra inicial).
//     "pista"/"no sé" → revela una palabra del banco; "paso" salta.
// Objetivo: validar el comportamiento REAL del motor con un RNG
// determinista (`() => 0.9999` → Fisher-Yates identidad → la primera
// letra es ABECEDARIO_BANK[0] = 'a').
// Sin dummies: cada prompt es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createAbecedarioEngine, ABECEDARIO_BANK } from '../src/core/games/abecedario';

// random:()=>0.9999 → j = floor(0.9999*(i+1)) = i → order = [0..11] (identidad).
// Primera letra: ABECEDARIO_BANK[0] = { letra: 'a', palabra: 'avión' }.
function freshAbecedario(rounds = 3) {
    const engine = createAbecedarioEngine({ random: () => 0.9999 });
    const session = engine.createSession({ rounds });
    const startResult = engine.start(session, { rounds });
    return { engine, session, startResult };
}

describe('abecedario — inicio de partida', () => {
    test('start anuncia la primera letra (a)', () => {
        const { session, startResult } = freshAbecedario();
        expect(startResult.prompt).toBe(
            '¡Vamos a jugar con el abecedario! Dime una palabra que empiece con la letra "a".'
        );
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Idle');
        expect(startResult.emotion).toBe('excited');
        expect(session.round).toBe(1);
    });

    test('el banco tiene estructura {letra, palabra, pista}, letras unicas y A-Z', () => {
        // No se congela el tamano (crecio de 12 a 27 sin que el juego cambiara): se
        // mide la ESTRUCTURA, la unicidad de la letra y que cubra el abecedario.
        expect(ABECEDARIO_BANK.length).toBeGreaterThanOrEqual(12);
        const letras = new Set<string>();
        for (const item of ABECEDARIO_BANK) {
            expect(item.letra.length).toBe(1);
            expect(typeof item.palabra).toBe('string');
            expect(item.palabra.length).toBeGreaterThan(0);
            expect(typeof item.pista).toBe('string');
            expect(item.pista.length).toBeGreaterThan(0);
            letras.add(item.letra.toLowerCase());
        }
        expect(letras.size).toBe(ABECEDARIO_BANK.length);
        for (const letra of 'abcdefghijklmnopqrstuvwxy') expect(letras.has(letra)).toBe(true);
    });

    test('createSession devuelve una sesión serializable y plana', () => {
        const { session } = freshAbecedario();
        expect(session.id).toBe('abecedario');
        expect(Array.isArray(session.state.order)).toBe(true);
        // El mazo recorre TODO el banco (antes 0..11 congelado; el banco ya tiene 27).
        expect(session.state.order).toHaveLength(ABECEDARIO_BANK.length);
        expect(new Set(session.state.order).size).toBe(ABECEDARIO_BANK.length);
        expect(session.state.order.every((i: number) => i >= 0 && i < ABECEDARIO_BANK.length)).toBe(true);
        expect(session.state.cursor).toBe(0);
        expect(session.state.maxRounds).toBe(3);
        expect(session.state.phase).toBe('announce');
        const roundTrip = JSON.parse(JSON.stringify(session));
        expect(roundTrip.state.order).toEqual(session.state.order);
        expect(roundTrip.state.maxRounds).toBe(3);
    });
});

describe('abecedario — respuesta correcta', () => {
    test('dice "abeja" → +1 y siguiente letra (b)', () => {
        const { engine, session } = freshAbecedario();
        const result = engine.turn(session, 'abeja');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
        expect(result.animation).toBe('Jump_in_place');
        expect(result.emotion).toBe('happy');
        expect(result.prompt).toBe(
            '¡Muy bien! "abeja" empieza con la "a". Ahora dime una palabra que empiece con la letra "b".'
        );
    });

    test('completa la partida en 3 letras', () => {
        const { engine, session } = freshAbecedario();
        engine.turn(session, 'abeja');   // → b
        engine.turn(session, 'barco');   // → c
        const result = engine.turn(session, 'caballo');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(3);
        expect(result.animation).toBe('Dance');
        expect(result.prompt).toBe(
            '¡Muy bien! "caballo" empieza con la "c". Completaste 3 letras con 3 puntos. ¡Conoces el abecedario!'
        );
    });

    test('stopwords NO cuentan como palabra ("el", "lo", "se", "te"…)', () => {
        const { engine, session } = freshAbecedario();
        expect(engine.turn(session, 'el').valid).toBe(false);
        expect(engine.turn(session, 'lo').valid).toBe(false);
        expect(engine.turn(session, 'es').valid).toBe(false);
        expect(session.score).toBe(0);
    });
});

describe('abecedario — respuesta incorrecta', () => {
    test('palabra que no empieza con la letra → reintenta la misma letra', () => {
        const { engine, session } = freshAbecedario();
        const result = engine.turn(session, 'zapato');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBe('palabra incorrecta');
        expect(session.round).toBe(1);
        expect(result.prompt).toBe(
            'Casi... Dime una palabra que empiece con la letra "a".'
        );
        expect(result.emotion).toBe('encouraging');
    });
});

describe('abecedario — controles del jugador (pista / saltar)', () => {
    test('"pista" revela la palabra del banco para la letra actual', () => {
        const { engine, session } = freshAbecedario();
        const result = engine.turn(session, 'dame una pista');
        expect(result.valid).toBe(false);
        expect(result.prompt).toBe(
            'La palabra "avión" empieza con la "a". Vuela por el cielo. Ahora dime otra que empiece con la "a".'
        );
        expect(result.emotion).toBe('thinking');
        expect(session.round).toBe(1);
    });

    test('"no se" entrega pista (no salta: hint tiene prioridad)', () => {
        const { engine, session } = freshAbecedario();
        const result = engine.turn(session, 'no se');
        expect(result.prompt).toBe(
            'La palabra "avión" empieza con la "a". Vuela por el cielo. Ahora dime otra que empiece con la "a".'
        );
        expect(session.round).toBe(1);
    });

    test('"paso" salta a la siguiente letra sin puntuar', () => {
        const { engine, session } = freshAbecedario();
        const result = engine.turn(session, 'paso');
        expect(result.valid).toBe(false);
        expect(result.score).toBe(0);
        expect(session.round).toBe(2);
        expect(result.prompt).toBe(
            '¡Claro! Ahora dime una palabra que empiece con la letra "b".'
        );
        expect(result.emotion).toBe('neutral');
    });

    test('saltar la última letra termina la partida', () => {
        const { engine, session } = freshAbecedario(1);
        const result = engine.turn(session, 'paso');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Terminamos con 0 puntos. ¡Muy bien jugado!');
    });
});

describe('abecedario — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshAbecedario(1);
        engine.turn(session, 'abeja');
        const result = engine.turn(session, 'hola');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Ya terminamos con las letras. ¿Jugamos otra vez?');
    });

    test('isGameCommand reconoce controles y frases de salida', () => {
        const engine = createAbecedarioEngine({ random: () => 0.9999 });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('dame una pista')).toBe(true);
        expect(engine.isGameCommand('paso')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('abecedario — configuración (data-driven, sin hardcode)', () => {
    test('aplica rounds y clamps al rango [1, banco]', () => {
        const { session } = freshAbecedario(2);
        expect(session.state.maxRounds).toBe(2);

        const low = createAbecedarioEngine({ random: () => 0.9999 });
        const lowSession = low.createSession({ rounds: -5 });
        expect(lowSession.state.maxRounds).toBe(1);

        const high = createAbecedarioEngine({ random: () => 0.9999 });
        const highSession = high.createSession({ rounds: 99 });
        // El tope no es un numero magico: es el tamano del banco (crecio 12 -> 27).
        expect(highSession.state.maxRounds).toBe(ABECEDARIO_BANK.length);

        const alias = createAbecedarioEngine({ random: () => 0.9999 });
        const aliasSession = alias.createSession({ defaultRounds: 4 });
        expect(aliasSession.state.maxRounds).toBe(4);
    });
});
