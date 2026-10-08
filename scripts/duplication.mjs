#!/usr/bin/env node
/**
 * duplication.mjs — detector de duplicacion ESTRUCTURAL: la MISMA implementacion
 * escrita dos veces con OTRO nombre (o con otros identificadores y otro bucle).
 *
 * POR QUE EXISTE (medido 2026-10-08, HEAD ae6611c): los guards que habia miden
 * NOMBRES y LITERALES, no implementaciones.
 *   - `duplicationGuard` busca el nombre exacto (`function downsample`): renombrar
 *     a `downsampleTo16k` escapa.
 *   - `auditoria-codigo.duplicateBodies` compara el cuerpo normalizado: cambiar el
 *     nombre de las variables o `for..of` por `forEach` da 0 grupos.
 * Resultado medido: 3 copias de `concat` de PCM (concatFrames/concatChunks) y 2 de
 * `novelWords` (novelWords/novelWordsInShortFinal) vivas, con `lint:guards` VERDE.
 *
 * El esqueleto quita comentarios y cadenas, conserva las palabras clave del
 * lenguaje y sustituye TODO identificador por `_`. Dos copias que solo difieren en
 * nombres colisionan.
 *
 * UN DUENO de la logica (este modulo); dos consumidores:
 *   - tests/structureDuplicationGuard.test.ts  (barrera en `lint:guards`)
 *   - `node scripts/duplication.mjs --violations`  (metrica del gate)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Palabras clave / builtins: lo unico que NO se sustituye en el esqueleto. */
const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'for', 'of', 'in', 'if', 'else', 'new',
  'await', 'typeof', 'instanceof', 'while', 'break', 'continue', 'null', 'undefined',
  'true', 'false', 'async', 'export', 'default', 'yield', 'this', 'void', 'case',
  'switch', 'throw', 'try', 'catch', 'finally', 'class', 'extends', 'super', 'import',
  'from', 'defer', 'do', 'delete',
]);

/**
 * Esqueleto de un cuerpo: sin comentarios ni literales, con los identificadores
 * sustituidos por `_`. Dos implementaciones iguales dan el MISMO esqueleto aunque
 * los nombres cambien.
 * @param {string} src cuerpo de la funcion
 * @returns {string}
 */
export function skeleton(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:[^`\\]|\\.)*`/g, ' LIT ')
    .replace(/'(?:[^'\\]|\\.)*'/g, ' LIT ')
    .replace(/"(?:[^"\\]|\\.)*"/g, ' LIT ')
    .replace(/[A-Za-z_$][\w$]*/g, (m) => (KEYWORDS.has(m) ? m : '_'))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cuerpo `{...}` balanceado que empieza en `openIdx` (o null). */
function block(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  return null;
}

const FN_RE =
  /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{|(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g;

/**
 * Funciones con cuerpo `{}` de un fuente, con su esqueleto (>= minLines lineas).
 * @param {string} file ruta relativa
 * @param {string} source contenido
 * @param {number} minLines
 * @returns {Array<{ file: string, name: string, line: number, skel: string }>}
 */
export function findFunctions(file, source, minLines = 3) {
  const out = [];
  let m;
  FN_RE.lastIndex = 0;
  while ((m = FN_RE.exec(source))) {
    const open = source.indexOf('{', m.index + m[0].length - 1);
    if (open === -1) continue;
    const body = block(source, open);
    if (!body) continue;
    if (body.split('\n').length < minLines) continue;
    const skel = skeleton(body);
    if (skel.length < 60) continue;
    out.push({ file, name: m[1] || m[2], line: source.slice(0, m.index).split('\n').length, skel });
  }
  return out;
}

/** Lee todos los fuentes de `root` (ts/tsx/js/jsx, sin .d.ts). */
export function readSources(root = 'src') {
  const walk = (dir, acc = []) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p, acc);
      else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !entry.endsWith('.d.ts')) acc.push(p);
    }
    return acc;
  };
  return walk(join(process.cwd(), root)).map((f) => ({
    file: relative(process.cwd(), f).replace(/\\/g, '/'),
    source: readFileSync(f, 'utf8'),
  }));
}

/** Clave estable de un grupo: los `archivo:simbolo` ordenados (sin numero de linea). */
export function groupKey(sites) {
  return sites.map((s) => `${s.file}:${s.name}`).sort().join(' | ');
}

/**
 * Grupos de funciones con el MISMO esqueleto en ficheros DISTINTOS.
 * Una funcion repetida en su propio fichero no es el defecto (es el mismo sitio).
 * @param {Array<{file: string, source: string}>} sources
 * @param {number} minLines
 * @returns {Array<{ key: string, skel: string, sites: Array<{file:string,name:string,line:number}> }>}
 */
export function structuralGroups(sources, minLines = 3) {
  const bySkel = new Map();
  for (const { file, source } of sources) {
    for (const fn of findFunctions(file, source, minLines)) {
      if (!bySkel.has(fn.skel)) bySkel.set(fn.skel, []);
      bySkel.get(fn.skel).push({ file: fn.file, name: fn.name, line: fn.line });
    }
  }
  const groups = [];
  for (const [skel, sites] of bySkel) {
    if (new Set(sites.map((s) => s.file)).size < 2) continue;
    groups.push({ key: groupKey(sites), skel, sites });
  }
  return groups.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Contraste contra el baseline (DATO, shrink-only).
 * - `violations`: grupos reales que NO estan declarados (el defecto nuevo).
 * - `stale`: entradas del baseline que YA no son un grupo real (obliga a encogerlo).
 * @param {Array<{key:string, sites:Array}>} groups
 * @param {string[]} baseline
 */
export function evaluate(groups, baseline) {
  const declared = new Set(baseline);
  const real = new Set(groups.map((g) => g.key));
  return {
    violations: groups.filter((g) => !declared.has(g.key)),
    stale: baseline.filter((k) => !real.has(k)),
  };
}

/** Formatea un grupo como `archivo:simbolo:linea` para el mensaje de la barrera. */
export function formatGroup(group) {
  return group.sites.map((s) => `${s.file}:${s.name}:${s.line}`).sort().join('  <>  ');
}

if (process.argv[1] && process.argv[1].endsWith('duplication.mjs')) {
  const sources = readSources('src');
  const groups = structuralGroups(sources);
  const baselinePath = join(process.cwd(), 'tests/structureDuplicationGuard.baseline.json');
  let baseline = [];
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch {
    baseline = [];
  }
  const { violations, stale } = evaluate(groups, baseline);
  if (process.argv.includes('--violations')) {
    // La PRIMERA linea es el numero: es lo que lee la metrica del gate.
    console.log(String(violations.length));
    for (const v of violations) console.log(`DUPLICADO  ${formatGroup(v)}`);
    for (const s of stale) console.log(`BASELINE MUERTO  ${s}`);
  } else {
    console.log(`[duplication] ficheros=${sources.length} grupos=${groups.length} baseline=${baseline.length}`);
    console.log(`  fuera de baseline: ${violations.length} · baseline muerto: ${stale.length}`);
    for (const g of groups) {
      const mark = baseline.includes(g.key) ? 'declarado' : 'VIOLACION';
      console.log(`  [${mark}] ${formatGroup(g)}`);
    }
  }
}
