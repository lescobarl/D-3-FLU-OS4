/**
 * disabledTestsGuard — V7 solo cuenta skips INCONDICIONALES.
 *
 * El detector anterior (`/describe\.skip|it\.skip|test\.skip|\.todo\(/`) marcaba
 * `describe.skipIf(cond)` y `test.skip(cond, motivo)`, que son gates de entorno:
 * daba 4 falsos positivos (grabación local, SESSION_PATH, replay 45aeb8e2).
 * El dueño es `scripts/audit-detectors.mjs::findDisabledTests`.
 *
 * Trinquete: 0 skips/todos incondicionales. Si aparece uno, este test y V7 fallan.
 * El detector se prueba por los dos lados: marca el skip real y no marca el gate.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findDisabledTests } from '../scripts/audit-detectors.mjs';
import { walkFiles } from '../scripts/fsScan.mjs';

const ROOT = process.cwd();

function testSources(): Array<{ file: string; source: string }> {
  return walkFiles(join(ROOT, 'tests'), (entry: string) => /\.(ts|tsx|js|jsx|mjs)$/.test(entry)).map(
    (file) => ({
      file: relative(ROOT, file).replace(/\\/g, '/'),
      source: readFileSync(file, 'utf8'),
    }),
  );
}

describe('V7 — tests deshabilitados incondicionales', () => {
  it('no hay ningún .skip/.todo incondicional en tests/', () => {
    const hits = findDisabledTests(testSources());
    expect(
      hits,
      'Tests deshabilitados de verdad (re-habilitar o borrar):\n  ' + hits.join('\n  '),
    ).toEqual([]);
  });

  it('el detector no es decorativo: marca el incondicional y respeta el gate', () => {
    // Se arma en runtime para que el propio guard no contenga el patron literal.
    const SKIP = 'skip';
    const TODO = 'todo';
    const unconditional = [
      { file: 'tests/a.test.ts', source: `it.${SKIP}('x', () => {})` },
      { file: 'tests/b.test.ts', source: `describe.${SKIP}('x', () => {})` },
      { file: 'tests/c.test.ts', source: `it.${TODO}('x')` },
      { file: 'tests/d.test.ts', source: `test.${SKIP}()` },
    ];
    expect(findDisabledTests(unconditional)).toHaveLength(4);

    const conditional = [
      { file: 'tests/e.test.ts', source: "describe.skipIf(!HAY)('x', () => {})" },
      { file: 'tests/f.test.ts', source: "it.skipIf(cond)('x', () => {})" },
      { file: 'tests/g.test.ts', source: "test.skip(!SESSION_PATH, 'reason')" },
      { file: 'tests/h.test.ts', source: "test.skip(!hayGrabacion() || !existsSync(p), 'reason')" },
    ];
    expect(findDisabledTests(conditional)).toEqual([]);
  });
});
