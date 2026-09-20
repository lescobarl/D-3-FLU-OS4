/**
 * C30 — indexedDbSingle: una sola base IndexedDB propia (flu-os3).
 * Nace ROJO (2 módulos abren su propia DB: longTermMemory, fluStorage).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const EXCLUDE = 'src/core/autonomy/healthMonitor.ts'
const RE = /indexedDB\.open\s*\(/
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

describe('C30 indexedDbSingle — una sola base IndexedDB propia', () => {
  it('ningún módulo fuera de la capa Dexie abre su propia DB', () => {
    const files = walk(SRC)
      .filter((f) => {
        const r = relative(ROOT, f).replace(/\\/g, '/')
        return r !== EXCLUDE && RE.test(readFileSync(f, 'utf8'))
      })
      .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
      .sort()
    expect(
      files,
      `Bases IndexedDB propias (N=${files.length}); debe quedar solo fluDatabase:\n  ${files.join('\n  ')}`,
    ).toEqual([])
  })
})
