// ============================================================
// contractFilesExist — el contrato NO debe citar archivos muertos
// ------------------------------------------------------------
// Hallazgo de auditoría: `.task/contract.json` seguía citando
// `tests/panelRescue.test.ts` (borrado). Vitest IGNORA el archivo faltante y el
// gate daba "✅ guard OK" → verde falso. Este guard lo detecta: todo `tests/...`
// citado en DoD/guard tiene que existir.
// ============================================================
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONTRACT = join(process.cwd(), '.task', 'contract.json');
const ROOT = process.cwd();

function testPathsIn(command: unknown): string[] {
    return String(command || '').match(/tests\/[A-Za-z0-9_.-]+\.tsx?/g) || [];
}

function missingIn(command: unknown): string[] {
    return testPathsIn(command).filter((p) => !existsSync(join(ROOT, p)));
}

describe('contrato — los tests citados en DoD/guard EXISTEN', () => {
    const contract = JSON.parse(readFileSync(CONTRACT, 'utf8')) as { dod?: string; guard?: string };

    it('el DoD no cita tests ausentes', () => {
        const missing = missingIn(contract.dod);
        expect(missing, `tests citados y AUSENTES en dod: ${missing.join(', ')}`).toEqual([]);
    });

    it('el guard no cita tests ausentes', () => {
        const missing = missingIn(contract.guard);
        expect(missing, `tests citados y AUSENTES en guard: ${missing.join(', ')}`).toEqual([]);
    });
});
