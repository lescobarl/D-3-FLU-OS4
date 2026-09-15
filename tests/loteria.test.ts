// ============================================================
// loteria — Motor puro de Lotería mexicana (plan-juegos §Fase 3).
// ------------------------------------------------------------
// Reglas REALES validadas aquí:
//   - La TABLA del jugador es un subconjunto ALEATORIO INDEPENDIENTE
//     del mazo de cantadas (no su slice). Antes el juego era trivial:
//     las 3 primeras cantadas siempre estaban en la tabla.
//   - Se marca con "la tengo" SOLO si la carta cantada está en la tabla.
//   - Marcar una carta que no está en la tabla = FALLO; `fallosMax`
//     fallos → derrota (won:false, sin grito de victoria).
//   - Tabla completa → "¡Lotería!" → victoria (won:true).
// RNG sembrado para determinismo (mulberry32), sin tocar el azar real.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createLoteriaEngine, LOTERIA_BANK } from '../src/core/games/loteria';
import type { GameSession } from '../src/core/games/types';

interface LoteriaStateShape {
    order: number[];
    tabla: number[];
    marcadas: boolean[];
    cursor: number;
    fallos: number;
    fallosMax: number;
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
    const startResult = engine.start(session, config);
    return { engine, session, startResult };
}

/** Juega respondiendo SIEMPRE correcto, siguiendo el estado real del motor. */
function playCorrectly(session: GameSession, engine: ReturnType<typeof createLoteriaEngine>) {
    let guard = 0;
    while (guard < 200) {
        guard += 1;
        const s = st(session);
        const idx = s.order[s.cursor];
        const inTabla = s.tabla.includes(idx);
        engine.turn(session, inTabla ? 'la tengo' : 'no la tengo');
        if (st(session).marcadas.every(Boolean)) {
            return engine.turn(session, '¡Lotería!');
        }
    }
    throw new Error('la partida no terminó');
}

describe('loteria — reglas de reparto', () => {
    test('la tabla es independiente del mazo (no su slice)', () => {
        const { session } = freshLoteria({ tablaSize: 3 }, 12345);
        const s = st(session);
        expect(s.tabla).toHaveLength(3);
        // Cartas distintas, todas del banco.
        expect(new Set(s.tabla).size).toBe(3);
        for (const idx of s.tabla) {
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThan(LOTERIA_BANK.length);
        }
        // La tabla NO puede ser el prefijo del mazo (regla real).
        expect(s.tabla).not.toEqual(s.order.slice(0, 3));
    });

    test('el mazo es una permutación completa del banco', () => {
        const { session } = freshLoteria({ tablaSize: 3 });
        const s = st(session);
        expect(s.order).toHaveLength(LOTERIA_BANK.length);
        expect(new Set(s.order).size).toBe(LOTERIA_BANK.length);
    });

    test('el banco tiene 16 cartas con estructura {id, nombre, copla}', () => {
        expect(LOTERIA_BANK).toHaveLength(16);
        for (const card of LOTERIA_BANK) {
            expect(card.id).toBeTruthy();
            expect(card.nombre).toBeTruthy();
            expect(card.copla).toBeTruthy();
        }
    });

    test('config: tablaSize con clamps y retrocompatibilidad', () => {
        expect(st(freshLoteria({ tablaSize: 2 }).session).tabla).toHaveLength(2);
        expect(st(freshLoteria({ tablaSize: -5 }).session).tabla).toHaveLength(1);
        expect(st(freshLoteria({ tablaSize: 99 }).session).tabla).toHaveLength(16);
        expect(st(freshLoteria({ cartasPorRonda: 2 }).session).tabla).toHaveLength(2);
        expect(st(freshLoteria({ rounds: 4 }).session).tabla).toHaveLength(4);
    });
});

describe('loteria — marcado correcto', () => {
    test('marcar una carta cantada que SÍ está en la tabla suma punto y avanza', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const s = st(session);
        // Avanza el mazo hasta la primera carta que esté en la tabla.
        let result = engine.turn(session, 'no la tengo');
        while (!s.tabla.includes(s.order[s.cursor])) {
            result = engine.turn(session, 'no la tengo');
        }
        const before = session.score;
        result = engine.turn(session, 'la tengo');
        expect(result.valid).toBe(true);
        expect(session.score).toBe(before + 1);
        expect(result.animation).toBe('Jump_in_place');
    });

    test('recorrer la tabla correctamente y gritar "¡Lotería!" gana (won:true)', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const result = playCorrectly(session, engine);
        expect(result.gameOver).toBe(true);
        expect(result.won).toBe(true);
        expect(result.score).toBe(3);
        expect(result.animation).toBe('Dance');
        expect(st(session).phase).toBe('done');
    });

    test('en una partida correcta SÍ se cantan cartas que no son de la tabla', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const s = st(session);
        let noTabla = 0;
        let guard = 0;
        while (guard < 200 && !s.marcadas.every(Boolean)) {
            guard += 1;
            const idx = s.order[s.cursor];
            if (!s.tabla.includes(idx)) noTabla += 1;
            engine.turn(session, s.tabla.includes(idx) ? 'la tengo' : 'no la tengo');
        }
        expect(noTabla).toBeGreaterThan(0);
    });
});

describe('loteria — fallos', () => {
    test('marcar una carta que NO está en la tabla es fallo: no suma y avanza', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const s = st(session);
        while (s.tabla.includes(s.order[s.cursor])) {
            engine.turn(session, 'la tengo');
        }
        const scoreBefore = session.score;
        const fallosBefore = s.fallos;
        const result = engine.turn(session, 'la tengo');
        expect(result.valid).toBe(false);
        expect(session.score).toBe(scoreBefore);
        expect(s.fallos).toBe(fallosBefore + 1);
        expect(result.gameOver).toBe(false);
    });

    test('alcanzar fallosMax termina la partida con won:false (sin celebración)', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3, fallosMax: 2 });
        const s = st(session);
        let result = engine.turn(session, 'no la tengo');
        let guard = 0;
        while (s.fallos < 2 && guard < 200) {
            guard += 1;
            const idx = s.order[s.cursor];
            // Las cartas de la tabla se saltan (no se marcan) para no completarla;
            // las que no son de la tabla se marcan a propósito → fallo.
            result = s.tabla.includes(idx)
                ? engine.turn(session, 'no la tengo')
                : engine.turn(session, 'la tengo');
        }
        expect(result.gameOver).toBe(true);
        expect(result.won).toBe(false);
    });
});

describe('loteria — grito de "¡Lotería!"', () => {
    test('gritar "lotería" antes de llenar la tabla no gana', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const result = engine.turn(session, 'lotería');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(session.score).toBe(0);
    });

    test('tras ganar, cualquier turno repite el cierre', () => {
        const { engine, session } = freshLoteria({ tablaSize: 1 });
        playCorrectly(session, engine);
        const result = engine.turn(session, 'hola');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Ya terminamos la lotería. ¿Jugamos otra vez?');
    });
});

describe('loteria — pluralización (sin "1 cartas")', () => {
    test('tabla de 1 carta usa singular en el arranque y en el cierre', () => {
        const { engine, session, startResult } = freshLoteria({ tablaSize: 1 });
        expect(startResult.prompt).toContain('1 carta:');
        const win = playCorrectly(session, engine);
        expect(win.prompt).toContain('1 carta');
        expect(win.prompt).toContain('1 punto');
    });
});

describe('loteria — controles y ruido ASR', () => {
    test('"paso" y "no la tengo" saltan sin puntuar', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const skip = engine.turn(session, 'paso');
        expect(skip.valid).toBe(false);
        expect(session.score).toBe(0);
        const skip2 = engine.turn(session, 'no la tengo');
        expect(skip2.valid).toBe(false);
        expect(session.score).toBe(0);
    });

    test('"pista" repite la carta sin avanzar', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const s = st(session);
        const cursorBefore = s.cursor;
        const result = engine.turn(session, 'dame una pista');
        expect(result.prompt).toContain('La carta es:');
        expect(st(session).cursor).toBe(cursorBefore);
    });

    test('repetición "la tengo la tengo" marca (ruido ASR)', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const s = st(session);
        while (!s.tabla.includes(s.order[s.cursor])) {
            engine.turn(session, 'no la tengo');
        }
        const result = engine.turn(session, 'la tengo la tengo la tengo');
        expect(result.valid).toBe(true);
        expect(session.score).toBe(1);
    });

    test('respuesta no reconocida reintenta la misma carta', () => {
        const { engine, session } = freshLoteria({ tablaSize: 3 });
        const s = st(session);
        const cursorBefore = s.cursor;
        const result = engine.turn(session, 'hola flu');
        expect(result.error).toBe('respuesta no reconocida');
        expect(st(session).cursor).toBe(cursorBefore);
    });

    test('isGameCommand reconoce controles, grito y salida', () => {
        const engine = createLoteriaEngine({ random: mulberry32(1) });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('la tengo')).toBe(true);
        expect(engine.isGameCommand('paso')).toBe(true);
        expect(engine.isGameCommand('lotería')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});
