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
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const ALLOWED = new Set(['src/core/config/appConfig.ts', 'src/core/config/sharedConfig.ts'])
const RE = /import\.meta\.env\.VITE_OPENROUTER_API_KEY/
/** Detector PURO de la regla: lineas de UN fuente que la infringen. La prueba de que
 *  discrimina (y de que no esta siempre-rojo) vive en el describe de abajo (P2.4). */
export function findOffenders(content: string, file = 'src/sintetico.ts'): string[] {
  const out: string[] = []
  content.split(/\r?\n/).forEach((line, i) => {
    if (RE.test(line)) out.push(`${file}:${i + 1}:${line.trim().slice(0, 110)}`)
  })
  return out
}

describe('C5 textApiKeyResolverUnico — la key de texto sale del resolver central', () => {
  it('no hay lecturas directas de import.meta.env.VITE_OPENROUTER_API_KEY fuera de config/dev', () => {
    const offenders: string[] = []
    for (const f of walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      if (ALLOWED.has(r) || r.startsWith('src/dev/')) continue
      offenders.push(...findOffenders(readFileSync(f, 'utf8'), r))
    }
    expect(
      offenders,
      `Lecturas directas de la key de texto (N=${offenders.length}); usa resolveTextApiKey():\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

/** P2.4: el detector no es decorativo; marca una entrada infractora y perdona una limpia. */
describe('P2.4 textApiKeyResolverUnicoGuard - el detector no es decorativo', () => {
  it('marca una entrada infractora sintetica y no marca una limpia', () => {
    expect(findOffenders("const k = import.meta.env.VITE_OPENROUTER_API_KEY", 'src/sintetico.ts')).toHaveLength(1)
    expect(findOffenders("const k = resolveTextApiKey()", 'src/sintetico.ts')).toHaveLength(0)
  })
})
