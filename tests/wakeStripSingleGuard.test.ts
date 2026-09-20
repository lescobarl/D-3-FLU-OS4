/**
 * C28 — wakeStripSingle: una sola implementación de strip de wake word (§9.2).
 * Nace ROJO (5 funciones exportadas).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const RE =
  /export function (?:stripWakeWord|stripWakeWordAnywhere|removeWakeWord|splitTranscriptAtWakeWord|stripWakeWordForDisplay)\s*\(/
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

describe('C28 wakeStripSingle — una sola implementación de strip', () => {
  it('una única implementación de strip de wake word', () => {
    const impls: string[] = []
    for (const f of walk(SRC)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (RE.test(line)) impls.push(`${r}:${i + 1}:${line.trim().slice(0, 110)}`)
        })
    }
    expect(
      impls,
      `Implementaciones de strip (N=${impls.length}); debe quedar 1:\n  ${impls.join('\n  ')}`,
    ).toHaveLength(1)
  })
})
