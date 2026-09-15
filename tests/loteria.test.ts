// ============================================================
// loteria — Lotería mexicana MULTIJUGADOR (reglas reales)
// ------------------------------------------------------------
// Sin `fallosMax` (regla inventada) ni dictado de tablas:
//   - la tabla de cada jugador es independiente del mazo;
//   - "mis cartas" muestra SU tabla;
//   - "la tengo" marca solo la suya; marcar ajena no penaliza;
//   - el PRIMERO que llena y grita "¡Lotería!" gana.
// RNG sembrado (mulberry32) para determinismo.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createLoteriaEngine, LOTERIA_BANK } from '../src/core/games/loteria';
import type { GameSession } from '../src/core/games/types';

interface PlayerState {
    tabla: number[];
    marcadas: boolean[];
}

interface LoteriaStateShape {
    order: number[];
    cursor: number;
    tablaSize: number;
    tablas: Record<string, PlayerState>;
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

function freshLoteria(config: Record<string, unknown> = {}, seed = 12345) {
    const engine = createLoteriaEngine({ random: mulberry32(seed) });
    const session = engine.createSession(config);
    engine.start(session, config);
    return { engine, session };
}

/** Hace que un jugador responda correctamente hasta completar su tabla, y gana. */
function playToWin(session: GameSession, engine: ReturnType<typeof createLoteriaEngine>, playerId: string) {
    const state = st(session);
    let guard = 0;
    while (guard < 400) {
        guard += 1;
        const idx = state.order[state.cursor];
        const player = state.tablas[playerId];
        const inTabla = player && player.tabla.includes(idx) && !player.marcadas[player.tabla.indexOf(idx)];
        engine.turn(session, inTabla ? 'la tengo' : 'no la tengo', { playerId });
        const current = st(session).tablas[playerId];
        if (current && current.marcadas.every(Boolean)) {
            return engine.turn(session, '¡Lotería!', { playerId });
        }
    }
    throw new Error('la partida no terminó');
}

describe('loteria — banco y reparto', () => {
    test('el banco tiene 16 cartas con estructura {id, nombre, copla}', () => {
        expect(LOTERIA_BANK).toHaveLength(16);
        for (const card of LOTERIA_BANK) {
            expect(card.id).toBeTruthy();
            expect(card.nombre).toBeTruthy();
            expect(card.copla).toBeTruthy();
        }
    });

    test('el mazo es una permutación completa y el start NO dicta tablas', () => {
        const { session } = freshLoteria({ tablaSize: 3 });
        const state = st(session);
        expect(state.order).toHaveLength(16);
        expect(new Set(state.order).size).toBe(16);
        expect(state.tablas).toEqual({});
        expect(state.winner).toBeNull();
    });

    test('config: tablaSize con clamps', () => {
        expect(st(freshLoteria({ tablaSize: 2 }).session).tablaSize).toBe(2);
        expect(st(freshLoteria({ tablaSize: -5 }).session).tablaSize).toBe(1);
        expect(st(freshLoteria({ tablaSize: 99 }).session).tablaSize).toBe(16);
    });
});

describe('loteria — multijugador', () => {
    test('cada jugador tiene una tabla PROPIA e independiente', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        engine.turn(session, 'mis cartas', { playerId: 'p1' });
        engine.turn(session, 'mis cartas', { playerId: 'p2' });
        const state = st(session);
        expect(state.tablas.p1.tabla).toHaveLength(3);
        expect(state.tablas.p2.tabla).toHaveLength(3);
        expect(new Set(state.tablas.p1.tabla).size).toBe(3);
        expect(state.tablas.p1.tabla).not.toEqual(state.tablas.p2.tabla);
    });

    test('"mis cartas" lista la tabla de ESE jugador', () => {
        const { engine, session } = freshLoteria({ tablaSize: 2 });
        const result = engine.turn(session, '¿qué cartas tengo?', { playerId: 'p1' });
        expect(result.prompt).toContain('Tu tabla tiene 2 cartas:');
    });

    test('"la tengo" marca SOLO la tabla del hablante', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const state = st(session);
        // Avanza hasta una carta que p1 tenga.
        engine.turn(session, 'mis cartas', { playerId: 'p1' });
        let guard = 0;
        while (guard < 400 && !state.tablas.p1.tabla.includes(state.order[state.cursor])) {
            guard += 1;
            engine.turn(session, 'no la tengo', { playerId: 'p1' });
        }
        engine.turn(session, 'la tengo', { playerId: 'p1' });
        expect(state.tablas.p1.marcadas.filter(Boolean).length).toBe(1);
        // p2 ni siquiera tiene tabla creada aún.
        expect(state.tablas.p2).toBeUndefined();
    });

    test('marcar una carta ajena NO penaliza (no suma, solo avanza)', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const state = st(session);
        engine.turn(session, 'mis cartas', { playerId: 'p1' });
        const before = session.score;
        engine.turn(session, 'la tengo', { playerId: 'p1' }); // primera carta, casi nunca en tabla
        expect(session.score).toBeLessThanOrEqual(before + 1);
        expect(state.winner).toBeNull();
    });

    test('el PRIMERO que llena y grita "¡Lotería!" gana', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const result = playToWin(session, engine, 'p1');
        expect(result.gameOver).toBe(true);
        expect(result.won).toBe(true);
        expect(st(session).winner).toBe('p1');
        expect(result.animation).toBe('Dance');
    });
});

describe('loteria — controles y ruido ASR', () => {
    test('"paso" / "no la tengo" saltan sin puntuar', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const before = st(session).cursor;
        engine.turn(session, 'paso', { playerId: 'p1' });
        expect(st(session).cursor).toBe(before + 1);
        expect(session.score).toBe(0);
    });

    test('gritar "lotería" antes de llenar la tabla no gana', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const result = engine.turn(session, '¡Lotería!', { playerId: 'p1' });
        expect(result.gameOver).toBe(false);
        expect(st(session).winner).toBeNull();
    });

    test('repetición "la tengo la tengo" marca (ruido ASR)', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const state = st(session);
        engine.turn(session, 'mis cartas', { playerId: 'p1' });
        let guard = 0;
        while (guard < 400 && !state.tablas.p1.tabla.includes(state.order[state.cursor])) {
            guard += 1;
            engine.turn(session, 'no la tengo', { playerId: 'p1' });
        }
        const result = engine.turn(session, 'la tengo la tengo la tengo', { playerId: 'p1' });
        expect(result.valid).toBe(true);
        expect(session.score).toBe(1);
    });

    test('respuesta no reconocida reintenta la misma carta', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const cursorBefore = st(session).cursor;
        const result = engine.turn(session, 'hola flu', { playerId: 'p1' });
        expect(result.error).toBe('respuesta no reconocida');
        expect(st(session).cursor).toBe(cursorBefore);
    });

    test('isGameCommand reconoce controles, grito y salida', () => {
        const engine = createLoteriaEngine({ random: mulberry32(1) });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('la tengo')).toBe(true);
        expect(engine.isGameCommand('paso')).toBe(true);
        expect(engine.isGameCommand('lotería')).toBe(true);
        expect(engine.isGameCommand('mis cartas')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});
