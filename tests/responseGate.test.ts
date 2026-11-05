// ============================================================
// responseGate.test.ts — Guard de idempotencia de la respuesta de FLU
// ------------------------------------------------------------
// Invariante: la MISMA respuesta para el MISMO turno dentro de la ventana se
// considera re-captura/eco y se suprime (no repite el habla). Texto distinto,
// fuera de ventana, o ventana 0 → no se suprime.
// ============================================================
import { describe, expect, it } from 'vitest';
import { buildResponseKey, isDuplicateResponse } from '../src/core/voice/responseGate';

describe('responseGate — no repetir la respuesta del mismo turno', () => {
    it('misma respuesta + mismo texto dentro de la ventana → duplicado', () => {
        const key = buildResponseKey('Okay flu estás ahí', 'Te escucho.');
        const state = { key, at: 1000 };
        expect(isDuplicateResponse(state, key, 2000, 8000)).toBe(true);
    });

    it('fuera de la ventana → no duplicado', () => {
        const key = buildResponseKey('a', 'b');
        const state = { key, at: 1000 };
        expect(isDuplicateResponse(state, key, 10000, 8000)).toBe(false);
    });

    it('texto distinto → no duplicado', () => {
        const state = { key: buildResponseKey('a', 'b'), at: 1000 };
        expect(isDuplicateResponse(state, buildResponseKey('c', 'd'), 2000, 8000)).toBe(false);
    });

    it('clave vacía o ventana 0 → nunca duplicado', () => {
        expect(isDuplicateResponse({ key: '', at: 0 }, '', 1000, 8000)).toBe(false);
        expect(isDuplicateResponse({ key: 'x|y', at: 0 }, 'x|y', 1000, 0)).toBe(false);
    });

    it('normaliza mayúsculas y espacios', () => {
        expect(buildResponseKey('  HOLA   Flu ', 'Te   ESCUCHO')).toBe(
            buildResponseKey('hola flu', 'te escucho'),
        );
    });
});
