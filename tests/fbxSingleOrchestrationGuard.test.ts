/**
 * P4.2 - FBX: una sola orquestacion de descarga + parseo.
 *
 * AGENTS.md 7.7.b: un respaldo legitimo EN LA INTENCION sigue siendo ruta doble
 * si la ORQUESTACION esta copiada. El worker (fbxLoader.worker.js) y el respaldo
 * main-thread (fbxWorkerClient.runMainThreadFallback) tenian el mismo fetch, el
 * mismo chequeo HTTP, el mismo parse y el MISMO literal de error escritos dos
 * veces. Ahora ambos llaman a fetchFbxJson() en el dueno unico.
 *
 * REGLA VIGILADA: en todo src/ solo puede existir UN sitio que llame a
 * parseFbxBuffer(), y debe vivir en el dueno. Ademas el literal de error del
 * fetch no puede reaparecer en un consumidor.
 *
 * AMBITO: todo src/, sin excluir la carpeta donde vivia el duplicado (7.7.d).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/** Dueno unico de la orquestacion de carga FBX. */
export const FBX_OWNER = 'src/avatar/lib/fbxParse.ts';
/** Consumidores que deben delegar, nunca reimplementar. */
export const FBX_CONSUMERS: readonly string[] = [
  'src/avatar/workers/fbxLoader.worker.js',
  'src/avatar/workers/fbxWorkerClient.ts',
];
const FETCH_ERROR = 'fetch FBX';

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) acc.push(p);
  }
  return acc;
}

const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

/** Sitios que LLAMAN a parseFbxBuffer() (excluye definicion y comentarios). */
export function orchestrationSites(src: string, fileName: string): string[] {
  const out: string[] = [];
  src.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    if (/function\s+parseFbxBuffer/.test(line)) return;
    if (/parseFbxBuffer\s*\(/.test(line)) out.push(fileName + ':' + (i + 1));
  });
  return out;
}

describe('P4.2 FBX - una sola orquestacion de carga', () => {
  it('solo el dueno llama a parseFbxBuffer()', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      offenders.push(...orchestrationSites(readFileSync(f, 'utf8'), rel(f)));
    }
    expect(
      offenders,
      'orquestaciones duplicadas (debe quedar solo ' + FBX_OWNER + '):' + String.fromCharCode(10) + '  ' + offenders.join(String.fromCharCode(10) + '  '),
    ).toHaveLength(1);
    expect(offenders[0].startsWith(FBX_OWNER + ':')).toBe(true);
  });

  it('los consumidores delegan: no reescriben el fetch ni su error', () => {
    for (const f of FBX_CONSUMERS) {
      expect(read(f).includes(FETCH_ERROR), f + ' reimplementa el fetch del FBX').toBe(false);
    }
  });

  it('el dueno expone la orquestacion compartida', () => {
    expect(read(FBX_OWNER)).toContain('export async function fetchFbxJson');
  });
});

describe('P4.2 - el detector no es decorativo (7.7.d)', () => {
  it('marca dos orquestaciones y distingue la definicion', () => {
    const dup = [
      'const a = parseFbxBuffer(buffer, url);',
      'const b = parseFbxBuffer(b2, url2);',
    ].join(String.fromCharCode(10));
    expect(orchestrationSites(dup, 'src/avatar/workers/fbxLoader.worker.js')).toHaveLength(2);
    expect(
      orchestrationSites('export function parseFbxBuffer(b: ArrayBuffer, u: string) { return 1; }', FBX_OWNER),
    ).toEqual([]);
    expect(orchestrationSites('// parseFbxBuffer(x, y)', 'src/x.ts')).toEqual([]);
  });
});
