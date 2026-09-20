/**
 * C27 — queryDerivationSingle: una sola derivación de la query (§9.6).
 * Nace ROJO (4 sitios: audioMath interno + 3 en el hook).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const RE = /deriveQueryFromRow\s*\(/
const strip = (line: string) => {
  const t = line.trim()
  if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return ''
  return line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '')
}
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

describe('C27 queryDerivationSingle — una sola derivación de query', () => {
  it('un único sitio deriva la query a la IA', () => {
    const calls: string[] = []
    for (const f of walk(SRC)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (RE.test(strip(line)) && !/export function/.test(line)) {
            calls.push(`${r}:${i + 1}:${line.trim().slice(0, 110)}`)
          }
        })
    }
    expect(
      calls,
      `Derivaciones de query (N=${calls.length}); debe quedar 1:\n  ${calls.join('\n  ')}`,
    ).toHaveLength(1)
  })
})
