// ============================================================
// tests/gameEngine.test.ts
// Valida la interfaz GameEngine (plan-juegos §2) para ambos motores
// y su determinismo con RNG sembrado (fast-path local = fuente de
// verdad; nunca depende de Gemini).
// ============================================================
import { describe, test, expect } from 'vitest';
import { createSimonDiceEngine } from '../src/core/games/simonDice';
import { createRiddlesEngine } from '../src/core/games/riddles';

describe('gameEngine — conformancia de interfaz (simonDice)', () => {
    test('expone la interfaz completa', () => {
        const engine = createSimonDiceEngine();
        expect(engine.id).toBe('simon_dice');
        expect(typeof engine.createSession).toBe('function');
        expect(typeof engine.start).toBe('function');
        expect(typeof engine.turn).toBe('function');
        expect(typeof engine.isGameCommand).toBe('function');
    });

    test('createSession + start devuelven resultado coherente', () => {
        const engine = createSimonDiceEngine();
        const session = engine.createSession({ rounds: 1 });
        expect(session.id).toBe('simon_dice');
        expect(session.round).toBe(1);
        expect(session.score).toBe(0);

        const result = engine.start(session);
        expect(typeof result.prompt).toBe('string');
        expect(result.prompt.length).toBeGreaterThan(0);
        expect(typeof result.valid).toBe('boolean');
        expect(result.gameOver).toBe(false);
    });

    test('isGameCommand detecta salir del juego', () => {
        const engine = createSimonDiceEngine();
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('gameEngine — conformancia de interfaz (adivinanzas)', () => {
    test('expone la interfaz completa', () => {
        const engine = createRiddlesEngine();
        expect(engine.id).toBe('adivinanzas');
        expect(typeof engine.createSession).toBe('function');
        expect(typeof engine.start).toBe('function');
        expect(typeof engine.turn).toBe('function');
        expect(typeof engine.isGameCommand).toBe('function');
    });

    test('createSession + start devuelven resultado coherente', () => {
        const engine = createRiddlesEngine();
        const session = engine.createSession({ rounds: 1 });
        expect(session.id).toBe('adivinanzas');
        expect(session.round).toBe(1);
        expect(session.score).toBe(0);

        const result = engine.start(session);
        expect(typeof result.prompt).toBe('string');
        expect(result.prompt.length).toBeGreaterThan(0);
        expect(typeof result.valid).toBe('boolean');
        expect(result.gameOver).toBe(false);
    });

    test('isGameCommand detecta salir del juego', () => {
        const engine = createRiddlesEngine();
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('gameEngine — determinismo con RNG sembrado', () => {
    test('simonDice: mismo RNG → partida idéntica', () => {
        const build = () => {
            const engine = createSimonDiceEngine({ random: () => 0 });
            const session = engine.createSession({ rounds: 2, verbos: ['Dance', 'Run', 'Walk', 'Jump_in_place'] });
            const start = engine.start(session);
            const second = engine.turn(session, 'baila');
            return { start: start.prompt, second: second.prompt, score: session.score, round: session.round };
        };
        expect(build()).toEqual(build());
    });

    test('simonDice: RNG distinto → prompt inicial distinto', () => {
        const low = createSimonDiceEngine({ random: () => 0 });
        const high = createSimonDiceEngine({ random: () => 0.9999 });
        const a = low.start(low.createSession());
        const b = high.start(high.createSession());
        expect(a.prompt).not.toBe(b.prompt);
    });

    test('adivinanzas: mismo RNG → mismo prompt inicial', () => {
        const build = () => {
            const engine = createRiddlesEngine({ random: () => 0.9999 });
            const session = engine.createSession({ rounds: 2 });
            return engine.start(session).prompt;
        };
        expect(build()).toBe(build());
    });
});
