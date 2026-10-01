/**
 * P4.1/P4.6/P4.7 - guard de origen unico del transporte y de la configuracion.
 *
 * Tres formas del mismo defecto:
 *   P4.1  dos clientes HTTP para los mismos endpoints del proxy;
 *   P4.6  la misma resolucion de API key copiada en cliente y servidor;
 *   P4.7  la URL de Pollinations construida a mano fuera del constructor.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it, expect } from 'vitest';
import { walkFiles } from './_helpers'
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

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

/** Dueno UNICO de las rutas del proxy local de imagen/video. */
export const VISUAL_PROXY_OWNER = 'src/voice/lib/visualConfig.js'
/** Quien las PRODUCE (registra el middleware); queda fuera de alcance a proposito. */
export const VISUAL_PROXY_PRODUCER = 'src/server/geminiProxy.ts'
const VISUAL_ROUTE_RE = /['"]\/api\/(?:workspace-image|openrouter-image|fal-video)['"]/g

/**
 * Rutas del proxy visual escritas a mano en un consumidor. Se exceptuan el dueno
 * (que las declara) y el servidor (que las registra); la capa de consumo debe
 * importarlas. Nace del hallazgo medido: '/api/workspace-image' estaba escrito en
 * src/services/gemini.ts y en src/voice/lib/imageGeneration.js a la vez.
 */
export function visualRouteLiterals(src: string, fileName: string): string[] {
  if (fileName === VISUAL_PROXY_OWNER || fileName === VISUAL_PROXY_PRODUCER) return []
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  return code.match(VISUAL_ROUTE_RE) ?? []
}
describe('P4.1/P4.6/P4.7 transporte - un origen por dato', () => {
  it('la resolucion de API key existe solo en su dueno', () => {
    const offenders = walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/).flatMap((f) => apiKeyResolutionCopies(readFileSync(f, 'utf8'), rel(f)));
    expect(offenders, 'resolucion de API key copiada:\n  ' + offenders.join('\n  ')).toEqual([]);
    expect(read(API_KEY_OWNER)).toContain('export function resolveApiKey(');
  });
  it('la URL de Pollinations se construye solo en el constructor canonico', () => {
    const offenders = walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/).flatMap((f) => pollinationsUrlBuilders(readFileSync(f, 'utf8'), rel(f)));
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
  it('las rutas del proxy visual se declaran solo en su dueno', () => {
    const offenders = walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/).flatMap((f) => {
      const file = rel(f)
      return visualRouteLiterals(readFileSync(f, 'utf8'), file).map((r) => file + ': ' + r)
    })
    expect(
      offenders,
      'Ruta del proxy visual escrita a mano (importala de VISUAL_CONFIG.image.proxies):\n  ' + offenders.join('\n  '),
    ).toEqual([])
    const owner = read(VISUAL_PROXY_OWNER)
    expect(owner).toContain("workspaceImage: '/api/workspace-image'")
    expect(owner).toContain("falVideo: '/api/fal-video'")
  });
  it('el transporte con deadline es unico: estos consumidores no usan fetch crudo', () => {
    // Hallazgo medido: useWorkspaceSearch no tenia deadline de cliente y musicSearch
    // llevaba su propio AbortController. Los dos delegan ahora en fetchTextEngine.
    // fbxParse se sumo despues (C78): su camino main-thread estaba sin tope aunque el
    // de worker ya lo tuviera.
    for (const f of [
      'src/hooks/useWorkspaceSearch.ts',
      'src/services/musicSearch.ts',
      'src/avatar/lib/fbxParse.ts',
    ]) {
      expect(rawFetchCalls(read(f)), 'fetch crudo en ' + f).toBe(0)
      expect(read(f), f + ' debe usar el transporte compartido').toContain('fetchTextEngine')
    }
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
  it('marca la ruta visual copiada, no al dueno, al servidor ni un comentario', () => {
    // Las cadenas EXACTAS que estaban en el arbol antes de C77.
    expect(visualRouteLiterals("        '/api/workspace-image',", 'src/services/gemini.ts')).toHaveLength(1)
    expect(
      visualRouteLiterals("      '/api/fal-video',", 'src/voice/lib/imageGeneration.js'),
    ).toHaveLength(1)
    // El dueno declara, el servidor registra: ninguno de los dos es infraccion.
    expect(
      visualRouteLiterals("    workspaceImage: '/api/workspace-image',", VISUAL_PROXY_OWNER),
    ).toEqual([])
    expect(
      visualRouteLiterals("server.middlewares.use('/api/workspace-image', handler)", VISUAL_PROXY_PRODUCER),
    ).toEqual([])
    // Una mencion en un comentario no es la ruta escrita a mano.
    expect(visualRouteLiterals("// POST /api/fal-video -> { videoUrl }", 'src/voice/lib/x.js')).toEqual([])
    expect(visualRouteLiterals("/* antes: '/api/workspace-image' */", 'src/services/y.ts')).toEqual([])
    // El consumidor que importa la ruta pasa.
    expect(
      visualRouteLiterals('VISUAL_CONFIG.image.proxies.workspaceImage', 'src/services/gemini.ts'),
    ).toEqual([])
  });
});