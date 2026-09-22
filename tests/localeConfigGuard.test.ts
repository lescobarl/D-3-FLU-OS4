/**
 * C47 — localeConfig: una sola fuente para los locales de voz/escucha.
 *
 * Ningún módulo fuera de `src/core/config/localeConfig.ts` declara un literal
 * 'es-MX'/'en-US'/'es-ES'/'en-GB'. Antes: 21 literales en 8 archivos (la metrica
 * `locale-literales` nacia en 21 y baja a 0 con el fix).
 *
 * El segundo describe prueba que el detector marca de verdad (0.12): un guard
 * de conteo que no puede fallar no es una barrera.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const ALLOWED = 'src/core/config/localeConfig.ts'
const RE = /['"`](?:es|en)-(?:MX|US|ES|GB)['"`]/

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

/** Líneas con un literal de locale es/en fuera de la fuente única. */
function findLocaleLiterals(rel: string, src: string): number[] {
  if (rel === ALLOWED) return []
  const out: number[] = []
  src.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim()
    if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return
    const stripped = line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '')
    if (RE.test(stripped)) out.push(i + 1)
  })
  return out
}

describe('C47 localeConfig — un solo origen de locales', () => {
  it('no hay literales de locale fuera de localeConfig.ts', () => {
    const offenders: string[] = []
    for (const f of walk(SRC)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      for (const line of findLocaleLiterals(r, readFileSync(f, 'utf8'))) {
        offenders.push(`${r}:${line}: locale literal`)
      }
    }
    expect(
      offenders,
      `Locales hardcodeados (N=${offenders.length}):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  it('FLU_CONFIG conserva los locales esperados (el refactor no cambia el valor)', async () => {
    const { FLU_CONFIG } = await import('../src/voice/lib/fluConfig.js')
    expect(FLU_CONFIG.activeListen.languages.es).toBe('es-MX')
    expect(FLU_CONFIG.activeListen.languages.en).toBe('en-US')
    expect(FLU_CONFIG.activeListen.bilingual.defaultLocale).toBe('es-MX')
    expect(FLU_CONFIG.activeListen.bilingual.locales).toEqual(['es-MX', 'en-US'])
  })
})

describe('C47 localeConfig — el detector no es decorativo', () => {
  it('marca un literal es-MX', () => {
    expect(findLocaleLiterals('src/x.ts', "const l = 'es-MX'")).toHaveLength(1)
  })
  it('marca en-US dentro de una llamada', () => {
    expect(findLocaleLiterals('src/x.ts', "d.toLocaleDateString('en-US')")).toHaveLength(1)
  })
  it('ignora un locale de script (no es de la familia es/en)', () => {
    expect(findLocaleLiterals('src/x.ts', "return 'ja-JP'")).toHaveLength(0)
  })
  it('ignora el comentario', () => {
    expect(findLocaleLiterals('src/x.ts', "// usa 'es-MX'")).toHaveLength(0)
  })
})
