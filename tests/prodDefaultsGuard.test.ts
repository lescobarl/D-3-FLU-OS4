/**
 * P6.2 - los defaults de diagnostico no viajan a produccion.
 *
 * `FLU_CONFIG.debug.enabled` y `debug.relayToServer` estaban fijados a true en el
 * codigo: la build de produccion salia con la consola de diagnostico encendida y
 * reenviando logs del cliente al servidor. Deben depender de IS_DEV, no de una
 * constante literal; el usuario puede seguir encendiendolos en runtime.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
const ROOT = join(__dirname, '..');
export const CONFIG_OWNER = 'src/voice/lib/fluConfig.js';
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}
/** Recorta el bloque `debug: { ... }` por profundidad de llaves. */
export function debugBlock(src: string): string {
  const at = src.indexOf('debug: {');
  if (at < 0) return '';
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return '';
}
/** Claves del bloque debug que quedan encendidas de forma literal. */
export function prodDefaultsOffenders(src: string, fileName: string): string[] {
  if (fileName !== CONFIG_OWNER) return [];
  const block = debugBlock(src);
  if (!block) return [fileName + ' (sin bloque debug)'];
  const out: string[] = [];
  if (/enabled:\s*true/.test(block)) out.push(fileName + ': debug.enabled literal true');
  if (/relayToServer:\s*true/.test(block)) out.push(fileName + ': debug.relayToServer literal true');
  if (!/enabled:\s*IS_DEV/.test(block)) out.push(fileName + ': debug.enabled no depende de IS_DEV');
  if (!/relayToServer:\s*IS_DEV/.test(block)) out.push(fileName + ': debug.relayToServer no depende de IS_DEV');
  return out;
}
describe('P6.2 - defaults de produccion', () => {
  it('debug.enabled y relayToServer dependen de IS_DEV', () => {
    const offenders = prodDefaultsOffenders(read(CONFIG_OWNER), CONFIG_OWNER);
    expect(offenders, 'defaults de diagnostico encendidos en produccion:\n  ' + offenders.join('\n  ')).toEqual([]);
  });
  it('el default de la persistencia no reintroduce el encendido', () => {
    const src = read('src/hooks/useConfigPersistence.ts');
    expect(src).toContain('FLU_CONFIG.debug.enabled ?? false');
  });
});
describe('P6.2 - el detector no es decorativo', () => {
  it('marca los literales true y los distingue de IS_DEV', () => {
    const malo = 'FLU_CONFIG = { debug: { enabled: true, relayToServer: true, x: 1 } }';
    expect(prodDefaultsOffenders(malo, CONFIG_OWNER).length).toBeGreaterThanOrEqual(2);
    const bueno = 'FLU_CONFIG = { debug: { enabled: IS_DEV, relayToServer: IS_DEV, x: 1 } }';
    expect(prodDefaultsOffenders(bueno, CONFIG_OWNER)).toEqual([]);
    expect(prodDefaultsOffenders(malo, 'src/otro.ts')).toEqual([]);
  });
  it('recorta solo el bloque debug, no las claves homonimas de otros bloques', () => {
    const src = 'FLU_CONFIG = { games: { enabled: true }, debug: { enabled: IS_DEV, relayToServer: IS_DEV } }';
    expect(prodDefaultsOffenders(src, CONFIG_OWNER)).toEqual([]);
    expect(debugBlock(src)).toContain('relayToServer');
    expect(debugBlock(src)).not.toContain('games');
  });
});