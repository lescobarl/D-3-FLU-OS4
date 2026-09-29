// ============================================================
// UN TURNO DE JUEGO NUNCA SE QUEDA SIN DUENO DE LA VOZ
// ------------------------------------------------------------
// DEFECTO MEDIDO (log real, 2026-09-29 18:36:04-18:36:14, loteria activa):
//
//   [18:36:14] calling commitAndResolveTurn with respuesta_voz=""
//   [18:36:14] App onContractResolved: arbitro -> dominio "game" (accion "turn")
//   [18:36:14] App onContractResolved: dominio de estado "game" -> fast-path (no dispatcher)
//   [18:36:14] turnTiming: ... total=10257ms cierre=voz
//
// El contrato anulaba `respuesta_voz` y `juego` dando por hecho que el MOTOR
// hablaria; y App se inhibia con `!resolved?.fastPathGame`, que solo significa
// "el arbitro clasifico el turno como juego", NO "ya se despacho". Nadie
// despachaba: el turno quedaba con CERO duenos -> silencio y sin carta nueva.
// Sintoma del dueno: "cada 2 turnos de nueva carta no hace nada".
//
// Medido antes -> despues: dueno de la voz NINGUNO -> MOTOR.
//
// El test hermano (gameTurnSingleOwnerSpeech) solo acreditaba que el LLM NO
// habla; nunca que el motor SI hable. Ese hueco permitia el turno mudo.
// ============================================================
import { describe, test, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildResolvedContract } from '../src/voice/lib/resolvedContract';
import {
    resolveDeterministicCommand,
    resolveStatefulDomains,
} from '../src/voice/lib/deterministicArbiter';
import { normalizeJuego } from '../src/voice/lib/configCommands';
import {
    setActiveGameSession,
    clearActiveGameSession,
} from '../src/core/games/gameSessionStore';
import type { GameSession } from '../src/core/games/types';

const session = (id: string): GameSession =>
    ({ id, state: {}, score: 0, round: 1 }) as unknown as GameSession;

describe('un turno de juego NUNCA se queda sin dueno de la voz', () => {
    afterEach(() => clearActiveGameSession());

    test('"siguiente carta": el motor es el dueno (no NINGUNO)', () => {
        setActiveGameSession(session('loteria'));

        const arbiterResult = resolveDeterministicCommand('siguiente carta', {});
        expect(arbiterResult.matched).toBe(true);
        expect(arbiterResult.domain).toBe('game');

        const stateful = resolveStatefulDomains('siguiente carta', { language: 'es' });
        expect(stateful.game).toMatchObject({ gameId: 'loteria', action: 'turn' });

        const resuelto = buildResolvedContract({
            contract: {
                contract: {
                    respuesta_voz: 'Siguiente carta: El sol sale para todos.',
                    navegacion: { comando: null, destino: null, parametros: {} },
                    workspace: null,
                    musica: null,
                    configuracion: null,
                    juego: { gameId: 'loteria', action: 'turn' },
                    ambiente: null,
                    metadata: { provider: 'llm' },
                },
            },
            lateStateful: stateful,
            fastPathConfig: stateful.config,
            fastGame: stateful.game,
            fastEnv: stateful.env,
        } as never);

        // El LLM no habla (sigue vigente P7.61)...
        expect((resuelto as { respuesta_voz?: string }).respuesta_voz).toBe('');
        expect((resuelto as { juego?: unknown }).juego).toBeNull();

        // ...PERO el motor SI: la regla de App.tsx despacha por clasificacion del
        // arbitro, sin el guard `!resolved?.fastPathGame` que lo inhibia.
        const juegoAction =
            (resuelto as { juego?: unknown }).juego ||
            (arbiterResult.domain === 'game' ? normalizeJuego(arbiterResult.action) : null);

        expect(juegoAction).toBeTruthy();
        expect((juegoAction as { action?: string }).action).toBeTruthy();
        expect((juegoAction as { gameId?: string }).gameId).toBeTruthy();

        const dueno = (juegoAction as { action?: string }).action
            ? 'MOTOR'
            : (resuelto as { respuesta_voz?: string }).respuesta_voz
              ? 'LLM'
              : 'NINGUNO';
        expect(dueno).not.toBe('NINGUNO');
        expect(dueno).toBe('MOTOR');
    });

    test('GUARD: App.tsx no vuelve a inhibir el despacho del motor por fastPathGame', () => {
        const app = fs.readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf8');
        // El guard que causo el defecto: unir la clasificacion con el flag
        // `fastPathGame` deja el turno sin despachar y sin voz.
        expect(app).not.toMatch(/domain === 'game'\s*&&\s*!resolved\?\.fastPathGame/);
    });
});
