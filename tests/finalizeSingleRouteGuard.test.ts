/**
 * C37 — finalizeSingleRoute: una sola ruta de finalización de turno (§9.3).
 * Nace ROJO (2 llamadas a finalizeTurnCommit en conversationStreamCommit.js).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const TARGET = 'src/voice/lib/conversationStreamCommit.js'
const RE = /finalizeTurnCommit\([^)]*\)/

/** Llamadas a finalizeTurnCommit (mismo criterio del guard), alimentable. */
export function finalizeCalls(src: string, file: string): string[] {
  const calls: string[] = []
  src.split(/\r?\n/).forEach((line, i) => {
    if (RE.test(line)) calls.push(`${file}:${i + 1}:${line.trim().slice(0, 110)}`)
  })
  return calls
}

describe('C37 finalizeSingleRoute — una sola ruta de finalización', () => {
  it('un único punto de llamada a finalizeTurnCommit', () => {
    const calls = finalizeCalls(readFileSync(join(ROOT, TARGET), 'utf8'), TARGET)
    expect(
      calls,
      `Llamadas a finalizeTurnCommit (N=${calls.length}); debe quedar 1:\n  ${calls.join('\n  ')}`,
    ).toHaveLength(1)
  })
})

// P2.4 - prueba de detector: alimentado el infractor sintetico, la marca.
describe('C37 finalizeSingleRoute - el detector no es decorativo', () => {
  it('cuenta las llamadas sinteticas y ninguna en el sano', () => {
    expect(finalizeCalls('finalizeTurnCommit()\nfinalizeTurnCommit()', 'f')).toHaveLength(2)
    expect(finalizeCalls('finalizeTurnCommit()', 'f')).toHaveLength(1)
    expect(finalizeCalls('const a = 1', 'f')).toEqual([])
  })
})