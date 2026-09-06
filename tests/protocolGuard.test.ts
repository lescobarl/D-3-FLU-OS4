// ============================================================
// protocolGuard.test.ts — Guard del PROTOCOLO DE ITERACIÓN RÁPIDA
// ============================================================
// Hace INAMOVIBLE la Regla #1 de la Sección 9 de CLAUDE.md:
//   "npm test" (comando por defecto) ejecuta SOLO los tests del
//   cambio específico (--changed). La suite completa queda reservada
//   a "npm run test:full", usada SOLO en cierre de hitos/entregas
//   y pre-commit (Sección 6).
//
// Este test es la "regla de lint" estructural del protocolo: lee
// package.json y CLAUDE.md y FALLA si alguien debilita la estructura.
// Como se ejecuta dentro de la suite completa (test:full), cualquier
// intento de revertir el default a la suite completa o de eliminar
// test:full rompe la puerta de cierre de hitos — el protocolo queda
// blindado contra regresión.
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
const claude = readRootFile('CLAUDE.md');

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

    it('CLAUDE.md debe conservar el protocolo de iteración mínima y referenciar test:full', () => {
        expect(claude).toContain('Verificación por iteración mínima');
        expect(claude).toContain('--changed');
        expect(claude).toContain('test:full');
        expect(claude).toContain('protocolGuard.test.ts');
    });

    it('CLAUDE.md pre-commit (Sección 6) es LIGERO y la suite completa se delega al gate CI', () => {
        // El commit NO ejecuta la suite completa: se hace ligero (guards + typecheck).
        expect(claude).toMatch(/VALIDACIÓN PRE-COMMIT \(LIGERA\)/);
        expect(claude).toContain('npm run lint');
        expect(claude).toContain('npm run typecheck');
        // Y la suite completa queda documentada en el gate CI (una vez por push/PR).
        expect(claude).toContain('.github/workflows/ci.yml');
        expect(claude).toContain('npm run test:full');
    });

    it('debe existir el workflow de CI con suite completa + build (gate de entrega)', () => {
        const ciPath = path.join(ROOT_DIR, '.github', 'workflows', 'ci.yml');
        const ci = fs.existsSync(ciPath) ? fs.readFileSync(ciPath, 'utf-8') : '';
        expect(ci, 'falta .github/workflows/ci.yml (gate de entrega)').toContain('test:full');
        expect(ci).toContain('npm run build');
        expect(ci).toContain('npm run typecheck');
    });
});
