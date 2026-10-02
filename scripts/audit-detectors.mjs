/**
 * audit-detectors.mjs — los DOS detectores que estaban vacios en `auditoria.mjs`.
 *
 * DUENO UNICO: los importan `scripts/auditoria.mjs` (para el catalogo de hallazgos)
 * y `tests/auditVacuityGuard.test.ts` (que los mete en la barrera y prueba que
 * DISPARAN con un defecto sintetico). Antes vivian inline en auditoria.mjs y
 * apuntaban a ficheros concretos:
 *   V6  -> `src/avatar/lib/masterBinding.ts` (no existe)     => verde por ausencia
 *   V17 -> `src/server/handlers/workspaceImageHandler.mjs`   (no existe) => verde por ausencia
 * Un detector que solo puede estar verde porque su objetivo desaparecio no mide
 * nada (AGENTS.md 7.7.f(2)): el patron debe alcanzar TODAS las formas del defecto y
 * probarse por los dos lados (ve el defecto y no marca lo legitimo, 7.7.f(5)).
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const isCommentLine = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

/**
 * Monkey-patch de una libreria: asignar a un prototipo ajeno, o redefinir una
 * propiedad de THREE. NO cuenta el shim de DOM (`Object.defineProperty(el, ...)`),
 * que es una imitacion local y no un parche a una libreria externa.
 */
export const MONKEY_PATCH_RE =
  /\bObject\.defineProperty\(\s*(?:THREE|three)\b|\bTHREE\.[A-Za-z_$][\w$]*\.prototype\.[A-Za-z_$][\w$]*\s*=[^=]|\b[A-Z][A-Za-z0-9_$]*\.prototype\.[A-Za-z_$][\w$]*\s*=[^=]/;

/** @param {Array<{file: string, source: string}>} sources */
export function findLibraryMonkeyPatches(sources) {
  const out = [];
  for (const { file, source } of sources) {
    source.split('\n').forEach((line, index) => {
      if (isCommentLine(line)) return;
      if (MONKEY_PATCH_RE.test(line)) out.push(`${file}:${index + 1}:${line.trim().slice(0, 90)}`);
    });
  }
  return out;
}

const IMPORT_RE = /(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g;
const RESOLUTIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.d.ts', '/index.ts', '/index.js', '/index.tsx'];

/**
 * Import relativo que NO resuelve a ningun fichero real (modulo muerto o ruta rota).
 * Se saltan las lineas de comentario: una explicacion que nombre una ruta no es una
 * ruta (falso positivo medido: `from '...'` dentro de un comentario).
 */
export function findBrokenImports(files, readSource) {
  const out = [];
  for (const file of files) {
    const source = readSource(file);
    let match;
    IMPORT_RE.lastIndex = 0;
    while ((match = IMPORT_RE.exec(source))) {
      const spec = match[1];
      const line = source.slice(0, match.index).split('\n').pop() || '';
      if (isCommentLine(line)) continue;
      const base = join(dirname(file), spec);
      if (!RESOLUTIONS.some((ext) => existsSync(base + ext))) {
        out.push(`${file}:${source.slice(0, match.index).split('\n').length}:${spec}`);
      }
    }
  }
  return out;
}
