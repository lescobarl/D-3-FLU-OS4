/**
 * workerRuntimeSingleOwnerGuard — `isWorkerRuntime` tiene UN solo dueno.
 *
 * Defecto medido (auditoria de codigo, 2026-10-02, RE-MEDIDO): de los 4 pares que
 * el informe agrupaba bajo "orquestacion de worker triplicada", solo uno es la MISMA
 * funcion copiada:
 *   - `isWorkerRuntime`: src/avatar/workers/fbxWorkerClient.ts (`typeof Worker !== 'undefined'`)
 *     y src/voice/lib/voiceIdWorkerClient.js (`... && typeof window !== 'undefined'`): misma
 *     pregunta, dos copias, y la de voz anadia una guarda que solo importa fuera del main
 *     thread (donde ese cliente no corre). Es ruta doble -> un dueno.
 *   - `runMainThreadFallback` (2): NO es duplicado: cada cliente tiene SU respaldo
 *     (fbx: fetchFbxJson; voz: calculo local de embedding). Mismo nombre, trabajo distinto.
 *   - `scheduleIdle` (2): NO es duplicado: una version es fire-and-forget (devuelve void,
 *     voiceIdentityQueue) y la otra devuelve Promise (voiceIdWorkerClient). Misma firma
 *     aparente, semantica distinta.
 *   - el esqueleto de `ensureWorker` (crear perezoso + pendientes por id + rechazar todos
 *     en onerror): SI esta copiado 3 veces, pero cada cliente tiene una politica distinta
 *     (fbx marca muerto y no recrea; voz rechaza; whisper termina y recrea) y un timeout
 *     distinto. Extraerlo es un hito propio: queda registrado como pendiente P8.9.
 *
 * El guard pregunta DOS cosas: el dueno unico (texto) y que la funcion responda de verdad
 * a la existencia de `Worker` (conducta).
 *
 * Prueba de DETECTOR real (0.24): se alimenta una copia sintetica y se comprueba que
 * el detector la marca; si el guard siguiera verde seria teatro.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isWorkerRuntime } from '../src/lib/workerRuntime';

const ROOT = process.cwd();

export interface SourceFile {
    file: string;
    source: string;
}

/** Definiciones de `isWorkerRuntime` en las fuentes dadas: `archivo:linea`. */
export function findWorkerRuntimeOwners(sources: ReadonlyArray<SourceFile>): string[] {
    const hits: string[] = [];
    for (const { file, source } of sources) {
        source.split('\n').forEach((line, index) => {
            if (/function\s+isWorkerRuntime\s*[<(]/.test(line)) hits.push(`${file}:${index + 1}`);
        });
    }
    return hits;
}

function srcSources(): SourceFile[] {
    const walk = (dir: string, acc: string[] = []): string[] => {
        for (const entry of readdirSync(dir)) {
            const p = join(dir, entry);
            if (statSync(p).isDirectory()) walk(p, acc);
            else if (/\.(ts|tsx|js|jsx)$/.test(entry)) acc.push(p);
        }
        return acc;
    };
    return walk(join(ROOT, 'src')).map((f) => ({
        file: relative(ROOT, f).replace(/\\/g, '/'),
        source: readFileSync(f, 'utf8'),
    }));
}

describe('workerRuntimeSingleOwnerGuard — un solo isWorkerRuntime', () => {
    it('hay UNA definicion de isWorkerRuntime en src', () => {
        const owners = findWorkerRuntimeOwners(srcSources());
        expect(owners, `Definiciones de isWorkerRuntime: ${owners.join(', ') || '(ninguna)'}`).toHaveLength(1);
        expect(owners[0]).toContain('src/lib/workerRuntime.ts:');
    });

    it('PRUEBA DE DETECTOR: la copia se marca', () => {
        const synthetic: SourceFile[] = [
            { file: 'src/a.ts', source: 'function isWorkerRuntime(): boolean {\n  return true;\n}' },
            { file: 'src/b.js', source: 'function isWorkerRuntime() {\n  return true;\n}' },
        ];
        expect(findWorkerRuntimeOwners(synthetic)).toEqual(['src/a.ts:1', 'src/b.js:1']);
    });

    it('el codigo limpio (una definicion) no se marca', () => {
        const clean: SourceFile[] = [{ file: 'src/a.ts', source: 'export function isWorkerRuntime() { return true }' }];
        expect(findWorkerRuntimeOwners(clean)).toHaveLength(1);
    });

    it('COMPORTAMIENTO: isWorkerRuntime responde a la existencia real de Worker', () => {
        const original = (globalThis as { Worker?: unknown }).Worker;
        try {
            delete (globalThis as { Worker?: unknown }).Worker;
            expect(isWorkerRuntime()).toBe(false);
            (globalThis as { Worker?: unknown }).Worker = class {};
            expect(isWorkerRuntime()).toBe(true);
        } finally {
            if (original === undefined) delete (globalThis as { Worker?: unknown }).Worker;
            else (globalThis as { Worker?: unknown }).Worker = original;
        }
    });
});
