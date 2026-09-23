/**
 * P4.3/P4.4/P4.5/P4.9/P4.13 - guard de duplicacion: un algoritmo, una copia.
 *
 * Estos cinco items eran el mismo defecto con cinco caras: la misma logica
 * escrita dos o mas veces, de modo que arreglar una copia no arregla las otras.
 * El guard lee los fuentes y exige que el algoritmo viva en un solo sitio.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it, expect } from 'vitest';
import { AI_PROVIDERS, AI_PROVIDER_SYNONYMS } from '../src/core/config/sharedConfig';
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) acc.push(p);
  }
  return acc;
}
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/');
/** Dueno unico del algoritmo de acentos. */
export const DIACRITICS_OWNER = 'src/lib/textUtils.ts';
/** Dueno unico del algoritmo de slug. */
export const SLUG_OWNER = 'src/lib/textUtils.ts';
/** Reimplementaciones del plegado NFD fuera del dueno. */
export function nfdOffenders(src: string, fileName: string): string[] {
  if (fileName === DIACRITICS_OWNER) return [];
  return src.includes("normalize('NFD')") ? [fileName] : [];
}
/** Definiciones de parseAllowlist en un fuente (debe haber una sola en src). */
export function allowlistDefinitions(src: string): number {
  return (src.match(/function parseAllowlist\s*\(/g) || []).length;
}
/** Declaraciones literales de la allowlist curada de wikipedia/educ.ar. */
export function curatedAllowlistLiterals(src: string): number {
  return (src.match(/\['wikipedia\.org', 'educ\.ar'\]/g) || []).length;
}
describe('P4.3/P4.4/P4.5/P4.9/P4.13 duplicacion - un algoritmo, una copia', () => {
  it('el plegado NFD existe solo en su dueno', () => {
    const offenders = walk(SRC).flatMap((f) => nfdOffenders(readFileSync(f, 'utf8'), rel(f)));
    expect(offenders, 'plegado NFD reimplementado fuera de ' + DIACRITICS_OWNER + ':\n  ' + offenders.join('\n  ')).toEqual([]);
  });
  it('el algoritmo de slug existe solo en su dueno; slugifyAmbiente delega', () => {
    const ambiente = readFileSync(join(ROOT, 'src/core/environments/ambienteFactory.ts'), 'utf8');
    expect(ambiente).toContain('slugifyPalette(nombre)');
    const owners = walk(SRC).filter((f) => /\.replace\(\/\[\^a-z0-9\]\+\/g, '-'\)/.test(readFileSync(f, 'utf8')));
    expect(owners.map(rel), 'algoritmo de slug duplicado').toEqual(['src/core/branding/paletaFactory.ts']);
  });
  it('parseAllowlist se define una sola vez y los proxies la importan', () => {
    const defs = walk(join(SRC, 'server')).filter((f) => allowlistDefinitions(readFileSync(f, 'utf8')) > 0).map(rel);
    expect(defs, 'parseAllowlist definida en varios sitios').toEqual(['src/server/allowlist.ts']);
    for (const p of ['src/server/searchProxy.ts', 'src/server/browserProxy.ts']) {
      expect(readFileSync(join(ROOT, p), 'utf8'), p + ' no importa la allowlist compartida').toContain("from './allowlist'");
    }
  });
  it('la allowlist curada de wikipedia/educ.ar se declara una sola vez', () => {
    const cfg = readFileSync(join(ROOT, 'src/voice/lib/fluConfig.js'), 'utf8');
    expect(curatedAllowlistLiterals(cfg), 'allowlist curada repetida').toBe(1);
    expect(cfg).toContain('CURATED_ALLOWLIST');
  });
  it('los sinonimos de proveedor cubren exactamente el catalogo', () => {
    expect(Object.keys(AI_PROVIDER_SYNONYMS).sort()).toEqual([...AI_PROVIDERS].sort());
  });
});
describe('P4.3/P4.4/P4.5/P4.9/P4.13 duplicacion - el detector no es decorativo', () => {
  it('marca el NFD reimplementado y no marca al dueno', () => {
    expect(nfdOffenders("x.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')", 'src/a.ts')).toHaveLength(1);
    expect(nfdOffenders("x.normalize('NFD')", DIACRITICS_OWNER)).toEqual([]);
  });
  it('cuenta definiciones de parseAllowlist y literales de la allowlist', () => {
    expect(allowlistDefinitions('function parseAllowlist(raw) {}')).toBe(1);
    expect(allowlistDefinitions('import { parseAllowlist } from "./x"')).toBe(0);
    expect(curatedAllowlistLiterals("a: ['wikipedia.org', 'educ.ar']")).toBe(1);
    expect(curatedAllowlistLiterals('CURATED_ALLOWLIST')).toBe(0);
  });
});