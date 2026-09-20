/**
 * C33 — memoryItemSync: MemoryItem cumple la tupla de sync (§3.7).
 * Nace ROJO (MemoryItem sin revision/updatedAt).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const TARGET = 'src/lib/longTermMemory.ts'

describe('C33 memoryItemSync — tupla de sync en MemoryItem', () => {
  it('MemoryItem declara revision y updatedAt', () => {
    const src = readFileSync(join(ROOT, TARGET), 'utf8')
    const m = src.match(/interface MemoryItem\s*\{[\s\S]*?\n\}/)
    expect(m, 'Debe existir la interfaz MemoryItem').not.toBeNull()
    const block = m ? m[0] : ''
    const missing: string[] = []
    if (!/revision/.test(block)) missing.push(`${TARGET}: MemoryItem sin 'revision'`)
    if (!/updatedAt/.test(block)) missing.push(`${TARGET}: MemoryItem sin 'updatedAt'`)
    expect(missing, `Tupla de sync incompleta:\n  ${missing.join('\n  ')}`).toEqual([])
  })
})
