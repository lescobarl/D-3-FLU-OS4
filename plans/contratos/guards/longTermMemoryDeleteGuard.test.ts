/**
 * C32 — longTermMemoryDelete: borrado lógico en memoria a largo plazo.
 * Nace ROJO (1 store.delete físico).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const TARGET = 'src/lib/longTermMemory.ts'
const RE = /store\.delete\s*\(/

describe('C32 longTermMemoryDelete — borrado lógico', () => {
  it('no hay borrado físico en longTermMemory', () => {
    const offenders: string[] = []
    readFileSync(join(ROOT, TARGET), 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (RE.test(line)) offenders.push(`${TARGET}:${i + 1}:${line.trim().slice(0, 110)}`)
      })
    expect(
      offenders,
      `Borrado físico en memoria (N=${offenders.length}); usa deleted:true:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
