// ============================================================
// UNA ORDEN DE JUEGO = UNA CARTA (dueno UNICO del despacho del motor)
// ------------------------------------------------------------
// Defecto MEDIDO en el log real del dueno (.agent_tmp/vite-dev.log), por frase:
//
//   19:37:58.518  onContractResolved -> game (accion "turn")   <- resolucion fast-path
//   19:38:02.583  onContractResolved -> game (accion "turn")   <- resolucion IA
//
// Un turno tiene DOS resoluciones y ambas llegan a App clasificadas como juego.
// El fast-path determinista YA despacho el motor; si la resolucion IA vuelve a
// despachar, el motor avanza DOS cartas con UNA sola orden del usuario. Es el
// "lee de a 2 cartas" que reporto el dueno.
//
// El guard `!resolved?.fastPathGame` NO descarta el turno: es el dueno unico del
// despacho (la clasificacion del arbitro NO es la ejecucion). Quitarlo produjo
// exactamente ese doble despacho.
// ============================================================
import { describe, test, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createLoteriaEngine } from '../src/core/games/loteria';
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter';
import { normalizeJuego } from '../src/voice/lib/configCommands';
import {
    setActiveGameSession,
    clearActiveGameSession,
} from '../src/core/games/gameSessionStore';
import type { GameSession } from '../src/core/games/types';

const session = (id: string): GameSession =>
    ({ id, state: {}, score: 0, round: 1 }) as unknown as GameSession;

interface Clasificacion {
    domain?: string | null;
    action?: unknown;
}

/** La REGLA de App.tsx L1638-1644: fuente UNICA del despacho del motor. */
const despachoDeApp = ({
    juegoDelContrato,
    clasificacionDelArbitro,
    fastPathGame,
}: {
    juegoDelContrato: unknown;
    clasificacionDelArbitro: Clasificacion | null;
    fastPathGame: boolean;
}) =>
    normalizeJuego(juegoDelContrato) ||
    (clasificacionDelArbitro?.domain === 'game' && !fastPathGame
        ? normalizeJuego(clasificacionDelArbitro.action)
        : null);

describe('una orden de juego = una carta', () => {
    afterEach(() => clearActiveGameSession());

    test('la resolucion IA (fastPathGame) NO re-despacha lo que ya despacho el fast-path', () => {
        setActiveGameSession(session('loteria'));
        const clasificacion = resolveDeterministicCommand('siguiente carta', {});
        expect(clasificacion.domain).toBe('game');

        // Resolucion IA del MISMO turno: buildResolvedContract ya anulo `juego`
        // (el motor habla por su cuenta) y viene marcada como fast-path.
        const despacho = despachoDeApp({
            juegoDelContrato: null,
            clasificacionDelArbitro: clasificacion,
            fastPathGame: true,
        });

        // Sin segundo despacho: el fast-path ya movio la partida.
        expect(despacho).toBeNull();
    });

    test('una orden que NO viene de fast-path SI despacha (el unico despacho)', () => {
        setActiveGameSession(session('loteria'));
        const clasificacion = resolveDeterministicCommand('siguiente carta', {});

        const despacho = despachoDeApp({
            juegoDelContrato: null,
            clasificacionDelArbitro: clasificacion,
            fastPathGame: false,
        });

        expect(despacho).toBeTruthy();
        expect((despacho as { action?: string }).action).toBeTruthy();
    });

    test('cada despacho avanza UNA carta: dos despachos = dos cartas (el defecto)', () => {
        const engine = createLoteriaEngine();
        const s = engine.createSession();
        engine.start(s);

        const carta1 = engine.turn(s, 'siguiente carta', {}).prompt;
        const carta2 = engine.turn(s, 'siguiente carta', {}).prompt;

        // El motor avanza en CADA llamada: por eso un doble despacho se ve como
        // dos cartas de golpe con una sola orden del usuario.
        expect(carta1).toBeTruthy();
        expect(carta2).toBeTruthy();
        expect(carta2).not.toBe(carta1);
    });

    test('GUARD: App.tsx conserva el dueno unico del despacho (no reabrir el doble)', () => {
        const app = fs.readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf8');
        expect(app).toMatch(/domain === 'game'\s*&&\s*!resolved\?\.fastPathGame/);
    });
});
