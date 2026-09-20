/**
 * C37 — finalizeSingleRoute: una sola ruta de finalización de turno (§9.3).
 * Nace ROJO (2 llamadas a finalizeTurnCommit en conversationStreamCommit.js).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const TARGET = 'src/voice/lib/conversationStreamCommit.js'
const RE = /finalizeTurnCommit\(\)/

describe('C37 finalizeSingleRoute — una sola ruta de finalización', () => {
  it('un único punto de llamada a finalizeTurnCommit', () => {
    const calls: string[] = []
    readFileSync(join(ROOT, TARGET), 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (RE.test(line)) calls.push(`${TARGET}:${i + 1}:${line.trim().slice(0, 110)}`)
      })
    expect(
      calls,
      `Llamadas a finalizeTurnCommit (N=${calls.length}); debe quedar 1:\n  ${calls.join('\n  ')}`,
    ).toHaveLength(1)
  })
})
