/**
 * C12 — textKeyLiterales: las claves de texto salen de STORAGE_KEYS.
 * Nace ROJO (7 literales en voice/lib/gemini.js).
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const CONFIG = 'src/core/config/appConfig.ts'
const RE = /['"]flu-text-model['"]|['"]flu-text-api-key['"]/
/** Detector PURO de la regla: lineas de UN fuente que la infringen. La prueba de que
 *  discrimina (y de que no esta siempre-rojo) vive en el describe de abajo (P2.4). */
export function findOffenders(content: string, file = 'src/sintetico.ts'): string[] {
  const out: string[] = []
  content.split(/\r?\n/).forEach((line, i) => {
    if (RE.test(strip(line))) out.push(`${file}:${i + 1}:${line.trim().slice(0, 110)}`)
  })
  return out
}

const strip = (line: string) => {
  const t = line.trim()
  if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return ''
  return line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '')
}

describe('C12 textKeyLiterales — claves de texto desde STORAGE_KEYS', () => {
  it('no hay literales de claves de texto fuera de appConfig.ts', () => {
    const offenders: string[] = []
    for (const f of walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      if (r === CONFIG) continue
      offenders.push(...findOffenders(readFileSync(f, 'utf8'), r))
    }
    expect(
      offenders,
      `Literales de claves de texto (N=${offenders.length}):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

/** P2.4: el detector no es decorativo; marca una entrada infractora y perdona una limpia. */
describe('P2.4 textKeyLiteralesGuard - el detector no es decorativo', () => {
  it('marca una entrada infractora sintetica y no marca una limpia', () => {
    expect(findOffenders("localStorage.getItem('flu-text-model')", 'src/sintetico.ts')).toHaveLength(1)
    expect(findOffenders("localStorage.getItem(STORAGE_KEYS.TEXT_MODEL)", 'src/sintetico.ts')).toHaveLength(0)
  })
})
