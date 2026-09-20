/**
 * C24 — modeloDefault: un solo default de modelo de texto.
 * Nace ROJO (6 archivos mencionan gemini-2.5-flash-lite).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const RE = /gemini-2\.5-flash-lite/
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

describe('C24 modeloDefault — un solo default de modelo', () => {
  it('un único módulo define el default del modelo de texto', () => {
    const files = walk(SRC)
      .filter((f) => RE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
      .sort()
    expect(
      files,
      `Definiciones del default de modelo (N=${files.length}); debe quedar 1:\n  ${files.join('\n  ')}`,
    ).toHaveLength(1)
  })
})
