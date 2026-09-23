// ============================================================
// protocolGuard.test.ts — Guard del PROTOCOLO DE ITERACIÓN RÁPIDA
// ============================================================
// Hace INAMOVIBLE la Regla #1 de la Sección 9: "npm test" (comando por defecto)
// ejecuta SOLO los tests del cambio (--changed); la suite completa queda
// reservada a "npm run test:full" (cierre de hitos/entregas/pre-commit/CI).
//
// DESACOPLADO DE AGENTS.md (P0.5): antes este guard fijaba PROSA del documento
// ('Iteración rápida', '--changed', 'Pre-commit LIGERO', ...), de modo que
// reescribir el doc ponía el gate en ROJO sin que nada se hubiera roto, y el
// documento no se podía corregir (P6.5/P6.8 son trabajo pendiente sobre su
// sección 4). Ahora comprueba solo los MECANISMOS que hacen verdad el protocolo:
// los scripts de package.json y el workflow de CI. El documento se redacta libre.
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
// Directorio raíz de la aplicación (una carpeta arriba de tests/).
const ROOT_DIR = path.resolve(__dirname, '..');
function readRootFile(name: string): string {
    return fs.readFileSync(path.join(ROOT_DIR, name), 'utf-8');
}
const pkg = JSON.parse(readRootFile('package.json')) as {
    scripts: Record<string, string>;
};
describe('Protocolo de Iteración Rápida — Guard estructural (inamovible)', () => {
    it('npm test (default) debe ejecutar SOLO los tests del cambio (--changed)', () => {
        const testScript = pkg.scripts['test'] ?? '';
        expect(
            testScript.includes('--changed'),
            `"test" debe usar --changed para la iteración mínima. Actual: "${testScript}"`,
        ).toBe(true);
        // El default NO debe ser la suite completa.
        expect(
            testScript.trim() === 'vitest run',
            `"test" no debe ser la suite completa (eso es test:full). Actual: "${testScript}"`,
        ).toBe(false);
    });
    it('debe existir "test:full" con la suite completa para cierre de hitos/pre-commit', () => {
        const fullScript = pkg.scripts['test:full'] ?? '';
        expect(
            fullScript.trim() === 'vitest run',
            `"test:full" debe ejecutar la suite completa. Actual: "${fullScript}"`,
        ).toBe(true);
    });
    it('el pre-commit LIGERO tiene sus dos mecanismos: lint (guards + eslint) y typecheck', () => {
        // El pre-commit ligero corre guards + tipos y NO la suite completa.
        // "lint" paso a incluir eslint en P7.1 (antes solo corria guards).
        const lint = pkg.scripts['lint'] ?? '';
        expect(lint).toContain('lint:guards');
        expect(lint).toContain('lint:eslint');
        expect(pkg.scripts['lint:eslint'] ?? '').toBe('eslint . --max-warnings=0');
        expect(pkg.scripts['typecheck'] ?? '').toBe('tsc -b');
        expect(lint).not.toContain('test:full');
    });
    it('los guards del protocolo corren en lint:guards (no solo dentro de la suite)', () => {
        const guards = pkg.scripts['lint:guards'] ?? '';
        expect(guards).toContain('protocolGuard.test.ts');
        expect(guards).toContain('stability-guards.test.ts');
        expect(guards).toContain('taskGateInvariant.test.ts');
        expect(guards).toContain('taskLedgerGuard.test.ts');
    });
    it('debe existir el workflow de CI con suite completa + build (gate de entrega)', () => {
        const ciPath = path.join(ROOT_DIR, '.github', 'workflows', 'ci.yml');
        const ci = fs.existsSync(ciPath) ? fs.readFileSync(ciPath, 'utf-8') : '';
        expect(ci, 'falta .github/workflows/ci.yml (gate de entrega)').toContain('test:full');
        expect(ci).toContain('npm run build');
        expect(ci).toContain('npm run typecheck');
    });
});
