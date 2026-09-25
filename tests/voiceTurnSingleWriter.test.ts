// ============================================================
// voiceTurnSingleWriter.test.ts — GUARD §9 (un solo commit de turno)
// ------------------------------------------------------------
// Invariante: la locución del turno (frase visible + fila de conversación)
// tiene UN solo escritor: `commitTurnPhrase(...)`.
// `commitVisibleTranscript` NO debe llamarse fuera del helper y del reset.
//
// Nace ROJO: hoy hay 15 llamadas directas a `commitVisibleTranscript(`.
// ============================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (): string =>
    readFileSync(join(process.cwd(), 'src/voice/hooks/useFluVoiceAssistant.js'), 'utf8');

describe('§9 — UN solo commit de la locución del turno', () => {
    it('commitVisibleTranscript solo se usa en el helper y en el reset', () => {
        const src = source();
        const calls = src.match(/commitVisibleTranscript\(/g) || [];
        // helper (1) + reset (1). Cualquier llamada extra = segunda ruta.
        expect(
            calls.length,
            `llamadas directas a commitVisibleTranscript: ${calls.length} (esperado 2)`,
        ).toBeLessThanOrEqual(2);
    });

    it('la fila de conversación usa la MISMA frase canónica que el display', () => {
        const src = source();
        const idx = src.indexOf('const canonicalPhrase = commitTurnPhrase(');
        expect(idx).toBeGreaterThanOrEqual(0);
        const block = src.slice(idx, idx + 6000);
        expect(block).toContain('transcript: canonicalPhrase');
    });
});
