// ============================================================
// respiracion — Motor puro de Respiración guiada (plan-juegos §Fase 3).
//   - createRespiracionEngine() → GameEngine (contador puro, sin RNG).
//   - FLU guía ciclos: inhala (paso par) y exhala (paso impar). El niño
//     avanza con "listo"/"sigue"/"adelante" o contando 1-4. Es un juego
//     de calma: NO hay respuestas incorrectas, solo recordatorios.
// Objetivo: validar el comportamiento REAL del motor.
// Sin dummies: cada prompt es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createRespiracionEngine } from '../src/core/games/respiracion';

function freshRespiracion(rondas = 4) {
    const engine = createRespiracionEngine();
    const session = engine.createSession({ rondas });
    const startResult = engine.start(session, { rondas });
    return { engine, session, startResult };
}

describe('respiracion — inicio de partida', () => {
    test('start anuncia el primer paso (inhalar) y pide "listo"', () => {
        const { session, startResult } = freshRespiracion();
        expect(startResult.prompt).toBe(
            'Vamos a calmarnos respirando juntos. Inhala por la nariz contando hasta 4. Aguanta un segundo. Dime "listo" cuando termines.'
        );
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Idle');
        expect(startResult.emotion).toBe('excited');
        expect(session.round).toBe(1);
    });

    test('createSession devuelve una sesión serializable y plana', () => {
        const { session } = freshRespiracion();
        expect(session.id).toBe('respiracion');
        expect(session.state.step).toBe(0);
        expect(session.state.totalSteps).toBe(8);
        expect(session.state.phase).toBe('breathing');
        const roundTrip = JSON.parse(JSON.stringify(session));
        expect(roundTrip.state.step).toBe(0);
        expect(roundTrip.state.totalSteps).toBe(8);
        expect(roundTrip.state.phase).toBe('breathing');
    });
});

describe('respiracion — avance de pasos', () => {
    test('"listo" avanza al paso de exhalar', () => {
        const { engine, session } = freshRespiracion();
        const result = engine.turn(session, 'listo');
        expect(result.prompt).toBe(
            '¡Sigue respirando! Exhala por la boca contando hasta 4. Suelta todo el aire poco a poco. Dime "listo" cuando termines.'
        );
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(session.state.step).toBe(1);
        expect(result.animation).toBe('Idle');
        expect(result.emotion).toBe('happy');
    });

    test('contar 1-4 también avanza ("uno" → exhalar)', () => {
        const { engine, session } = freshRespiracion();
        const result = engine.turn(session, 'uno');
        expect(result.prompt).toBe(
            '¡Sigue respirando! Exhala por la boca contando hasta 4. Suelta todo el aire poco a poco. Dime "listo" cuando termines.'
        );
        expect(result.valid).toBe(true);
        expect(session.state.step).toBe(1);
    });

    test('completa la partida con rondas:2 en 4 pasos', () => {
        const { engine, session } = freshRespiracion(2);
        let result;
        result = engine.turn(session, 'listo');
        result = engine.turn(session, 'listo');
        result = engine.turn(session, 'listo');
        result = engine.turn(session, 'listo');
        expect(result.prompt).toBe(
            '¡Muy bien! Respíramos 2 veces. Ahora te sientes más tranquilo, ¿verdad?'
        );
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.animation).toBe('Dance');
        expect(result.emotion).toBe('happy');
    });
});

describe('respiracion — sin respuestas incorrectas (recordatorio)', () => {
    test('respuesta no reconocida → recordatorio amable, sin error', () => {
        const { engine, session } = freshRespiracion();
        const result = engine.turn(session, 'hola flu');
        expect(result.prompt).toBe(
            'Concéntrate en tu respiración. Inhala por la nariz contando hasta 4. Aguanta un segundo. Dime "listo" cuando termines.'
        );
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBeUndefined();
        expect(session.state.step).toBe(0);
        expect(result.emotion).toBe('encouraging');
    });
});

describe('respiracion — controles del jugador (pista / avanzar)', () => {
    test('"pista" repite la instrucción actual', () => {
        const { engine, session } = freshRespiracion();
        const result = engine.turn(session, 'pista');
        expect(result.prompt).toBe(
            'Claro, te repito: Inhala por la nariz contando hasta 4. Aguanta un segundo. Dime "listo" cuando termines.'
        );
        expect(result.valid).toBe(false);
        expect(result.emotion).toBe('thinking');
    });

    test('"no entendí" entrega pista (no avanza: hint tiene prioridad)', () => {
        const { engine, session } = freshRespiracion();
        const result = engine.turn(session, 'no entendí');
        expect(result.prompt).toBe(
            'Claro, te repito: Inhala por la nariz contando hasta 4. Aguanta un segundo. Dime "listo" cuando termines.'
        );
        expect(session.state.step).toBe(0);
    });

    test('"sigue" avanza al siguiente paso sin puntuar', () => {
        const { engine, session } = freshRespiracion();
        const result = engine.turn(session, 'sigue');
        expect(result.prompt).toBe(
            '¡Sigue respirando! Exhala por la boca contando hasta 4. Suelta todo el aire poco a poco. Dime "listo" cuando termines.'
        );
        expect(result.valid).toBe(true);
        expect(result.score).toBe(0);
        expect(session.state.step).toBe(1);
    });
});

describe('respiracion — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshRespiracion(1);
        engine.turn(session, 'listo');
        engine.turn(session, 'listo');
        const result = engine.turn(session, 'hola flu');
        expect(result.prompt).toBe('Ya respiramos tranquilos. ¿Quieres hacer otro ejercicio?');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(true);
        expect(result.emotion).toBe('happy');
    });

    test('isGameCommand reconoce controles y frases de salida', () => {
        const engine = createRespiracionEngine();
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('dame una pista')).toBe(true);
        expect(engine.isGameCommand('listo')).toBe(true);
        expect(engine.isGameCommand('sigue')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('respiracion — configuración (data-driven, sin hardcode)', () => {
    test('aplica rondas y clamps al rango [1,6]', () => {
        const engine = createRespiracionEngine();
        expect(engine.createSession({ rondas: 2 }).state.totalSteps).toBe(4);
        expect(engine.createSession({ rondas: -5 }).state.totalSteps).toBe(2);
        expect(engine.createSession({ rondas: 99 }).state.totalSteps).toBe(12);
        expect(engine.createSession({ rondas: 0 }).state.totalSteps).toBe(8);
        expect(engine.createSession({}).state.totalSteps).toBe(8);
    });

    test('el alias defaultRondas también configura los ciclos', () => {
        const engine = createRespiracionEngine();
        expect(engine.createSession({ defaultRondas: 2 }).state.totalSteps).toBe(4);
    });
});
