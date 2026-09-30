/**
 * C5 — textApiKeyResolverUnico: la API key de texto sale de resolveTextApiKey().
 *
 * `src/core/config/appConfig.ts` centraliza la resolución (localStorage >
 * env). `searchConfigOverrides.ts` lee `import.meta.env.VITE_OPENROUTER_API_KEY`
 * por su cuenta, saltándose el resolver: dos criterios para el mismo secreto.
 *
 * Nace ROJO (1 lectura directa fuera de config) y pasa cuando usa el resolver.
 * `src/dev/**` queda fuera de alcance (laboratorio de desarrollo).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const ALLOWED = new Set(['src/core/config/appConfig.ts', 'src/core/config/sharedConfig.ts'])
const RE = /import\.meta\.env\.VITE_OPENROUTER_API_KEY/

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) acc.push(p)
  }
  return acc
}

describe('C5 textApiKeyResolverUnico — la key de texto sale del resolver central', () => {
  it('no hay lecturas directas de import.meta.env.VITE_OPENROUTER_API_KEY fuera de config/dev', () => {
    const offenders: string[] = []
    for (const f of walk(SRC)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      if (ALLOWED.has(r) || r.startsWith('src/dev/')) continue
      readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (RE.test(line)) offenders.push(`${r}:${i + 1}:${line.trim().slice(0, 110)}`)
        })
    }
    expect(
      offenders,
      `Lecturas directas de la key de texto (N=${offenders.length}); usa resolveTextApiKey():\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
