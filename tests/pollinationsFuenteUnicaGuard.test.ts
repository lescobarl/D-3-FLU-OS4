/**
 * C7 — pollinationsFuenteUnica: una sola definición de la base Pollinations.
 * Nace ROJO (2 fuentes: sharedConfig.ts y visualConfig.js).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const UI_PLACEHOLDER = 'src/components/FluSettingsPanel.tsx'
const RE = /image\.pollinations\.ai/
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

describe('C7 pollinationsFuenteUnica — base Pollinations única', () => {
  it('solo un módulo define la base de Pollinations (sin contar el placeholder de UI)', () => {
    const sources = walk(SRC)
      .filter((f) => {
        const r = relative(ROOT, f).replace(/\\/g, '/')
        return r !== UI_PLACEHOLDER && RE.test(readFileSync(f, 'utf8'))
      })
      .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
      .sort()
    expect(
      sources,
      `Fuentes de la base Pollinations (N=${sources.length}); debe quedar 1:\n  ${sources.join('\n  ')}`,
    ).toHaveLength(1)
  })
})
