/**
 * P4.2 (a) — Banco de rendimiento: cuánto BLOQUEA el parse FBX en el hilo principal.
 *
 * NO es un test de CI a propósito. vitest solo recoge `tests/ ** / *.test.ts`, así que
 * este fichero queda fuera de `npm run test`, `npm run lint:guards` y `npm run gate`.
 * Se ejecuta a mano:
 *
 *   npx vitest bench tests/bench/fbxParse.bench.ts
 *
 * POR QUÉ EXISTE: `parseFbxBuffer()` es síncrono (FBXLoader.parse) y, cuando el
 * worker no arranca, `fbxWorkerClient.runMainThreadFallback` lo ejecuta en el hilo
 * principal. Ese es el respaldo que aquí se mide: el bloqueo completo del hilo.
 *
 * Mide la ruta REAL: importa el dueño único de la orquestación (fbxParse.ts), no
 * una copia. Cambiar el dueño cambia este banco.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bench, describe } from 'vitest';
import { parseFbxBuffer } from '../../src/avatar/lib/fbxParse';

const ROOT = process.cwd();

/** Vista estructural mínima del grafo THREE (evita `any` y el doble cast). */
interface Node3D {
  isMesh?: boolean;
  isSkinnedMesh?: boolean;
  isBone?: boolean;
  children?: Node3D[];
}

/** Cuenta mallas/huesos del árbol: confirma que el parse fue REAL, no un no-op. */
export function countParts(root: Node3D): { meshes: number; bones: number } {
  let meshes = 0;
  let bones = 0;
  const walk = (n: Node3D): void => {
    if (n.isMesh || n.isSkinnedMesh) meshes += 1;
    if (n.isBone) bones += 1;
    for (const c of n.children || []) walk(c);
  };
  walk(root);
  return { meshes, bones };
}

interface Fixture {
  buffer: ArrayBuffer;
  url: string;
  mb: number;
}

function load(rel: string): Fixture {
  const bytes = readFileSync(join(ROOT, rel));
  return {
    buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    url: '/' + rel.replace(/\\/g, '/'),
    mb: bytes.byteLength / (1024 * 1024),
  };
}

const FULL = 'Bunny_full.fbx (3,4 MB)';
const BODY = 'Bunny_body.fbx (2,5 MB)';
const FIXTURES: Record<string, Fixture> = {
  [FULL]: load('public/models/Bunny_full.fbx'),
  [BODY]: load('public/models/Bunny_body.fbx'),
};

const OPTIONS = { iterations: 3, warmupIterations: 1, time: 0, warmupTime: 0 } as const;

// Control: el arbol REAL parseado una vez, para (1) probar que el parse no es un
// no-op y (2) medir el recorrido por separado del parse.
const CONTROL = parseFbxBuffer(FIXTURES[FULL].buffer, '/control.fbx') as Node3D;
const PARTS = countParts(CONTROL);
console.log(
  `[bench] ${FULL} -> ${PARTS.meshes} mallas, ${PARTS.bones} huesos (parse real, no un no-op)`,
);

describe('P4.2 (a) — bloqueo del parse FBX en el hilo principal', () => {
  for (const [name, fx] of Object.entries(FIXTURES)) {
    bench(
      `${name}: parseFbxBuffer (el trabajo que bloquea el respaldo main-thread)`,
      () => {
        parseFbxBuffer(fx.buffer, fx.url);
      },
      OPTIONS,
    );
  }

  bench(
    'control: recorrer el arbol YA parseado (aisla el coste del recorrido del de parsear)',
    () => {
      countParts(CONTROL);
    },
    OPTIONS,
  );
});
