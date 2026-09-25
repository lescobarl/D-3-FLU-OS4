// ============================================================
// voiceTurnCommitDerivation.test.ts — GUARD §9 (derivación única)
// ------------------------------------------------------------
// Invariante: la FILA de conversación (transcript enviado a onContractResolved)
// debe ser EXACTAMENTE el valor que se commiteó con commitTurnPhrase(...).
// Es decir: `const <canonical> = commitTurnPhrase(<X>)` y, en la misma rama,
// `transcript: <canonical>`. Si una rama descarta el retorno o manda otra
// expresión, falla y LISTA la rama (archivo:línea) — patrón §B11.
//
// Nace ROJO: hoy hay ramas (processCapture, comando genérico, catch) que
// descartan el retorno o pasan otra variable → display != fila.
// ============================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILE = 'src/voice/hooks/useFluVoiceAssistant.js';

type Violation = { line: number; reason: string };

function lineAt(source: string, index: number): number {
    return source.slice(0, index).split(/\r?\n/).length;
}

export function findCommitDerivationViolations(source: string): Violation[] {
    const violations: Violation[] = [];
    const callRe = /commitTurnPhrase\(/g;
    const assignRe = /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*commitTurnPhrase\(/;
    let match: RegExpExecArray | null;
    while ((match = callRe.exec(source))) {
        const at = match.index;
        const line = lineAt(source, at);
        const lineStart = source.lastIndexOf('\n', at) + 1;
        const lineEnd = source.indexOf('\n', at);
        const lineText = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);

        // 1) El retorno del commit debe capturarse en una variable canónica.
        const assign = assignRe.exec(lineText);
        if (!assign) {
            violations.push({
                line,
                reason: 'retorno DESCARTADO: la fila no puede usar el valor commiteado',
            });
            continue;
        }
        const canonical = assign[1];

        // 2) En la misma rama (hasta el próximo commit o 4000 chars) la fila
        //    debe usar ESA variable como `transcript`.
        const window = source.slice(at, at + 4000);
        const nextCall = window.indexOf('commitTurnPhrase(', 1);
        const scope = nextCall >= 0 ? window.slice(0, nextCall) : window;
        const usesCanonical = new RegExp(`transcript:\\s*${canonical}\\b`).test(scope);
        if (!usesCanonical) {
            violations.push({
                line,
                reason: `la fila NO usa "${canonical}" (display != fila)`,
            });
        }
    }
    return violations;
}

describe('§9 — la fila usa el valor commiteado (derivación única)', () => {
    it('ninguna rama descarta el retorno ni manda otra expresión como transcript', () => {
        const source = readFileSync(join(process.cwd(), FILE), 'utf8');
        const violations = findCommitDerivationViolations(source);
        const detail = violations.map((v) => `${FILE}:${v.line} — ${v.reason}`).join('\n');
        expect(violations, `\nRutas con display != fila (${violations.length}):\n${detail}`).toEqual(
            [],
        );
    });
});
