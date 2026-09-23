/**
 * P4.8 y P5.8 - guard de orden unico y de umbral unico.
 *
 * P4.8: los tres pasos de la cascada de imagen (generacion, reintento y fallback)
 *       repetian el mismo orden de aplicacion del resultado. Si se toca uno y no
 *       los otros, el estado de la UI diverge entre caminos.
 * P5.8: los datos de muestra por proveedor del motor de decision llevaban numeros
 *       incrustados junto a otros que ya venian del catalogo.
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
/** Dueno unico del orden de aplicacion del resultado de imagen. */
export const CASCADE_OWNER = 'src/hooks/useWorkspaceImage.ts';
/** Dueno unico de los datos de muestra del motor de decision. */
export const METRICS_OWNER = 'src/core/config/sharedConfig.ts';
/** Aplicaciones del resultado de imagen copiadas fuera del helper. */
export function cascadeResultOrderCopies(src: string, fileName: string): string[] {
  if (fileName !== CASCADE_OWNER) return [];
  const n = (src.match(/setImageUrl\(result\.image_url\)/g) || []).length;
  return n > 1 ? [fileName + ' (' + n + ' copias)' ] : [];
}
/**
 * Metricas de proveedor incrustadas fuera del catalogo.
 * El 0 se admite: es el valor neutro de "todavia sin datos" (healthMonitor
 * devuelve avgResponseTime: 0 cuando no hay historial), no un umbral a tunar.
 */
export function inlineProviderMetrics(src: string, fileName: string): string[] {
  if (fileName === METRICS_OWNER) return [];
  const hits = src.match(/(avgResponseTime|co2Emissions|perceivedLatency|requestCount):\s*[0-9]*[1-9][0-9]*\.?[0-9]*/g) || [];
  return hits.length > 0 ? [fileName + ' (' + hits.length + ')' ] : [];
}
describe('P4.8/P5.8 - un orden y un umbral', () => {
  it('la cascada de imagen aplica el resultado en un solo sitio', () => {
    const offenders = walk(SRC).flatMap((f) => cascadeResultOrderCopies(readFileSync(f, 'utf8'), rel(f)));
    expect(offenders, 'orden de la cascada copiado:\n  ' + offenders.join('\n  ')).toEqual([]);
    const owner = read(CASCADE_OWNER);
    expect(owner).toContain('const applyImageResult');
    expect((owner.match(/applyImageResult\(result, requestId\)/g) || []).length).toBeGreaterThanOrEqual(3);
  });
  it('el motor de decision no lleva metricas de proveedor incrustadas', () => {
    const offenders = walk(SRC).flatMap((f) => inlineProviderMetrics(readFileSync(f, 'utf8'), rel(f)));
    expect(offenders, 'metricas incrustadas:\n  ' + offenders.join('\n  ')).toEqual([]);
  });
});
describe('P4.8/P5.8 - el detector no es decorativo', () => {
  it('marca el orden duplicado y no marca al dueno', () => {
    const dos = 'x; setImageUrl(result.image_url); y; setImageUrl(result.image_url);';
    expect(cascadeResultOrderCopies(dos, CASCADE_OWNER)).toHaveLength(1);
    expect(cascadeResultOrderCopies('setImageUrl(result.image_url);', CASCADE_OWNER)).toEqual([]);
    expect(cascadeResultOrderCopies(dos, 'src/services/otro.ts')).toEqual([]);
  });
  it('marca una metrica incrustada y no marca al catalogo', () => {
    const motor = 'src/core/autonomy/decisionEngine.ts';
    expect(inlineProviderMetrics('co2Emissions: 1.0,', motor)).toHaveLength(1);
    expect(inlineProviderMetrics('requestCount: 150,', motor)).toHaveLength(1);
    expect(inlineProviderMetrics('avgResponseTime: 12000,', motor)).toHaveLength(1);
    expect(inlineProviderMetrics('co2Emissions: 0,', motor), 'el 0 es ausencia de datos, no un umbral').toEqual([]);
    expect(inlineProviderMetrics('co2Emissions: 1.0,', METRICS_OWNER)).toEqual([]);
  });
});