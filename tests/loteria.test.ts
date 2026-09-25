// ============================================================
// loteria — Lotería mexicana por VOZ: FLU es solo el CANTADOR
// ------------------------------------------------------------
// Los cartones los tienen los jugadores. FLU:
//   - canta el mazo carta por carta;
//   - "repite" → repite la carta actual;
//   - "siguiente"/"otra" → canta la siguiente;
//   - "lotería" → alguien ganó, FLU lo declara y cierra.
// Sin tablas internas, sin "la tengo", sin puntaje, sin marcaje.
// RNG sembrado (mulberry32) para determinismo.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createLoteriaEngine, LOTERIA_BANK } from '../src/core/games/loteria';
import type { GameSession } from '../src/core/games/types';

interface LoteriaStateShape {
    order: number[];
    cursor: number;
    winner: string | null;
    phase: string;
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const st = (session: GameSession): LoteriaStateShape =>
    session.state as unknown as LoteriaStateShape;

function freshLoteria(seed = 12345) {
    const engine = createLoteriaEngine({ random: mulberry32(seed) });
    const session = engine.createSession({});
    engine.start(session, {});
    return { engine, session };
}

describe('loteria — banco y mazo', () => {
    test('el banco tiene 16 cartas con estructura {id, nombre, copla}', () => {
        expect(LOTERIA_BANK).toHaveLength(16);
        for (const card of LOTERIA_BANK) {
            expect(card.id).toBeTruthy();
            expect(card.nombre).toBeTruthy();
            expect(card.copla).toBeTruthy();
        }
    });

    test('el mazo es una permutación completa y NO hay tablas internas', () => {
        const { session } = freshLoteria();
        const state = st(session);
        expect(state.order).toHaveLength(16);
        expect(new Set(state.order).size).toBe(16);
        expect((state as unknown as Record<string, unknown>).tablas).toBeUndefined();
        expect(state.winner).toBeNull();
    });

    test('start anuncia la primera copla y no dicta nada al jugador', () => {
        const { engine, session } = freshLoteria();
        const result = engine.start(session, {});
        const card = LOTERIA_BANK[st(session).order[0]];
        expect(result.prompt).toBe(
            `¡Vamos a jugar a la lotería! Yo canto las cartas y cada quien marca su cartón. Primera carta: ${card.copla}`
        );
    });
});

describe('loteria — cantador', () => {
    test('"repite" repite la carta actual sin avanzar', () => {
        const { engine, session } = freshLoteria();
        const cursorBefore = st(session).cursor;
        const card = LOTERIA_BANK[st(session).order[cursorBefore]];
        const result = engine.turn(session, 'repite');
        expect(result.prompt).toBe(`La carta es: ${card.nombre}. ${card.copla}`);
        expect(st(session).cursor).toBe(cursorBefore);
    });

    test('"ok flu repite" (con wake) también repite', () => {
        const { engine, session } = freshLoteria();
        // El wake se recorta ANTES del motor; aquí se simula el texto post-wake.
        const card = LOTERIA_BANK[st(session).order[0]];
        const result = engine.turn(session, 'repite');
        expect(result.prompt).toContain(card.copla);
    });

    test('"siguiente" avanza a la siguiente carta', () => {
        const { engine, session } = freshLoteria();
        const before = st(session).cursor;
        const result = engine.turn(session, 'siguiente');
        expect(st(session).cursor).toBe(before + 1);
        expect(result.prompt).toContain('Siguiente carta:');
    });

    test('"lotería" gana SIN verificar ninguna tabla', () => {
        const { engine, session } = freshLoteria();
        const result = engine.turn(session, '¡Lotería!', { playerId: 'p1' });
        expect(result.gameOver).toBe(true);
        expect(result.won).toBe(true);
        expect(st(session).winner).toBe('p1');
        expect(result.animation).toBe('Dance');
    });

    test('"ok flu lotería" gana aunque el motor no conozca los cartones', () => {
        const { engine, session } = freshLoteria();
        const result = engine.turn(session, 'lotería');
        expect(result.gameOver).toBe(true);
        expect(result.won).toBe(true);
        expect(st(session).winner).toBeNull();
        expect(result.prompt).toBe('¡LOTERÍA! ¡Ganaste! ¡A celebrar!');
    });

    test('tras ganar, cualquier turno repite el cierre', () => {
        const { engine, session } = freshLoteria();
        engine.turn(session, 'lotería', { playerId: 'p1' });
        const result = engine.turn(session, 'hola');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toContain('p1 ganó la lotería');
    });

    test('agotar el mazo termina sin ganador', () => {
        const { engine, session } = freshLoteria();
        let guard = 0;
        let result = engine.turn(session, 'siguiente');
        while (guard < 200 && !result.gameOver) {
            guard += 1;
            result = engine.turn(session, 'siguiente');
        }
        expect(result.gameOver).toBe(true);
        expect(result.won).toBe(false);
    });
});

describe('loteria — isGameCommand', () => {
    test('reconoce repetir, siguiente, lotería y salir', () => {
        const engine = createLoteriaEngine({ random: mulberry32(1) });
        expect(engine.isGameCommand('repite')).toBe(true);
        expect(engine.isGameCommand('siguiente')).toBe(true);
        expect(engine.isGameCommand('lotería')).toBe(true);
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});
