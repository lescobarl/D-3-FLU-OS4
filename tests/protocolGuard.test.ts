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

    it('CLAUDE.md pre-commit (Sección 6) debe usar test:full, no la suite en el default', () => {
        expect(claude).toContain('npm run test:full');
    });
});
