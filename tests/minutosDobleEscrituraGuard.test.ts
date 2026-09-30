/**
 * C10 — minutosDobleEscritura: sin doble escritura de minutas.
 * Nace ROJO (3 llamadas integrationStore.addMinute tras minuteKnowledge.addMinute).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const TARGET = 'src/hooks/useMinuteHandlers.ts'
const RE = /integrationStore\.addMinute\s*\(/
const strip = (line: string) => {
  const t = line.trim()
  if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return ''
  return line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '')
}

describe('C10 minutosDobleEscritura — una sola escritura de minutas', () => {
  it('useMinuteHandlers no espeja en integrationStore (una sola fuente)', () => {
    const offenders: string[] = []
    readFileSync(join(ROOT, TARGET), 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (RE.test(strip(line))) offenders.push(`${TARGET}:${i + 1}:${line.trim().slice(0, 110)}`)
      })
    expect(
      offenders,
      `Doble escritura de minutas (N=${offenders.length}):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

/** P2.4 - prueba de DETECTOR: el predicado del guard marca una entrada infractora
 *  sintetica y PERDONA una limpia. Si alguien lo neutra (regex vacio, `true`...),
 *  este caso cae; el bucle sobre src que lo aplica lo cubre la asercion de arriba. */
describe('P2.4 minutosDobleEscrituraGuard - el detector no es decorativo', () => {
  it('marca una entrada infractora y no marca una limpia', () => {
    const pred = (texto: string) => RE.test(strip(texto))
    expect(pred("integrationStore.addMinute(m)")).toBe(true)
    expect(pred("minuteKnowledge.addMinute(m)")).toBe(false)
  })
})
