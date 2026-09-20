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
