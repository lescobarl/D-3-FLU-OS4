/**
 * P1.7 - IndexedDB crudo fuera del singleton (una base, un dueno).
 *
 * CONTEXTO: src/core/autonomy/healthMonitor.ts abria una base de prueba
 * desechable ('flu-health-test') y la borraba con indexedDB.deleteDatabase. Era
 * un segundo almacen IndexedDB fuera del ciclo de vida de Dexie (AGENTS.md 7.7.c)
 * y el unico punto del proyecto que tocaba indexedDB sin pasar por el singleton.
 *
 * El guard congelado C30 (tests/indexedDbSingleGuard.test.ts) NO cubria el caso:
 * excluia a healthMonitor POR NOMBRE y solo miraba indexedDB.open, de modo que
 * deleteDatabase le era invisible. Eso es justo lo que AGENTS.md 7.7.d prohibe
 * (alcance todo src, sin excluir la carpeta del duplicado, alcanzando TODAS las
 * formas reales). Este guard nuevo cierra el hueco sin tocar el congelado.
 *
 * REGLA: ningun fuente de src/ abre ni borra IndexedDB a mano. La capa Dexie
 * (fluDatabase.ts) habla con indexedDB a traves de Dexie y expone la sonda
 * probeIndexedDb() para quien necesite comprobar disponibilidad.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
/** Formas reales del acceso manual a IndexedDB (case-insensitive: 7.7.d). */
export const RAW_INDEXEDDB = /indexeddb\s*\.\s*(?:open|deletedatabase)\s*\(/i;
export const SINGLETON_OWNER = 'src/core/db/fluDatabase.ts';
const NL = String.fromCharCode(10);

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) acc.push(p);
  }
  return acc;
}

/** Lineas de CODIGO (no comentario) que abren/borran IndexedDB a mano. */
export function rawIndexedDbLines(src: string): number[] {
  const out: number[] = [];
  src.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    if (RAW_INDEXEDDB.test(line)) out.push(i + 1);
  });
  return out;
}

describe('P1.7 indexedDB crudo - una base y un dueno', () => {
  it('ningun fuente de src/ toca indexedDB a mano', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const r = relative(ROOT, f).replace(/\\/g, '/');
      for (const ln of rawIndexedDbLines(readFileSync(f, 'utf8'))) offenders.push(r + ':' + ln);
    }
    expect(
      offenders,
      'acceso manual a IndexedDB (debe ser 0; el dueno es ' + SINGLETON_OWNER + '):' + NL + '  ' + offenders.join(NL + '  '),
    ).toEqual([]);
  });

  it('healthMonitor ya no es una excepcion (el guard congelado si lo era)', () => {
    const src = readFileSync(join(ROOT, 'src/core/autonomy/healthMonitor.ts'), 'utf8');
    expect(rawIndexedDbLines(src)).toEqual([]);
  });

  it('la capa Dexie expone la sonda en vez de abrir bases de prueba', () => {
    const src = readFileSync(join(ROOT, SINGLETON_OWNER), 'utf8');
    expect(src).toContain('export async function probeIndexedDb');
    expect(rawIndexedDbLines(src)).toEqual([]);
  });
});

describe('P1.7 - el detector no es decorativo (7.7.d)', () => {
  it('marca las dos formas reales, con espacios y en cualquier caja', () => {
    expect(rawIndexedDbLines('const r = indexedDB.open("flu-health-test", 1);')).toEqual([1]);
    expect(rawIndexedDbLines('indexedDB.deleteDatabase("flu-health-test");')).toEqual([1]);
    expect(rawIndexedDbLines('IndexedDB . deleteDatabase ( n );')).toEqual([1]);
    expect(rawIndexedDbLines('const r = IDBFactory.open("x");')).toEqual([]);
  });
  it('no confunde comentarios ni la mera deteccion de disponibilidad', () => {
    expect(rawIndexedDbLines('// antes: indexedDB.open("x", 1);')).toEqual([]);
    expect(rawIndexedDbLines(' * indexedDB.deleteDatabase(n);')).toEqual([]);
    expect(rawIndexedDbLines("if (typeof indexedDB === 'undefined') return false;")).toEqual([]);
  });
});
