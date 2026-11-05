#!/usr/bin/env node
/**
 * auditoria-codigo.mjs — auditoria de CODIGO (no el catalogo de 28 puntos).
 *
 * POR QUE EXISTE (medido el 2026-10-02): `scripts/auditoria.mjs` decia "28/28
 * hallazgos en META" mientras una auditoria propia encontraba duplicados de dato,
 * un escritor de respuesta reimplementado y DOS DETECTORES DE SI MISMO verdes por
 * apuntar a ficheros inexistentes. El catalogo NO mide el codigo: mide 28 puntos.
 * Esta auditoria mide el codigo con criterios de rutas dobles / parches / hardcode.
 *
 * CONTRATO DE LECTURA (importante, y no es adorno):
 *   - Las senales devuelven CANDIDATOS con `archivo:linea`, no veredictos. El
 *     veredicto por caso exige LEER el sitio: medido en esta misma sesion, 5 lineas
 *     con URL fuera de config y 3 con "as any/@@ts-ignore" resultaron ser, al leerlas,
 *     0 violaciones reales (comentarios, un xmlns de SVG, el propio detector interno
 *     y una cadena de datos).
 *   - Un detector flojo tambien miente: la senal de "mismo cuerpo" daba 0 al principio
 *     de la sesion, cuando SI habia duplicacion (buildMinuteKey). Por eso cada senal
 *     trae control negativo en `--self-test`: si no dispara con el defecto inyectado,
 *     la senal no mide nada (AGENTS.md 7.7.f(2)).
 *
 * Uso:
 *   node scripts/auditoria-codigo.mjs              -> reporte (candidatos por senal)
 *   node scripts/auditoria-codigo.mjs --self-test  -> control negativo de cada senal
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
// A7: escaneo y corte de bloques con UN dueno (scripts/fsScan.mjs); readSources se
// re-exporta porque tests/auditCodeSignalsGuard.test.ts la consume.
import { block, readSources } from './fsScan.mjs';
export { readSources };

// Regla de FAÇADE: un cuerpo que es UNA sola llamada (`return helper(...)`) es un
// envoltorio que delega en su dueno, NO una copia. El criterio tiene un solo dueno:
// scripts/duplication.mjs (la barrera estructural). Medido 2026-10-08: sin esta regla,
// este auditor marcaba como duplicados los 4 envoltorios de requireConfigBlock y los 2
// de resolveDevDebugFlag que la unificacion creo a proposito.
import { isFacade } from './duplication.mjs';

const ROOT = process.cwd();

const rel = (f) => relative(ROOT, f).replace(/\\/g, '/');
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);
const strip = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:[^`\\]|\\.)*`/g, '`S`')
    .replace(/'(?:[^'\\]|\\.)*'/g, "'S'")
    .replace(/"(?:[^"\\]|\\.)*"/g, '"S"')
    .replace(/\s+/g, ' ')
    .trim();

// ---------------------------------------------------------------- senales
/** 1) Mismo CUERPO (normalizado) en ficheros distintos. */
export function duplicateBodies(sources, minLines = 3) {
  const groups = new Map();
  const RE =
    /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{|(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g;
  for (const { file, source } of sources) {
    let m;
    RE.lastIndex = 0;
    while ((m = RE.exec(source))) {
      const open = source.indexOf('{', m.index + m[0].length - 1);
      if (open === -1) continue;
      const body = block(source, open);
      if (!body) continue;
      const lines = body.split('\n').length;
      if (lines < minLines) continue;
      if (isFacade(body)) continue;
      const key = strip(body);
      if (key.length < 40) continue;
      const entry = { file, name: m[1] || m[2], line: source.slice(0, m.index).split('\n').length };
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
  }
  return [...groups.values()]
    .filter((arr) => new Set(arr.map((e) => e.file)).size > 1)
    .map((arr) => arr.map((e) => `${e.file}:${e.line}:${e.name}`));
}

/** 2) Mismo NOMBRE de funcion en >1 fichero. */
export function homonymFunctions(sources) {
  const map = new Map();
  for (const { file, source } of sources) {
    source.split('\n').forEach((line, index) => {
      const m = line.match(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
      if (!m) return;
      if (!map.has(m[1])) map.set(m[1], []);
      map.get(m[1]).push(`${file}:${index + 1}`);
    });
  }
  return [...map.entries()]
    .filter(([, sites]) => new Set(sites.map((s) => s.split(':')[0])).size > 1)
    .map(([name, sites]) => ({ name, sites }));
}

/** 3) Mismo SIMBOLO EXPORTADO definido en >1 fichero. */
export function exportedCollisions(sources) {
  const map = new Map();
  for (const { file, source } of sources) {
    source.split('\n').forEach((line, index) => {
      const m = line.match(/^\s*export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/);
      if (!m) return;
      if (!map.has(m[1])) map.set(m[1], []);
      map.get(m[1]).push(`${file}:${index + 1}`);
    });
  }
  return [...map.entries()]
    .filter(([, sites]) => new Set(sites.map((s) => s.split(':')[0])).size > 1)
    .map(([name, sites]) => ({ name, sites }));
}

/** 4) Mismo LITERAL (>= minChars) en >=2 ficheros. */
export function repeatedLiterals(sources, minChars = 18) {
  const map = new Map();
  const re = new RegExp(`['"\`]([^'"\`\\n]{${minChars},})['"\`]`, 'g');
  for (const { file, source } of sources) {
    // Las rutas de import/require no son contenido duplicado: se descartan
    // antes de buscar (un modulo compartido debe importarse desde varios sitios).
    const contenido = source
      .replace(/\bfrom\s*['"][^'"]*['"]/g, '')
      .replace(/\bimport\s*\(\s*['"][^'"]*['"]\s*\)/g, '')
      .replace(/\brequire\s*\(\s*['"][^'"]*['"]\s*\)/g, '');
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(contenido))) {
      const lit = m[1];
      if (/^\s*$/.test(lit) || /^[\s\W]*$/.test(lit)) continue;
      if (!map.has(lit)) map.set(lit, new Set());
      map.get(lit).add(file);
    }
  }
  return [...map.entries()]
    .filter(([, files]) => files.size >= 2)
    .map(([lit, files]) => ({ lit, files: files.size }));
}

/** 5) Candidatos de PARCHE: TODO/FIXME/HACK reales y monkey-patch de libreria. */
export function patchedCode(sources) {
  const out = [];
  for (const { file, source } of sources) {
    source.split('\n').forEach((line, index) => {
      if (isComment(line) && !/\b(TODO|FIXME|HACK)\b/.test(line)) return;
      if (/\/\/\s*(TODO|FIXME|HACK)\b/.test(line)) out.push(`${file}:${index + 1}: TODO/FIXME/HACK: ${line.trim().slice(0, 80)}`);
      if (isComment(line)) return;
      if (/Object\.defineProperty\(\s*(?:THREE|three)\b|\b[A-Z][A-Za-z0-9_$]*\.prototype\.[A-Za-z_$][\w$]*\s*=[^=]/.test(line)) {
        out.push(`${file}:${index + 1}: monkey-patch: ${line.trim().slice(0, 80)}`);
      }
    });
  }
  return out;
}

/** 6) Candidatos de HARDCODE: URL o modelo fuera de config. */
export function hardcodedOutsideConfig(sources, isConfigPath) {
  const out = [];
  for (const { file, source } of sources) {
    if (isConfigPath(file)) continue;
    source.split('\n').forEach((line, index) => {
      if (isComment(line)) return;
      if (/['"]https?:\/\/[a-z]/i.test(line)) out.push(`${file}:${index + 1}: URL: ${line.trim().slice(0, 80)}`);
      if (/['"](?:google|anthropic|openai|fal-ai|meta-llama|mistralai|qwen|x-ai|deepseek)\/[a-z0-9./_-]+['"]/i.test(line)) out.push(`${file}:${index + 1}: modelo: ${line.trim().slice(0, 80)}`);
    });
  }
  return out;
}

export const SIGNALS = { duplicateBodies, homonymFunctions, exportedCollisions, repeatedLiterals, patchedCode, hardcodedOutsideConfig };

// ---------------------------------------------------------------- self-test
/** Control negativo: cada senal DEBE disparar con el defecto inyectado. */
export function runSelfTest() {
  const failures = [];
  const twoFiles = (body) => [
    { file: 'src/a.ts', source: body },
    { file: 'src/b.ts', source: body },
  ];
  if (duplicateBodies(twoFiles('export function total(items) {\n  let s = 0;\n  for (const i of items) s += i.price;\n  return s;\n}')).length !== 1) {
    failures.push('duplicateBodies no dispara con un cuerpo copiado');
  }
  if (homonymFunctions(twoFiles('function clamp(v) {\n  return v;\n}')).length !== 1) {
    failures.push('homonymFunctions no dispara con el mismo nombre');
  }
  if (exportedCollisions(twoFiles('export interface Clamp { x: number }')).length !== 1) {
    failures.push('exportedCollisions no dispara con el mismo export');
  }
  if (repeatedLiterals(twoFiles("const m = 'un literal suficientemente largo';"), 18).length !== 1) {
    failures.push('repeatedLiterals no dispara con el literal repetido');
  }
  if (patchedCode([{ file: 'src/a.ts', source: 'Array.prototype.map = function () {};\n// TODO: quitar' }]).length !== 2) {
    failures.push('patchedCode no dispara con monkey-patch + TODO');
  }
  if (hardcodedOutsideConfig([{ file: 'src/a.ts', source: "const u = 'https://no-config.example';" }], () => false).length !== 1) {
    failures.push('hardcodedOutsideConfig no dispara con URL fuera de config');
  }
  if (hardcodedOutsideConfig([{ file: 'src/a.ts', source: "const m = 'fal-ai/wan-25-preview/text-to-video';" }], () => false).length !== 1) {
    failures.push('hardcodedOutsideConfig no dispara con un modelo fal-ai fuera de config');
  }
  if (hardcodedOutsideConfig([{ file: 'src/core/config/a.ts', source: "const m = 'fal-ai/wan-25-preview/text-to-video';" }], () => true).length !== 0) {
    failures.push('hardcodedOutsideConfig marca un modelo declarado en config');
  }
  // Y no debe marcar lo legitimo.
  if (duplicateBodies([{ file: 'src/a.ts', source: 'export function a() {\n  return 1;\n}' }]).length !== 0) {
    failures.push('duplicateBodies marca un fichero unico');
  }
  return failures;
}

export function buildReport(root = 'src') {
  const sources = readSources(root);
  const isConfigPath = (p) => p.includes('/config/') || /(appConfig|fluConfig|visualConfig|musicCatalog)\.(ts|js)$/.test(p);
  return {
    files: sources.length,
    duplicateBodies: duplicateBodies(sources),
    homonymFunctions: homonymFunctions(sources),
    exportedCollisions: exportedCollisions(sources),
    repeatedLiterals: repeatedLiterals(sources).length,
    patchedCode: patchedCode(sources),
    hardcodedOutsideConfig: hardcodedOutsideConfig(sources, isConfigPath),
  };
}

if (process.argv[1] && process.argv[1].endsWith('auditoria-codigo.mjs')) {
  if (process.argv.includes('--self-test')) {
    const failures = runSelfTest();
    if (failures.length) {
      console.error('SENALES QUE NO MIDEN:\n  ' + failures.join('\n  '));
      process.exit(1);
    }
    console.log('self-test OK: las 6 senales disparan con su defecto y no marcan lo legitimo.');
    process.exit(0);
  }
  const r = buildReport();
  console.log(`[auditoria-codigo] ficheros=${r.files}`);
  console.log(`CANDIDATOS (leer cada sitio antes de dar veredicto):`);
  console.log(`  cuerpos duplicados ....... ${r.duplicateBodies.length} grupos`);
  for (const g of r.duplicateBodies) console.log(`      ${g.join(' | ')}`);
  console.log(`  homonimos ................ ${r.homonymFunctions.length} nombres`);
  for (const h of r.homonymFunctions) console.log(`      ${h.name}: ${h.sites.join(', ')}`);
  console.log(`  colisiones de export ..... ${r.exportedCollisions.length} simbolos`);
  for (const c of r.exportedCollisions) console.log(`      ${c.name}: ${c.sites.join(', ')}`);
  console.log(`  literales repetidos ...... ${r.repeatedLiterals}`);
  console.log(`  parches .................. ${r.patchedCode.length}`);
  for (const p of r.patchedCode) console.log(`      ${p}`);
  console.log(`  hardcode fuera de config . ${r.hardcodedOutsideConfig.length}`);
  for (const h of r.hardcodedOutsideConfig) console.log(`      ${h}`);
}
