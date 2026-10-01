/**
 * C2 — searchAllowlistFuenteUnica: la allowlist de búsqueda vive en FLU_CONFIG.
 *
 * `src/voice/lib/fluConfig.js` es la fuente de `voiceCommands.search.allowlist`.
 * App y useNavigationCommands re-declaran el literal `['wikipedia.org','educ.ar']`,
 * de modo que cambiar la config no cambia el comportamiento real.
 *
 * Nace ROJO (2 literales fuera de config) y pasa cuando ambos leen FLU_CONFIG.
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const CONFIG = 'src/voice/lib/fluConfig.js'
const RE = /\[\s*'wikipedia\.org'\s*,\s*'educ\.ar'\s*\]/

/** Literales de allowlist de busqueda (mismo criterio del guard). */
export function allowlistLiterals(src: string, file: string): string[] {
  const offenders: string[] = []
  src.split(/\r?\n/).forEach((line, i) => {
    if (RE.test(line)) offenders.push(`${file}:${i + 1}:${line.trim().slice(0, 110)}`)
  })
  return offenders
}

describe('C2 searchAllowlistFuenteUnica — allowlist solo desde config', () => {
  it('no hay literales de allowlist fuera de fluConfig.js', () => {
    const offenders: string[] = []
    for (const f of walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      if (r === CONFIG) continue
      offenders.push(...allowlistLiterals(readFileSync(f, 'utf8'), r))
    }
    expect(
      offenders,
      `Allowlist duplicada fuera de config (N=${offenders.length}):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

// P2.4 - prueba de detector: alimentado el infractor sintetico, la marca.
describe('C2 searchAllowlistFuenteUnica - el detector no es decorativo', () => {
  it('marca la allowlist literal y deja pasar la que sale de config', () => {
    expect(allowlistLiterals("const a = ['wikipedia.org','educ.ar']", 'f.ts')).toHaveLength(1)
    expect(allowlistLiterals('const a = FLU_CONFIG.browser.search.allowlist', 'f.ts')).toEqual([])
  })
})