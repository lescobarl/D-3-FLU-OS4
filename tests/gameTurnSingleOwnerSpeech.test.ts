// ============================================================
// UN TURNO DE JUEGO TIENE UN SOLO DUENO DE LA VOZ (TODOS los juegos)
// ------------------------------------------------------------
// DEFECTO MEDIDO (log real del dueno, .agent_tmp/dev-server.log,
// 2026-09-28 22:19:18-22:19:56, loteria activa):
//
//   [22:19:35] TRACE determinista question="siguiente carta" -> matched=true domain="game" action="turn"
//   [22:19:39] calling commitAndResolveTurn with respuesta_voz="Siguiente carta: El sol sale para todos."
//   [22:19:52] TRACE determinista question="siguiente carta" -> matched=true domain="game" action="turn"
//   [22:19:56] calling commitAndResolveTurn with respuesta_voz="Siguiente carta: El sol sale para todos."
//
// El mismo texto DOS veces: la carta visible NO cambio. Sintoma del dueno:
// "cada 2 turnos de nueva carta no hace nada".
//
// CAUSA: el turno tenia DOS duenos de la voz. El motor local cantaba la carta
// nueva (correcta) y, EN PARALELO, el LLM contestaba el mismo turno con su
// propia "respuesta_voz" (una carta INVENTADA o repetida, porque no ve el mazo).
// `buildResolvedContract` anulaba el `juego` del LLM (no habia doble efecto en el
// motor) pero CONSERVABA su `respuesta_voz`: la carta que el usuario veia oia
// era la del LLM, no la del motor. Cuando el LLM repetia la carta anterior, el
// usuario veia "no hace nada".
//
// REGLA VIGILADA: si el fast-path determinista de JUEGO reclama el turno, la
// voz del turno es del MOTOR LOCAL y el LLM no habla. Un turno, un dueno.
// ============================================================
import { describe, test, expect, afterEach } from 'vitest';
import { buildResolvedContract } from '../src/voice/lib/resolvedContract';
import { GAME_IDS } from '../src/core/games/gameCatalog';
import { resolveStatefulDomains } from '../src/voice/lib/deterministicArbiter';
import {
    setActiveGameSession,
    clearActiveGameSession,
} from '../src/core/games/gameSessionStore';
import type { GameSession } from '../src/core/games/types';

const session = (id: string): GameSession =>
    ({ id, state: {}, score: 0, round: 1 }) as unknown as GameSession;

/** Contrato del LLM tal como llega del proveedor: con SU propia respuesta_voz. */
function llmContract(respuestaVoz: string) {
    return {
        contract: {
            respuesta_voz: respuestaVoz,
            navegacion: { comando: null, destino: null, parametros: {} },
            workspace: null,
            musica: null,
            configuracion: null,
            juego: { gameId: 'loteria', action: 'turn' },
            ambiente: null,
            metadata: { provider: 'llm' },
        },
    };
}

/** El motor local ya habla: su fast-path despacha con respuesta_voz vacia. */
const fastPathOfGame = (gameId: string) => ({ gameId, action: 'turn' });

describe('1. fast-path de juego: el LLM NO habla el turno (TODOS los juegos)', () => {
    afterEach(() => clearActiveGameSession());

    test.each([...GAME_IDS])(
        'juego "%s": la respuesta_voz del LLM se anula (habla el motor)',
        (gameId) => {
            const resuelto = buildResolvedContract({
                contract: llmContract('Siguiente carta: El sol sale para todos.'),
                lateStateful: { config: null, game: null, env: null },
                fastPathConfig: null,
                fastGame: fastPathOfGame(gameId),
                fastEnv: null,
            });
            expect(resuelto.respuesta_voz).toBe('');
            expect(resuelto.juego).toBeNull();
        },
    );

    test('el texto INVENTADO por el LLM no sobrevive al contrato resuelto', () => {
        const inventado = 'Claro, aqui va la siguiente carta: El gorrito, sombrero de marinero.';
        const resuelto = buildResolvedContract({
            contract: llmContract(inventado),
            lateStateful: { config: null, game: null, env: null },
            fastPathConfig: null,
            fastGame: fastPathOfGame('loteria'),
            fastEnv: null,
        });
        expect(JSON.stringify(resuelto)).not.toContain('gorrito');
    });
});

describe('2. la ruta real (arbitro + contrato) con la loteria activa', () => {
    afterEach(() => clearActiveGameSession());

    test('"siguiente carta" no entrega la voz del turno al LLM', () => {
        setActiveGameSession(session('loteria'));
        // Arbol real: 'siguiente carta' lo resuelve el motor (turn)...
        const stateful = resolveStatefulDomains('siguiente carta', { language: 'es' });
        expect(stateful.game).toMatchObject({ gameId: 'loteria', action: 'turn' });
        // ...y el contrato resuelto NO puede conservar la voz del LLM.
        const resuelto = buildResolvedContract({
            contract: llmContract('Siguiente carta: El sol sale para todos.'),
            lateStateful: stateful,
            fastPathConfig: stateful.config,
            fastGame: stateful.game,
            fastEnv: stateful.env,
        });
        expect(resuelto.respuesta_voz).toBe('');
    });
});

describe('3. el turno AJENO sigue siendo del otro dominio (no se rompe P7.48)', () => {
    afterEach(() => clearActiveGameSession());

    test('"genera una imagen" con partida activa: el juego NO responde', () => {
        setActiveGameSession(session('loteria'));
        const stateful = resolveStatefulDomains('genera una imagen', { language: 'es' });
        expect(stateful.game).toBeNull();
    });

    test('sin fast-path de juego, la voz del LLM se conserva (no se muda el turno)', () => {
        const resuelto = buildResolvedContract({
            contract: llmContract('Claro, aqui tienes la imagen.'),
            lateStateful: { config: null, game: null, env: null },
            fastPathConfig: null,
            fastGame: null,
            fastEnv: null,
        });
        expect(resuelto.respuesta_voz).toBe('Claro, aqui tienes la imagen.');
    });
});
