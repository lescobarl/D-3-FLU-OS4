// ============================================================
// quienSoyMention — FLU no reutiliza un animal que el jugador ya nombró
// ------------------------------------------------------------
// Reporte real: en "¿Quién soy?" FLU "pensó" el MISMO animal que el jugador
// había dicho. Invariante (offline, banco fijo): al avanzar se SALTAN los
// animales que el jugador ya mencionó.
// ============================================================
import { describe, it, expect } from 'vitest';
import { createQuienSoyEngine, QUIEN_SOY_BANK } from '../src/core/games/quienSoy';

describe('¿Quién soy? — no reutiliza animales ya nombrados por el jugador', () => {
    it('salta el animal mencionado al pasar al siguiente', () => {
        const engine = createQuienSoyEngine({ random: () => 0.37 });
        const session = engine.createSession({});
        engine.start(session, {});
        const state = session.state as unknown as { order: number[]; cursor: number };

        const nextIdx = state.order[state.cursor + 1];
        const mentionedName = QUIEN_SOY_BANK[nextIdx].nombre;

        // El jugador nombra ESE animal (respuesta incorrecta) → queda registrado.
        const wrong = engine.turn(session, `es un ${mentionedName}`);
        expect(wrong.error).toBe('respuesta incorrecta');

        // Pasa al siguiente: el objetivo NO puede ser el animal ya nombrado.
        engine.turn(session, 'paso');
        const newTargetIdx = state.order[state.cursor];
        expect(QUIEN_SOY_BANK[newTargetIdx].nombre).not.toBe(mentionedName);
    });
});
