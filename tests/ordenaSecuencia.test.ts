// ============================================================
// ordenaSecuencia — Motor puro de "Ordena la secuencia" (§Fase 3).
//   - createOrdenaSecuenciaEngine({ random }) → GameEngine (RNG inyectable).
//   - FLU muestra los pasos de una rutina en DESORDEN (A, B, C...);
//     el jugador los recita en el orden correcto por palabras clave.
//     "pista"/"no sé" → muestra el orden correcto; "paso" salta.
// Objetivo: validar el comportamiento REAL del motor con un RNG
// determinista (`() => 0.9999` → Fisher-Yates identidad en AMBOS
// shuffles → la primera secuencia es ORDENA_BANK[0] = 'lavarse las
// manos' con los pasos en su orden natural A→D).
// Sin dummies: cada prompt es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createOrdenaSecuenciaEngine, ORDENA_BANK } from '../src/core/games/ordenaSecuencia';

// random:()=>0.9999 → j = floor(0.9999*(i+1)) = i → identidad.
// Primera secuencia: ORDENA_BANK[0] = 'lavarse las manos'.
function freshOrdena(rounds = 3) {
    const engine = createOrdenaSecuenciaEngine({ random: () => 0.9999 });
    const session = engine.createSession({ rounds });
    const startResult = engine.start(session, { rounds });
    return { engine, session, startResult };
}

describe('ordena_secuencia — inicio de partida', () => {
    test('start anuncia la primera secuencia (lavarse las manos) con pasos A–D', () => {
        const { session, startResult } = freshOrdena();
        expect(startResult.prompt).toBe(
            '¡Vamos a ordenar los pasos para lavarse las manos! Dime los pasos en el orden correcto: A) abrir el agua, B) ponerse jabón, C) enjuagarse, D) secarse con la toalla'
        );
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Idle');
        expect(startResult.emotion).toBe('excited');
        expect(session.round).toBe(1);
    });

    test('el banco tiene 5 secuencias con estructura {titulo, pasos, pista} de 4 pasos', () => {
        expect(ORDENA_BANK).toHaveLength(5);
        for (const item of ORDENA_BANK) {
            expect(typeof item.titulo).toBe('string');
            expect(item.titulo.length).toBeGreaterThan(0);
            expect(item.pasos).toHaveLength(4);
            for (const paso of item.pasos) {
                expect(typeof paso.texto).toBe('string');
                expect(paso.texto.length).toBeGreaterThan(0);
                expect(typeof paso.clave).toBe('string');
                expect(paso.clave.length).toBeGreaterThan(0);
            }
            expect(typeof item.pista).toBe('string');
            expect(item.pista.length).toBeGreaterThan(0);
        }
    });

    test('createSession devuelve una sesión serializable y plana', () => {
        const { session } = freshOrdena();
        expect(session.id).toBe('ordena_secuencia');
        expect(Array.isArray(session.state.order)).toBe(true);
        expect(session.state.order).toEqual([0, 1, 2, 3, 4]);
        expect(session.state.cursor).toBe(0);
        expect(session.state.maxRounds).toBe(3);
        expect(session.state.phase).toBe('announce');
        const roundTrip = JSON.parse(JSON.stringify(session));
        expect(roundTrip.state.order).toEqual(session.state.order);
        expect(roundTrip.state.maxRounds).toBe(3);
    });
});

describe('ordena_secuencia — respuesta correcta', () => {
    test('recita las 4 claves en orden → +1 y siguiente secuencia (dientes)', () => {
        const { engine, session } = freshOrdena();
        const result = engine.turn(session, 'agua jabon enjuagar secar');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
        expect(result.animation).toBe('Jump_in_place');
        expect(result.emotion).toBe('happy');
        expect(result.prompt).toBe(
            '¡Perfecto! Siguiente: ordena los pasos para lavarse los dientes: A) poner pasta al cepillo, B) cepillarse, C) escupir, D) enjuagar la boca'
        );
    });

    test('completa la partida en 3 secuencias', () => {
        const { engine, session } = freshOrdena();
        engine.turn(session, 'agua jabon enjuagar secar');   // → dientes
        engine.turn(session, 'pasta cepillo escupir enjuagar'); // → sándwich
        const result = engine.turn(session, 'pan jamon queso tapar');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(3);
        expect(result.animation).toBe('Dance');
        expect(result.prompt).toBe(
            '¡Perfecto! Completaste 3 secuencias con 3 puntos. ¡Eres muy listo!'
        );
    });
});

describe('ordena_secuencia — respuesta incorrecta y no reconocido', () => {
    test('orden incompleto → reintenta la misma secuencia', () => {
        const { engine, session } = freshOrdena();
        const result = engine.turn(session, 'agua secar');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBe('orden incorrecto');
        expect(session.round).toBe(1);
        expect(result.prompt).toBe(
            'Casi. El orden correcto es: abrir el agua, ponerse jabón, enjuagarse, secarse con la toalla. Inténtalo de nuevo.'
        );
        expect(result.emotion).toBe('encouraging');
    });

    test('sin claves reconocidas → error amigable y se queda en la misma secuencia', () => {
        const { engine, session } = freshOrdena();
        const result = engine.turn(session, 'hola flu');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBe('sin pasos reconocidos');
        expect(session.round).toBe(1);
        expect(result.prompt).toBe(
            'No te escuché bien. Dime los pasos para lavarse las manos en orden.'
        );
        expect(result.emotion).toBe('neutral');
    });
});

describe('ordena_secuencia — controles del jugador (pista / saltar)', () => {
    test('"pista" muestra el orden correcto de la secuencia actual', () => {
        const { engine, session } = freshOrdena();
        const result = engine.turn(session, 'dame una pista');
        expect(result.valid).toBe(false);
        expect(result.prompt).toBe(
            'El orden correcto es: abrir el agua, ponerse jabón, enjuagarse, secarse con la toalla. Primero el agua, luego el jabón, después enjuagar y al final secar.'
        );
        expect(result.emotion).toBe('thinking');
        expect(session.round).toBe(1);
    });

    test('"no se" entrega pista (no salta: hint tiene prioridad)', () => {
        const { engine, session } = freshOrdena();
        const result = engine.turn(session, 'no se');
        expect(result.prompt).toBe(
            'El orden correcto es: abrir el agua, ponerse jabón, enjuagarse, secarse con la toalla. Primero el agua, luego el jabón, después enjuagar y al final secar.'
        );
        expect(session.round).toBe(1);
    });

    test('"paso" salta a la siguiente secuencia sin puntuar', () => {
        const { engine, session } = freshOrdena();
        const result = engine.turn(session, 'paso');
        expect(result.valid).toBe(false);
        expect(result.score).toBe(0);
        expect(session.round).toBe(2);
        expect(result.prompt).toBe(
            '¡Claro! Aquí va otra: ordena los pasos para lavarse los dientes: A) poner pasta al cepillo, B) cepillarse, C) escupir, D) enjuagar la boca'
        );
        expect(result.emotion).toBe('neutral');
    });

    test('saltar la última secuencia termina la partida', () => {
        const { engine, session } = freshOrdena(1);
        const result = engine.turn(session, 'paso');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Terminamos con 0 puntos. ¡Muy bien jugado!');
    });
});

describe('ordena_secuencia — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshOrdena(1);
        engine.turn(session, 'paso');
        const result = engine.turn(session, 'hola');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Ya terminamos las secuencias. ¿Jugamos otra vez?');
    });

    test('isGameCommand reconoce controles y frases de salida', () => {
        const engine = createOrdenaSecuenciaEngine({ random: () => 0.9999 });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('dame una pista')).toBe(true);
        expect(engine.isGameCommand('paso')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('ordena_secuencia — configuración (data-driven, sin hardcode)', () => {
    test('aplica rounds y clamps al rango [1,5]', () => {
        const { session } = freshOrdena(2);
        expect(session.state.maxRounds).toBe(2);

        const low = createOrdenaSecuenciaEngine({ random: () => 0.9999 });
        const lowSession = low.createSession({ rounds: -5 });
        expect(lowSession.state.maxRounds).toBe(1);

        const high = createOrdenaSecuenciaEngine({ random: () => 0.9999 });
        const highSession = high.createSession({ rounds: 99 });
        expect(highSession.state.maxRounds).toBe(5);

        const alias = createOrdenaSecuenciaEngine({ random: () => 0.9999 });
        const aliasSession = alias.createSession({ defaultRounds: 4 });
        expect(aliasSession.state.maxRounds).toBe(4);
    });
});
