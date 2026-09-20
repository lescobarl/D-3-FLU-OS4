/**
 * C2 — searchAllowlistFuenteUnica: la allowlist de búsqueda vive en FLU_CONFIG.
 *
 * `src/voice/lib/fluConfig.js` es la fuente de `voiceCommands.search.allowlist`.
 * App y useNavigationCommands re-declaran el literal `['wikipedia.org','educ.ar']`,
 * de modo que cambiar la config no cambia el comportamiento real.
 *
 * Nace ROJO (2 literales fuera de config) y pasa cuando ambos leen FLU_CONFIG.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const CONFIG = 'src/voice/lib/fluConfig.js'
const RE = /\[\s*'wikipedia\.org'\s*,\s*'educ\.ar'\s*\]/

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) acc.push(p)
  }
  return acc
}

describe('C2 searchAllowlistFuenteUnica — allowlist solo desde config', () => {
  it('no hay literales de allowlist fuera de fluConfig.js', () => {
    const offenders: string[] = []
    for (const f of walk(SRC)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      if (r === CONFIG) continue
      readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (RE.test(line)) offenders.push(`${r}:${i + 1}:${line.trim().slice(0, 110)}`)
        })
    }
    expect(
      offenders,
      `Allowlist duplicada fuera de config (N=${offenders.length}):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
