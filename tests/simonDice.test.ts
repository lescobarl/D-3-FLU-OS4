// ============================================================
// simonDice — Motor puro de Simón dice (plan-juegos §4).
//   - createSimonDiceEngine({ random }) → GameEngine (RNG inyectable).
//   - start() anuncia la secuencia; turn() valida por subsecuencia
//     ordenada y tolerante a palabras de relleno.
// Objetivo: validar el comportamiento REAL del motor con un RNG
// determinista (`() => 0` → pickRandom elige items[0] = 'Dance',
// growSequence excluye el último y vuelve a elegir items[0]).
// Sin dummies: cada prompt es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createSimonDiceEngine } from '../src/core/games/simonDice';

// random:()=>0 → pickRandom(items) siempre devuelve items[0].
// Secuencia determinista: [Dance] → [Dance, Run] → [Dance, Run, Dance] ...
function freshSimon(rounds = 3) {
    const engine = createSimonDiceEngine({ random: () => 0 });
    const session = engine.createSession({ rounds, verbos: ['Dance', 'Run', 'Walk', 'Jump_in_place'], longMax: 5 });
    const startResult = engine.start(session, { rounds });
    return { engine, session, startResult };
}

describe('simonDice — inicio de partida', () => {
    test('start anuncia el primer movimiento (Dance → baila)', () => {
        const { session, startResult } = freshSimon();
        expect(startResult.prompt).toBe('¡Simón dice: baila! Repite los movimientos en el mismo orden.');
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Dance');
        expect(startResult.emotion).toBe('excited');
        expect(session.round).toBe(1);
        expect(session.score).toBe(0);
    });

    test('createSession devuelve una sesión serializable y plana', () => {
        const engine = createSimonDiceEngine({ random: () => 0 });
        const session = engine.createSession({});
        expect(session).toMatchObject({ id: 'simon_dice', score: 0, round: 1 });
        expect(session.state).toBeTypeOf('object');
        expect(JSON.parse(JSON.stringify(session))).toEqual(session);
    });
});

describe('simonDice — turnos correctos', () => {
    test('repite la secuencia completa → avanza de ronda y crece la secuencia', () => {
        const { engine, session } = freshSimon();
        const result = engine.turn(session, 'baila corre');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
        expect(result.prompt).toBe('¡Simón dice: baila y corre! Repite los movimientos en el mismo orden.');
        expect(result.animation).toBe('Dance');
    });

    test('acepta palabras de relleno entre movimientos (transcripción ruidosa)', () => {
        const { engine, session } = freshSimon();
        const result = engine.turn(session, 'baila y luego corre');
        expect(result.valid).toBe(true);
        expect(session.round).toBe(2);
    });

    test('completa la partida al llegar a rounds (3 rondas)', () => {
        const { engine, session } = freshSimon(3);
        engine.turn(session, 'baila corre'); // ronda 2 → [Dance, Run]
        engine.turn(session, 'baila corre'); // ronda 3 → [Dance, Run, Dance]
        const result = engine.turn(session, 'baila corre baila');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(3);
        expect(result.prompt).toBe('¡Perfecto! Completaste 3 rondas de Simón dice. ¡Eres increíble!');
    });

    test('con rounds=1 termina en un solo turno (gramática singular)', () => {
        const { engine, session } = freshSimon(1);
        const result = engine.turn(session, 'baila');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('¡Perfecto! Completaste 1 ronda de Simón dice. ¡Eres increíble!');
    });
});

describe('simonDice — turnos incorrectos', () => {
    test('prefix correcto pero incompleto → "sigue" con el resto', () => {
        const { engine, session } = freshSimon();
        engine.turn(session, 'baila corre'); // ronda 2 → [Dance, Run]
        const result = engine.turn(session, 'baila');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.prompt).toBe('¡Vas muy bien! Sigue: corre.');
        expect(result.animation).toBe('Run');
        expect(result.emotion).toBe('excited');
    });

    test('movimientos en desorden → reintenta con la misma secuencia', () => {
        const { engine, session } = freshSimon();
        engine.turn(session, 'baila corre');
        const result = engine.turn(session, 'corre baila');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.prompt).toBe('¡Casi! Inténtalo de nuevo en orden: baila y corre.');
        expect(result.error).toBe('secuencia en desorden o con movimientos de más');
        expect(session.round).toBe(2); // no avanza
    });

    test('sin movimiento reconocido → error amigable', () => {
        const { engine, session } = freshSimon();
        const result = engine.turn(session, 'hola que tal');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.prompt).toBe('No logré reconocer un movimiento. Repite: baila.');
        expect(result.error).toBe('no se reconoció ningún verbo de movimiento');
    });
});

describe('simonDice — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshSimon(1);
        engine.turn(session, 'baila');
        const result = engine.turn(session, 'baila corre');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Ya terminamos de jugar Simón dice. ¿Quieres empezar otra partida?');
    });
});

describe('simonDice — configuración (data-driven, sin hardcode)', () => {
    test('filtra verbos inválidos y aplica clamps (rounds/longMax)', () => {
        const engine = createSimonDiceEngine({ random: () => 0 });
        const session = engine.createSession({
            rounds: 99,
            longMax: 99,
            verbos: ['Dance', 'Jump_in_place', 'bogus'],
        });
        const state = session.state as { verbos: string[]; maxRounds: number; longMax: number };
        expect(state.verbos).toEqual(['Dance', 'Jump_in_place']);
        expect(state.maxRounds).toBe(12); // MAX_ROUNDS
        expect(state.longMax).toBe(10);   // MAX_LONG
    });

    test('isGameCommand reconoce solo frases de control', () => {
        const engine = createSimonDiceEngine({ random: () => 0 });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('sigo jugando')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});
