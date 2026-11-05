/**
 * C25 — appNormaliza: App no re-normaliza la frase canónica (§9.2).
 * Nace ROJO (4 llamadas a normalizeCommandForDeterministic/actionBelongsToTranscript).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const TARGET = 'src/App.tsx'
const RE = /normalizeCommandForDeterministic\s*\(|actionBelongsToTranscript\s*\(/
const strip = (line: string) => {
  const t = line.trim()
  if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return ''
  return line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '')
}

describe('C25 appNormaliza — App no re-normaliza', () => {
  it('App no normaliza la frase ya canónica', () => {
    const offenders: string[] = []
    readFileSync(join(ROOT, TARGET), 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (RE.test(strip(line))) offenders.push(`${TARGET}:${i + 1}:${line.trim().slice(0, 110)}`)
      })
    expect(
      offenders,
      `Re-normalización en App (N=${offenders.length}):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

/** P2.4 - prueba de DETECTOR: el predicado del guard marca una entrada infractora
 *  sintetica y PERDONA una limpia. Si alguien lo neutra (regex vacio, `true`...),
 *  este caso cae; el bucle sobre src que lo aplica lo cubre la asercion de arriba. */
describe('P2.4 appNormalizaGuard - el detector no es decorativo', () => {
  it('marca una entrada infractora y no marca una limpia', () => {
    const pred = (texto: string) => RE.test(strip(texto))
    expect(pred("normalizeCommandForDeterministic(cmd)")).toBe(true)
    expect(pred("const y = 1")).toBe(false)
  })
})
