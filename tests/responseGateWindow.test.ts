// ============================================================
// responseGateWindow — idempotencia de respuestas por VENTANA (no solo última)
// ------------------------------------------------------------
// Bug real: la respuesta de FLU se re-emitía y se volvía a registrar con la
// MISMA clave; el gate solo recordaba la última respuesta, así que una
// re-emisión de una respuesta ANTERIOR se duplicaba (16:43:02 y 16:43:06).
// Invariante: cualquier respuesta de la ventana con la misma clave se omite.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
    buildResponseKey,
    isDuplicateResponseIn,
    pushResponseState,
} from '../src/core/voice/responseGate';

const WINDOW = 8000;

describe('responseGate — ventana de respuestas (no solo la última)', () => {
    it('detecta la re-emisión de una respuesta ANTERIOR dentro de la ventana', () => {
        const a = { key: buildResponseKey('cita con el homeópata', 'Listo: homeópata'), at: 1000 };
        const b = { key: buildResponseKey('cita doctor homeópata', 'Listo: doctor'), at: 3000 };
        const states = pushResponseState(pushResponseState([], a.key, a.at, WINDOW), b.key, b.at, WINDOW);
        // La re-emisión de A en t=5000 con B como última también se detecta.
        expect(isDuplicateResponseIn(states, a.key, 5000, WINDOW)).toBe(true);
        expect(isDuplicateResponseIn(states, b.key, 5000, WINDOW)).toBe(true);
    });

    it('no marca duplicado fuera de la ventana', () => {
        const states = pushResponseState([], 'k1', 1000, WINDOW);
        expect(isDuplicateResponseIn(states, 'k1', 1000 + WINDOW + 1, WINDOW)).toBe(false);
    });

    it('push descarta las entradas vencidas', () => {
        let states = pushResponseState([], 'viejo', 1000, WINDOW);
        states = pushResponseState(states, 'nuevo', 1000 + WINDOW + 1, WINDOW);
        expect(states.map((s) => s.key)).toEqual(['nuevo']);
    });

    it('clave vacía o ventana <= 0 desactiva la deduplicación', () => {
        const states = pushResponseState([], '', 1000, WINDOW);
        expect(isDuplicateResponseIn(states, '', 1001, WINDOW)).toBe(false);
        expect(isDuplicateResponseIn([{ key: 'x', at: 1 }], 'x', 2, 0)).toBe(false);
    });
});
