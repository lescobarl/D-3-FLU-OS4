/**
 * C27 — queryDerivationSingle: una sola derivación de la query (§9.6).
 * Nace ROJO (4 sitios: audioMath interno + 3 en el hook).
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const RE = /deriveQueryFromRow\s*\(/
const strip = (line: string) => {
  const t = line.trim()
  if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return ''
  return line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '')
}

describe('C27 queryDerivationSingle — una sola derivación de query', () => {
  it('un único sitio deriva la query a la IA', () => {
    const calls: string[] = []
    for (const f of walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)) {
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

/** P2.4 - prueba de DETECTOR: el predicado del guard marca una entrada infractora
 *  sintetica y PERDONA una limpia. Si alguien lo neutra (regex vacio, `true`...),
 *  este caso cae; el bucle sobre src que lo aplica lo cubre la asercion de arriba. */
describe('P2.4 queryDerivationSingleGuard - el detector no es decorativo', () => {
  it('marca una entrada infractora y no marca una limpia', () => {
    const pred = (texto: string) => RE.test(strip(texto)) && !/export function/.test(texto)
    expect(pred("const q = deriveQueryFromRow(row)")).toBe(true)
    expect(pred("export function deriveQueryFromRow(row) {")).toBe(false)
  })
})
