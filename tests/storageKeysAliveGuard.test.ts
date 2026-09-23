// ============================================================
// STORAGE_KEYS no declara claves muertas.
// ============================================================
/**
 * STORAGE_KEYS es el mapa de claves localStorage del proyecto. Una entrada que nadie
 * referencia es codigo muerto que miente: parece una clave viva y ya no la lee nadie.
 *
 * Se encontraron 11: las 6 del viejo Configurador FLU (FLU_PROFILE, FLU_IMAGE_CONFIG,
 * FLU_VOICE_CONFIG, FLU_ADVANCED_CONFIG, FLU_PERSONALITY_TRAITS/TONE), sustituidas por el
 * integrationStore (zustand persist); GEMINI_MODEL/GEMINI_API_URL y POLLINATIONS_URL/MODEL,
 * sustituidas por la config de proveedor; y NOTIFICATION_MUTED, sustituida por
 * NOTIFICATION_CHANNEL/NOTIFICATION_PERMISSION. Misma clase que P1.5: almacen declarado
 * que la aplicacion ya no usa.
 *
 * AMBITO: src/ + tests/. Toda clave nueva debe nacer referenciada.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const CFG = join(ROOT, 'src/core/config/appConfig.ts');
const PREFIX = 'flu-';

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (['node_modules', '.git', 'dist'].includes(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e)) acc.push(p);
  }
  return acc;
}

/** Claves declaradas en el objeto STORAGE_KEYS (nombre -> valor). */
export function declaredStorageKeys(src: string): Record<string, string> {
  const body = src.split('export const STORAGE_KEYS')[1]?.split('} as const')[0] ?? '';
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:\s*'([^']+)'/gm)) out[m[1]] = m[2];
  return out;
}

/** Nombres de STORAGE_KEYS.* efectivamente referenciados bajo las raices dadas. */
export function referencedStorageKeys(roots: string[]): Set<string> {
  const found = new Set<string>();
  for (const r of roots) {
    for (const f of walk(join(ROOT, r))) {
      const t = readFileSync(f, 'utf8');
      for (const m of t.matchAll(/STORAGE_KEYS\.([A-Z][A-Z0-9_]*)/g)) found.add(m[1]);
    }
  }
  return found;
}

/** Entradas declaradas que nadie referencia (codigo muerto). */
export function deadStorageKeys(declared: Record<string, string>, used: Set<string>): string[] {
  return Object.keys(declared).filter((k) => !used.has(k));
}

describe('STORAGE_KEYS sin claves muertas', () => {
  const declared = declaredStorageKeys(readFileSync(CFG, 'utf8'));
  const used = referencedStorageKeys(['src', 'tests']);

  it('ninguna clave declarada es codigo muerto', () => {
    const dead = deadStorageKeys(declared, used).map((k) => k + ' -> ' + declared[k]);
    expect(dead, 'claves muertas (N=' + dead.length + '): ' + dead.join(' | ')).toEqual([]);
  });

  it('el mapa se parsea de verdad (guarda contra un guard vacio)', () => {
    expect(Object.keys(declared).length).toBeGreaterThan(50);
    expect(used.size).toBeGreaterThan(10);
  });

  it('todas las claves viven en el espacio de nombres flu-', () => {
    const bad = Object.entries(declared).filter(([, v]) => !v.startsWith(PREFIX)).map(([k]) => k);
    expect(bad, 'fuera del namespace: ' + bad.join(', ')).toEqual([]);
  });

  it('el mapa no vuelve a declarar las claves ya retiradas', () => {
    for (const k of ['FLU_PROFILE', 'FLU_VOICE_CONFIG', 'FLU_ADVANCED_CONFIG', 'GEMINI_MODEL', 'POLLINATIONS_URL', 'NOTIFICATION_MUTED']) {
      expect(declared[k], k + ' no debe volver').toBeUndefined();
    }
  });
});

describe('STORAGE_KEYS - el detector no es decorativo (7.7.d)', () => {
  it('detecta muertas y respeta las vivas', () => {
    expect(deadStorageKeys({ A: 'flu-a', B: 'flu-b' }, new Set(['A']))).toEqual(['B']);
    expect(deadStorageKeys({ A: 'flu-a' }, new Set(['A']))).toEqual([]);
  });
  it('parsea solo el objeto STORAGE_KEYS y no otros mapas del archivo', () => {
    const src = ['export const STORAGE_KEYS = {', "  X: 'flu-x',", '} as const;', "export const O = { ICON: 'x' };"].join(String.fromCharCode(10));
    expect(declaredStorageKeys(src)).toEqual({ X: 'flu-x' });
  });
});
