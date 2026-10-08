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
// documento no se podía corregir (P6.5/P6.8, ya cerrados, afectaban a su
// sección 4). Ahora comprueba solo los MECANISMOS que hacen verdad el protocolo:
// los scripts de package.json y el workflow de CI. El documento se redacta libre.
// ============================================================
import { describe, it, expect } from 'vitest';
import { GUARD_FILES } from '../scripts/guard-files.mjs';
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
    it('debe existir "test:full" con la suite completa, tras la barrera de autorizacion', () => {
        const fullScript = pkg.scripts['test:full'] ?? '';
        // Sigue siendo el UNICO dueño de la suite completa: corre todo, sin filtros.
        expect(
            fullScript.includes('vitest run'),
            `"test:full" debe ejecutar la suite completa. Actual: "${fullScript}"`,
        ).toBe(true);
        expect(fullScript, 'la suite completa no se filtra por cambio').not.toContain('--changed');
        // ...y ademas exige autorizacion expresa (AGENTS.md seccion 5): el atajo
        // "vitest run" a secas dejo de ser un camino valido.
        expect(
            fullScript.includes('scripts/require-full-suite-auth.mjs'),
            `"test:full" debe pasar por la barrera de autorizacion. Actual: "${fullScript}"`,
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
    it('los guards del protocolo corren en el gate (lista unica, no solo dentro de la suite)', () => {
        // La lista vive en scripts/guard-files.mjs y la consume el config del gate
        // (lint:guards -> vitest.guards.config.ts): sacarla de la linea de comandos es lo
        // que cierra el techo de cmd.exe (P9.22) sin dejar de correr en el gate (0.24/0.25).
        expect(GUARD_FILES).toContain('tests/protocolGuard.test.ts');
        expect(GUARD_FILES).toContain('tests/stability-guards.test.ts');
        expect(GUARD_FILES).toContain('tests/taskGateInvariant.test.ts');
        expect(GUARD_FILES).toContain('tests/taskLedgerGuard.test.ts');
        expect(pkg.scripts['lint:guards'] ?? '').toContain('vitest.guards.config.ts');
    });
    it('debe existir el workflow de CI con suite completa + build (gate de entrega)', () => {
        const ciPath = path.join(ROOT_DIR, '.github', 'workflows', 'ci.yml');
        const ci = fs.existsSync(ciPath) ? fs.readFileSync(ciPath, 'utf-8') : '';
        expect(ci, 'falta .github/workflows/ci.yml (gate de entrega)').toContain('test:full');
        expect(ci).toContain('npm run build');
        expect(ci).toContain('npm run typecheck');
    });
});
