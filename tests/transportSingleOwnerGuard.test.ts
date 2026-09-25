/**
 * P4.1/P4.6/P4.7 - guard de origen unico del transporte y de la configuracion.
 *
 * Tres formas del mismo defecto:
 *   P4.1  dos clientes HTTP para los mismos endpoints del proxy;
 *   P4.6  la misma resolucion de API key copiada en cliente y servidor;
 *   P4.7  la URL de Pollinations construida a mano fuera del constructor.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it, expect } from 'vitest';
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
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Fuente unica de la resolucion de API key. */
export const API_KEY_OWNER = 'src/core/config/sharedConfig.ts';
/** Fuente unica de la URL de imagen de Pollinations. */
export const POLLINATIONS_OWNER = 'src/core/config/sharedConfig.ts';
/** Copias de la resolucion de API key (la rama que etiqueta 'textConfig'). */
export function apiKeyResolutionCopies(src: string, fileName: string): string[] {
  if (fileName === API_KEY_OWNER) return [];
  return (src.match(/apiKeySource: 'textConfig'/g) || []).length > 0 ? [fileName] : [];
}
/** Construcciones a mano de la URL de Pollinations. */
export function pollinationsUrlBuilders(src: string, fileName: string): string[] {
  if (fileName === POLLINATIONS_OWNER) return [];
  // Se ignora lo comentado: una explicacion que mencione la construccion no es la
  // construccion (el propio comentario de P7.6 en fluVisualPipeline.js la nombra).
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  // Dos formas de la MISMA construccion a mano: la query cruda (`nologo=true`) y la
  // de URLSearchParams (`params.set('nologo', 'true')`). La segunda evadia a la
  // primera y por eso fluVisualPipeline.js paso el guard hasta P7.6.
  return /nologo=true|['"]nologo['"]\s*,/.test(code) ? [fileName] : [];
}
/** Llamadas crudas a fetch en un modulo que debe usar el cliente resiliente. */
export function rawFetchCalls(src: string): number {
  return (src.match(/await fetch\(/g) || []).length;
}
describe('P4.1/P4.6/P4.7 transporte - un origen por dato', () => {
  it('la resolucion de API key existe solo en su dueno', () => {
    const offenders = walk(SRC).flatMap((f) => apiKeyResolutionCopies(readFileSync(f, 'utf8'), rel(f)));
    expect(offenders, 'resolucion de API key copiada:\n  ' + offenders.join('\n  ')).toEqual([]);
    expect(read(API_KEY_OWNER)).toContain('export function resolveApiKey(');
  });
  it('la URL de Pollinations se construye solo en el constructor canonico', () => {
    const offenders = walk(SRC).flatMap((f) => pollinationsUrlBuilders(readFileSync(f, 'utf8'), rel(f)));
    expect(offenders, 'URL de Pollinations construida a mano:\n  ' + offenders.join('\n  ')).toEqual([]);
    expect(read(POLLINATIONS_OWNER)).toContain('export function buildPollinationsImageUrl(');
  });
  it('el adaptador de Gemini usa el cliente HTTP resiliente, no fetch crudo', () => {
    expect(rawFetchCalls(read('src/services/gemini.ts')), 'fetch crudo en el adaptador').toBe(0);
    expect(read('src/services/gemini.ts')).toContain('fetchTextEngineResilient');
  });
  it('POLLINATIONS_CONFIG deriva del catalogo en vez de re-declarar sus campos', () => {
    const cfg = read('src/core/config/appConfig.ts');
    expect(cfg).toContain('...POLLINATIONS_DEFAULTS');
  });
});
describe('P4.1/P4.6/P4.7 transporte - el detector no es decorativo', () => {
  it('marca la copia de la resolucion de API key y no marca al dueno', () => {
    expect(apiKeyResolutionCopies("return { apiKey, apiKeySource: 'textConfig' }", 'src/services/x.ts')).toHaveLength(1);
    expect(apiKeyResolutionCopies("apiKeySource: 'textConfig'", API_KEY_OWNER)).toEqual([]);
  });
  it('marca una URL de Pollinations a mano y no marca al dueno', () => {
    expect(pollinationsUrlBuilders('?width=1024&nologo=true', 'src/services/x.ts')).toHaveLength(1);
    // La evasion por URLSearchParams que dejo pasar a fluVisualPipeline.js (P7.6).
    expect(pollinationsUrlBuilders("params.set('nologo', 'true')", 'src/voice/lib/x.js')).toHaveLength(1);
    // Una mencion en un comentario NO es la construccion.
    expect(pollinationsUrlBuilders("// antes: params.set('nologo', 'true')", 'src/voice/lib/x.js')).toEqual([]);
    expect(pollinationsUrlBuilders('/* nologo=true */', 'src/voice/lib/x.js')).toEqual([]);
    // Una URL no debe confundirse con un comentario `//` (http://).
    expect(pollinationsUrlBuilders("const u = 'https://x/y?nologo=true'", 'src/x.ts')).toHaveLength(1);
    expect(pollinationsUrlBuilders("DEFAULT_PARAMS: 'nologo=true'", POLLINATIONS_OWNER)).toEqual([]);
  });
  it('cuenta las llamadas crudas a fetch', () => {
    expect(rawFetchCalls("await fetch('/x', {})")).toBe(1);
    expect(rawFetchCalls("await fetchTextEngineResilient('/x', {})")).toBe(0);
  });
});