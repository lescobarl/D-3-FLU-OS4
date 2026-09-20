/**
 * C15 — uuidV4Insercion: todo insert usa UUIDv4 (§3.6).
 * Nace ROJO (fallback voice-${Date.now()} en fluStorage.js).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const RE = /voice-\$\{Date\.now\(\)\}/
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

describe('C15 uuidV4Insercion — IDs UUIDv4 al insertar', () => {
  it('no hay IDs derivados de Date.now()', () => {
    const offenders: string[] = []
    for (const f of walk(SRC)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (RE.test(line)) offenders.push(`${r}:${i + 1}:${line.trim().slice(0, 110)}`)
        })
    }
    expect(
      offenders,
      `IDs no-UUIDv4 (N=${offenders.length}); usa uuidv4:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
