/**
 * P6.2 - los defaults de diagnostico no viajan a produccion.
 *
 * `FLU_CONFIG.debug.enabled`, `debug.relayToServer`, `trace.enabled` y
 * `trace.agentSink` estaban fijados a true en el codigo: la build de produccion
 * salia con la consola de diagnostico encendida, con POST periodico de traza y
 * reenviando logs del cliente al servidor. Deben depender de IS_DEV, no de una
 * constante literal; el usuario puede seguir encendiendolos en runtime.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
const ROOT = join(__dirname, '..');
export const CONFIG_OWNER = 'src/voice/lib/fluConfig.js';
/** Claves de diagnostico que deben estar gateadas por IS_DEV. */
export const GATED_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['debug', 'enabled'],
  ['debug', 'relayToServer'],
  ['trace', 'enabled'],
  ['trace', 'agentSink'],
];
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}
/** Recorta un bloque `nombre: { ... }` por profundidad de llaves. */
export function configBlock(src: string, name: string): string {
  const at = src.indexOf(name + ': {');
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
/** Claves de diagnostico encendidas de forma literal fuera de IS_DEV. */
export function prodDefaultsOffenders(src: string, fileName: string): string[] {
  if (fileName !== CONFIG_OWNER) return [];
  const out: string[] = [];
  for (const [blockName, key] of GATED_KEYS) {
    const body = configBlock(src, blockName);
    if (!body) {
      out.push(fileName + ': falta el bloque ' + blockName);
      continue;
    }
    if (new RegExp(key + ':\\s*true').test(body)) {
      out.push(fileName + ': ' + blockName + '.' + key + ' literal true');
    }
    if (!new RegExp(key + ':\\s*IS_DEV').test(body)) {
      out.push(fileName + ': ' + blockName + '.' + key + ' no depende de IS_DEV');
    }
  }
  return out;
}
/** Fuente con los cuatro bloques correctos; base de los casos de prueba. */
const OK = [
  'X = {',
  '  games: { enabled: true },',
  '  debug: { enabled: IS_DEV, relayToServer: IS_DEV, micConsolePanel: false },',
  '  trace: { enabled: IS_DEV, agentSink: IS_DEV, ringSize: 800 },',
  '}',
].join('\n');
describe('P6.2 - defaults de produccion', () => {
  it('los defaults de diagnostico dependen de IS_DEV', () => {
    const offenders = prodDefaultsOffenders(read(CONFIG_OWNER), CONFIG_OWNER);
    expect(offenders, 'defaults de diagnostico encendidos en produccion:\n  ' + offenders.join('\n  ')).toEqual([]);
  });
  it('el default de la persistencia no reintroduce el encendido', () => {
    const src = read('src/hooks/useConfigPersistence.ts');
    expect(src).toContain('FLU_CONFIG.debug.enabled ?? false');
  });
  it('IS_DEV se deriva de import.meta.env.DEV', () => {
    expect(read(CONFIG_OWNER)).toContain('const IS_DEV = import.meta.env.DEV');
  });
});
describe('P6.2 - el detector no es decorativo', () => {
  it('marca los literales true y distingue debug de trace', () => {
    expect(prodDefaultsOffenders(OK, CONFIG_OWNER)).toEqual([]);
    const debugMalo = OK.replace('debug: { enabled: IS_DEV, relayToServer: IS_DEV', 'debug: { enabled: true, relayToServer: true');
    expect(prodDefaultsOffenders(debugMalo, CONFIG_OWNER).length).toBeGreaterThanOrEqual(2);
    const traceMalo = OK.replace('trace: { enabled: IS_DEV, agentSink: IS_DEV', 'trace: { enabled: true, agentSink: true');
    const t = prodDefaultsOffenders(traceMalo, CONFIG_OWNER);
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect(t.join(' ')).toContain('trace');
  });
  it('marca un bloque ausente en vez de darlo por bueno', () => {
    const sinTrace = OK.split('\n').filter((l) => !l.includes('trace:')).join('\n');
    expect(prodDefaultsOffenders(sinTrace, CONFIG_OWNER).join(' ')).toContain('falta el bloque trace');
  });
  it('no se pronuncia sobre otros archivos', () => {
    expect(prodDefaultsOffenders('debug: { enabled: true }', 'src/otro.ts')).toEqual([]);
  });
  it('recorta solo el bloque pedido, no las claves homonimas de otros bloques', () => {
    expect(configBlock(OK, 'debug')).toContain('relayToServer');
    expect(configBlock(OK, 'debug')).not.toContain('games');
    expect(configBlock(OK, 'trace')).not.toContain('relayToServer');
    expect(configBlock(OK, 'inexistente')).toBe('');
  });
});