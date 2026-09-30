/**
 * C4 — aiProviderStorageKeyUnica: la clave del proveedor de IA sale de STORAGE_KEYS.
 *
 * `src/core/config/appConfig.ts` define `STORAGE_KEYS.AI_PROVIDER = 'flu-ai-provider'`.
 * Aun así, `aiServiceFactory.ts` y `decisionEngine.ts` re-declaran el literal,
 * de modo que renombrar la clave en config no cambia la realidad (§2.8).
 *
 * Nace ROJO (2+ literales fuera de config) y pasa cuando todos importan STORAGE_KEYS.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const CONFIG = 'src/core/config/appConfig.ts'
const RE = /['"]flu-ai-provider['"]/

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) acc.push(p)
  }
  return acc
}

describe('C4 aiProviderStorageKeyUnica — clave de proveedor solo desde STORAGE_KEYS', () => {
  it('no hay literales "flu-ai-provider" fuera de appConfig.ts', () => {
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
      `Literales de la clave de proveedor (N=${offenders.length}); usa STORAGE_KEYS.AI_PROVIDER:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
