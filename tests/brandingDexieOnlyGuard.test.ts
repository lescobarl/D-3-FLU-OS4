// ============================================================
// P1.5 - El branding vive SOLO en Dexie (doctrina C31).
// ============================================================
/**
 * El branding (mode/activeSeason/birthday) se guarda en Dexie (fluDb.brandingConfig), pero
 * backupSystem lo leia y restauraba en claves localStorage (flu-branding-mode, -active-season,
 * -birthday) que la aplicacion NI escribe ni lee. Resultado: el backup guardaba siempre los
 * valores por defecto y el restore escribia donde nadie lee; el branding nunca se respaldo.
 *
 * C31 ya bendijo este patron para voiceProfiles: si el dato vive SOLO en Dexie, que ya es
 * persistente, el backup no lo duplica. Este guard aplica esa doctrina al branding.
 *
 * AMBITO: todo src/, sin exclusiones (AGENTS.md 7.7.d).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/** Claves LS de branding: constantes (con limite de palabra) y literales. */
export const BRANDING_LS =
  /\bBRANDING_MODE\b|\bBRANDING_ACTIVE_SEASON\b|\bBRANDING_BIRTHDAY\b|flu-branding-mode|flu-branding-active-season|flu-branding-birthday/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p);
  }
  return acc;
}

/** Sitios (archivo:linea) que tocan una clave LS de branding. */
export function brandingLsSites(src: string, fileName: string): string[] {
  const out: string[] = [];
  src.split(/\r?\n/).forEach((line, i) => {
    if (BRANDING_LS.test(line)) out.push(fileName + ':' + (i + 1));
  });
  return out;
}

describe('P1.5 brandingDexieOnly - el branding no duplica en localStorage', () => {
  it('ningun modulo declara ni usa claves LS de branding', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      offenders.push(...brandingLsSites(readFileSync(f, 'utf8'), relative(ROOT, f).replace(/\\/g, '/')));
    }
    expect(
      offenders,
      'claves LS de branding (N=' + offenders.length + '):' + String.fromCharCode(10) + '  ' + offenders.join(String.fromCharCode(10) + '  '),
    ).toEqual([]);
  });

  it('el branding se persiste en la tabla Dexie brandingConfig', () => {
    const hook = readFileSync(join(SRC, 'core/branding/useSeasonalBranding.ts'), 'utf8');
    expect(hook).toContain('fluDb.brandingConfig');
    expect(hook).not.toContain('localStorage');
  });

  it('el backup no extrae ni restaura branding por localStorage', () => {
    const backup = readFileSync(join(SRC, 'core/autonomy/backupSystem.ts'), 'utf8');
    expect(brandingLsSites(backup, 'backupSystem.ts')).toEqual([]);
  });
});

describe('P1.5 - el detector no es decorativo (7.7.d)', () => {
  it('detecta constantes y literales, y no confunde lo legitimo', () => {
    expect(brandingLsSites('localStorage.setItem(STORAGE_KEYS.BRANDING_MODE, x)', 'a.ts')).toEqual(['a.ts:1']);
    expect(brandingLsSites("localStorage.getItem('flu-branding-birthday')", 'a.ts')).toEqual(['a.ts:1']);
    expect(brandingLsSites('BRANDING_MODES as readonly string[]', 'a.ts')).toEqual([]);
    expect(brandingLsSites("const S = '.flu-branding-scope'", 'a.ts')).toEqual([]);
  });
});
