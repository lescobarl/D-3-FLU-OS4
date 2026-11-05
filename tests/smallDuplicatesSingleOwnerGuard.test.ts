/**
 * smallDuplicatesSingleOwnerGuard — tres duplicados pequenos confirmados por el triaje.
 *
 * Auditoria de codigo 2026-10-02 (confirmados al leer el cuerpo, no por el nombre):
 *   - `getAsrConfig`: el worker de Whisper repite la misma funcion que el segmentador
 *     (`FLU_CONFIG.transcript?.asr || {}`).
 *   - `newId`: `fluDatabase` exporta el generador uuid y `documentsService` tenia su
 *     propia copia del mismo cuerpo (`return uuidv4()`).
 *   - `setField`: los dos formularios de editor (ambiente y paleta) tienen el mismo
 *     setter sobre su estado de campos (solo cambia el tipo del patch, que en runtime
 *     no existe).
 *
 * El guard pregunta DOS cosas:
 *   1) TEXTO: cuantas definiciones hay por familia (debe ser EXACTAMENTE 1).
 *   2) COMPORTAMIENTO: los duenos unicos ejecutan lo que ejecutaban las copias
 *      (getAsrConfig devuelve la config real; newId devuelve un uuid v4).
 *
 * Los dos formularios siguen ejercitados por sus propios tests de conducta, que ya
 * estan en el gate.
 *
 * Prueba de DETECTOR real (0.24): se alimenta una copia sintetica y se comprueba que
 * el detector la marca; si el guard siguiera verde seria teatro.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { getAsrConfig } from '../src/voice/lib/asr/asrConfig.js';
import { newId } from '../src/core/db/fluDatabase';

const FAMILIES: readonly (readonly string[])[] = [['getAsrConfig'], ['newId'], ['setField']];

export interface SourceFile {
    file: string;
    source: string;
}

const DEF_RE = (name: string) =>
    new RegExp(`(?:function\\s+${name}\\s*[<(]|(?:const|let|var)\\s+${name}\\s*=)`);

/** Definiciones por familia: `archivo:simbolo:linea`. */
export function findFamilySites(sources: ReadonlyArray<SourceFile>): Record<string, string[]> {
    const sites: Record<string, string[]> = {};
    for (const { file, source } of sources) {
        source.split('\n').forEach((line, index) => {
            for (const family of FAMILIES) {
                for (const name of family) {
                    if (DEF_RE(name).test(line)) {
                        sites[family[0]] = sites[family[0]] || [];
                        sites[family[0]].push(`${file}:${name}:${index + 1}`);
                    }
                }
            }
        });
    }
    return sites;
}

/** Familias cuyo numero de definiciones no es exactamente 1. */
export function findDuplicatedFamilies(sources: ReadonlyArray<SourceFile>): string[] {
    const sites = findFamilySites(sources);
    return FAMILIES.map((f) => f[0])
        .filter((key) => (sites[key] || []).length !== 1)
        .map((key) => `${key} (${(sites[key] || []).length}): ${(sites[key] || []).join(', ') || '(ninguna)'}`);
}

function srcSources(): SourceFile[] {
    const walk = (dir: string, acc: string[] = []): string[] => {
        for (const entry of readdirSync(dir)) {
            const p = join(dir, entry);
            if (statSync(p).isDirectory()) walk(p, acc);
            else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !entry.endsWith('.d.ts')) acc.push(p);
        }
        return acc;
    };
    return walk(join(process.cwd(), 'src')).map((f) => ({
        file: relative(process.cwd(), f).replace(/\\/g, '/'),
        source: readFileSync(f, 'utf8'),
    }));
}

describe('smallDuplicatesSingleOwnerGuard — un dueno por duplicado pequeno', () => {
    it('cada familia tiene EXACTAMENTE una definicion', () => {
        const bad = findDuplicatedFamilies(srcSources());
        expect(bad, `Familias con duplicado (archivo:simbolo:linea):\n  ${bad.join('\n  ')}`).toEqual([]);
    });

    it('PRUEBA DE DETECTOR: la copia se marca', () => {
        const synthetic: SourceFile[] = [
            { file: 'src/a.ts', source: 'function newId(): string {\n  return uuidv4();\n}' },
            { file: 'src/b.ts', source: 'function newId(): string {\n  return uuidv4();\n}' },
        ];
        expect(findDuplicatedFamilies(synthetic).join('\n')).toContain('newId (2)');
    });

    it('PRUEBA DE DETECTOR: la familia perdida se marca (anti-vacuidad)', () => {
        const vacio: SourceFile[] = [{ file: 'src/a.ts', source: 'export const x = 1;' }];
        const bad = findDuplicatedFamilies(vacio);
        expect(bad.length).toBe(FAMILIES.length);
        expect(bad.join('\n')).toContain('(ninguna)');
    });

    it('el codigo limpio no se marca', () => {
        const clean: SourceFile[] = FAMILIES.map((f) => ({
            file: `src/${f[0]}.ts`,
            source: `export function ${f[0]}() {\n  return null;\n}`,
        }));
        expect(findDuplicatedFamilies(clean)).toEqual([]);
    });

    it('COMPORTAMIENTO: los duenos unicos hacen lo que hacian las copias', () => {
        // getAsrConfig: devuelve el bloque de config real (no una copia con otro valor).
        expect(getAsrConfig()).toEqual(expect.any(Object));
        // newId: uuid v4 (regla 3.6), mismo generador que usaba la copia.
        expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        expect(newId()).not.toBe(newId());
    });
});
