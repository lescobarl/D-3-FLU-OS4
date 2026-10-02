/**
 * auditVacuityGuard — los dos detectores que estaban VACIOS en `auditoria.mjs`
 * ya no pueden estar verdes por ausencia.
 *
 * Defecto medido (auditoria de codigo, 2026-10-02): el catalogo declaraba
 *   V6  "Monkey-patch global (THREE.PropertyBinding)" con detector sobre
 *       `src/avatar/lib/masterBinding.ts` — fichero que NO existe en el repo;
 *   V17 "Archivo .mjs muerto/duplicado con import roto" con detector sobre
 *       `src/server/handlers/workspaceImageHandler.mjs` — ruta que NO existe.
 * Los dos salian verdes porque su objetivo habia desaparecido, no porque el
 * defecto no estuviera: verde por VACUIDAD (AGENTS.md 7.7.f(2)).
 *
 * El guard pregunta las dos cosas que hacen falta para que un detector no sea teatro:
 *   1) mide el arbol REAL (0 hallazgos hoy, y por el motivo correcto);
 *   2) DISPARA con un defecto sintetico (si no dispara, no mide) y NO marca lo legitimo.
 *
 * Los detectores son dueno unico de `scripts/audit-detectors.mjs`, que es tambien lo
 * que consume `scripts/auditoria.mjs`: el guard no reimplementa el patron.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findBrokenImports, findLibraryMonkeyPatches } from '../scripts/audit-detectors.mjs';

const ROOT = process.cwd();

function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p, acc);
        else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) acc.push(p);
    }
    return acc;
}

const srcFiles = walk(join(ROOT, 'src'));
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/');
const sources = srcFiles.map((f) => ({ file: rel(f), source: readFileSync(f, 'utf8') }));

describe('auditVacuityGuard — los detectores de auditoria miden de verdad', () => {
    it('V6 monkey-patch: 0 en el arbol, y DISPARA con un parche sintetico', () => {
        expect(findLibraryMonkeyPatches(sources)).toEqual([]);
        // El shim de DOM legitimo NO cuenta (es un falso positivo que hay que no marcar).
        expect(
            findLibraryMonkeyPatches([
                { file: 'src/avatar/lib/fbxDomShim.ts', source: "Object.defineProperty(el, 'src', { value: 1 });" },
            ]),
        ).toEqual([]);

        const sintetico = findLibraryMonkeyPatches([
            { file: 'src/a.ts', source: 'THREE.PropertyBinding.prototype.create = function () {};' },
            { file: 'src/b.ts', source: 'Object.defineProperty(THREE, "x", { value: 1 });' },
            { file: 'src/c.ts', source: '// Object.defineProperty(THREE, "x", {});' },
        ]);
        expect(sintetico).toHaveLength(2);
        expect(sintetico[0]).toContain('src/a.ts:1');
        expect(sintetico[1]).toContain('src/b.ts:1');
    });

    it('V17 import roto: 0 en el arbol, y DISPARA con una ruta que no existe', () => {
        const readSource = (f: string) => readFileSync(f, 'utf8');
        expect(findBrokenImports(srcFiles, readSource)).toEqual([]);

        const dir = join(ROOT, 'src/lib');
        const roto = findBrokenImports([join(dir, 'caughtError.ts')], () => "import x from './no-existe-xyz';");
        expect(roto.join('\n')).toContain('./no-existe-xyz');

        // Un import de tipos (.d.ts) y una ruta nombrada en un comentario NO son defectos.
        const legitimo = findBrokenImports(
            [join(dir, 'caughtError.ts')],
            () => "import type { X } from '../types/fluWindow';\n// antes se hacia from '...' aqui",
        );
        expect(legitimo).toEqual([]);
    });

    it('los dos objetivos vacios del catalogo ya no existen (el detector no puede serlo por ausencia)', () => {
        expect(
            [
                'src/avatar/lib/masterBinding.ts',
                'src/server/handlers/workspaceImageHandler.mjs',
            ].filter((p) => statSync(join(ROOT, p), { throwIfNoEntry: false })?.isFile()),
        ).toEqual([]);
    });
});
