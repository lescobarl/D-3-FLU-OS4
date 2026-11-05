/**
 * C4 — aiProviderStorageKeyUnica: la clave del proveedor de IA sale de STORAGE_KEYS.
 *
 * `src/core/config/appConfig.ts` define `STORAGE_KEYS.AI_PROVIDER = 'flu-ai-provider'`.
 * Aun así, `aiServiceFactory.ts` y `decisionEngine.ts` re-declaran el literal,
 * de modo que renombrar la clave en config no cambia la realidad (§2.8).
 *
 * Nace ROJO (2+ literales fuera de config) y pasa cuando todos importan STORAGE_KEYS.
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const CONFIG = 'src/core/config/appConfig.ts'
const RE = /['"]flu-ai-provider['"]/
/** Detector PURO de la regla: lineas de UN fuente que la infringen. La prueba de que
 *  discrimina (y de que no esta siempre-rojo) vive en el describe de abajo (P2.4). */
export function findOffenders(content: string, file = 'src/sintetico.ts'): string[] {
  const out: string[] = []
  content.split(/\r?\n/).forEach((line, i) => {
    if (RE.test(line)) out.push(`${file}:${i + 1}:${line.trim().slice(0, 110)}`)
  })
  return out
}

describe('C4 aiProviderStorageKeyUnica — clave de proveedor solo desde STORAGE_KEYS', () => {
  it('no hay literales "flu-ai-provider" fuera de appConfig.ts', () => {
    const offenders: string[] = []
    for (const f of walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      if (r === CONFIG) continue
      offenders.push(...findOffenders(readFileSync(f, 'utf8'), r))
    }
    expect(
      offenders,
      `Literales de la clave de proveedor (N=${offenders.length}); usa STORAGE_KEYS.AI_PROVIDER:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

/** P2.4: el detector no es decorativo; marca una entrada infractora y perdona una limpia. */
describe('P2.4 aiProviderStorageKeyUnicaGuard - el detector no es decorativo', () => {
  it('marca una entrada infractora sintetica y no marca una limpia', () => {
    expect(findOffenders("const k = 'flu-ai-provider'", 'src/sintetico.ts')).toHaveLength(1)
    expect(findOffenders("const k = STORAGE_KEYS.AI_PROVIDER", 'src/sintetico.ts')).toHaveLength(0)
  })
})
