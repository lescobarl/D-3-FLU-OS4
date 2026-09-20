/**
 * C9 — sesionBackendUnico: un solo backend de sesión (Dexie o localStorage).
 * Nace ROJO (2 backends: useSessionPersistence localStorage y fluStorage Dexie).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const RE = /flu-session-state|fluDb\.sessionState/
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

describe('C9 sesionBackendUnico — un solo backend de sesión', () => {
  it('un único archivo implementa la persistencia de sesión', () => {
    const backends = walk(SRC)
      .filter((f) => RE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
      .sort()
    expect(
      backends,
      `Backends de sesión (N=${backends.length}); debe quedar 1:\n  ${backends.join('\n  ')}`,
    ).toHaveLength(1)
  })
})
