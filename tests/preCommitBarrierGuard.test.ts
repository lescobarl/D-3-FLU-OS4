// ============================================================
// P0.8 - La barrera pre-commit documentada es la que existe.
// ============================================================
/**
 * AGENTS.md atribuia a pre-commit `npm run gate`, pero el gate de contrato
 * requiere un contrato activo con su base: NO puede correr por commit. Ademas el
 * hook que si existia vivia en .git/hooks/pre-commit, que no se versiona: no
 * llegaba a un clon nuevo ni a CI. La documentacion prometia una barrera que no
 * existia en el repo.
 *
 * Este guard comprueba las tres piezas de la barrera REAL:
 *   1. el hook esta versionado (git ls-files) y ejecuta lint + typecheck,
 *   2. no ejecuta lo que es caro (suite completa / gate de contrato),
 *   3. npm lo activa (script `prepare` -> core.hooksPath=.githooks),
 *   4. AGENTS.md declara exactamente esa barrera (sin la promesa falsa del gate).
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const HOOK = '.githooks/pre-commit';
const INSTALLER = 'scripts/install-hooks.mjs';
const LIGHT = ['npm run lint', 'npm run typecheck'];
const NEVER = ['npm run test:full', 'npm run gate'];

/** Comandos `npm run x` que EJECUTA un hook/shell (ignora comentarios). */
export function npmCommands(shell: string): string[] {
  const out: string[] = [];
  for (const line of shell.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('#')) continue;
    for (const m of line.matchAll(/npm\s+run\s+([A-Za-z:_-]+)/g)) out.push('npm run ' + m[1]);
  }
  return [...new Set(out)];
}

function tracked(path: string): boolean {
  try {
    const out = execFileSync('git', ['ls-files', '--', path], { encoding: 'utf8' });
    return out.split('\n').map((l) => l.trim()).includes(path);
  } catch {
    return false;
  }
}

describe('P0.8 preCommitBarrier - la barrera documentada es la real', () => {
  it('el hook esta versionado y es ligero (lint + typecheck)', () => {
    const hook = readFileSync(HOOK, 'utf8');
    expect(tracked(HOOK), HOOK + ' debe estar versionado (no en .git/hooks)').toBe(true);
    const cmds = npmCommands(hook);
    for (const c of LIGHT) expect(cmds, 'falta ' + c).toContain(c);
    for (const c of NEVER) expect(cmds, 'no debe correr ' + c).not.toContain(c);
  });

  it('npm lo activa via prepare -> core.hooksPath', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts.prepare).toContain('install-hooks');
    const installer = readFileSync(INSTALLER, 'utf8');
    expect(installer).toContain('core.hooksPath');
    expect(installer).toContain('.githooks');
  });

  it('AGENTS.md no promete el gate de contrato como pre-commit', () => {
    const L = readFileSync('AGENTS.md', 'utf8').split(/\r?\n/);
    const i = L.findIndex((l) => l.startsWith('- Pre-commit'));
    expect(i, 'AGENTS.md debe documentar la barrera pre-commit').toBeGreaterThan(-1);
    const bullet = L[i];
    expect(npmCommands(bullet)).toContain('npm run lint');
    expect(npmCommands(bullet)).toContain('npm run typecheck');
    expect(npmCommands(bullet)).not.toContain('npm run gate');
    expect(L[i + 1] + L[i + 2]).toContain('.githooks/pre-commit');
  });
});

describe('P0.8 - el detector no es decorativo (7.7.d)', () => {
  it('detecta comandos npm run y no confunde texto suelto', () => {
    expect(npmCommands('npm run lint || exit 1')).toEqual(['npm run lint']);
    expect(npmCommands('npm run gate')).toEqual(['npm run gate']);
    expect(npmCommands('echo "npm run test:full"')).toEqual(['npm run test:full']);
    expect(npmCommands('# nada')).toEqual([]);
    expect(npmCommands('# npm run gate\nnpm run lint')).toEqual(['npm run lint']);
  });
});
