// ============================================================
// noteParserBindings.test.ts — Guard de bindings JS (evita el
// "parseNoteIntentText is not defined" que congeló FLU)
// ============================================================
// tsc NO type-checkea los .js de voice/lib; si un import se pierde,
// el fallo solo aparece en runtime. Este guard ejecuta el resolver
// real con una nota y verifica que los bindings existen.
import { describe, it, expect } from 'vitest';
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter';

describe('🧪 Bindings JS (notas) — sin import rotos', () => {
    it('reconocer una nota no lanza ReferenceError y resuelve al dominio note', () => {
        const result = resolveDeterministicCommand('ok flu apunta que tengo que llamar al dentista', {
            language: 'es',
        });
        expect(result).toBeTruthy();
        expect((result as any)?.matched).toBe(true);
        expect((result as any)?.domain).toBe('note');
    });

    it('recognizeNoteIntent produce una etiqueta limpia (via resolveDeterministicCommand)', () => {
        const result = resolveDeterministicCommand('apunta en la lista super comprar conejos', {
            language: 'es',
        });
        expect((result as any)?.matched).toBe(true);
        expect((result as any)?.domain).toBe('note');
        expect((result as any)?.action?.data?.label).toBe('Super: conejos');
    });
});
