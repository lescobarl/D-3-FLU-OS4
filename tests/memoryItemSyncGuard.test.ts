/**
 * C33 — memoryItemSync: MemoryItem cumple la tupla de sync (§3.7).
 * Nace ROJO (MemoryItem sin revision/updatedAt).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const TARGET = 'src/lib/longTermMemory.ts'

/** Campos exigidos a la interfaz MemoryItem (extraidos para probar el DETECTOR, P2.4). */
const CAMPOS_SYNC = ['revision', 'updatedAt'] as const

/** Campos de la tupla de sync que FALTAN en la interfaz MemoryItem del fuente dado. */
export function missingTupleFields(src: string, file: string = TARGET): string[] {
  const m = src.match(/interface MemoryItem\s*\{[\s\S]*?\n\}/)
  const block = m ? m[0] : ''
  return CAMPOS_SYNC.filter((c) => !block.includes(c)).map((c) => `${file}: MemoryItem sin '${c}'`)
}

describe('P2.4 memoryItemSyncGuard - el detector no es decorativo', () => {
  it('marca el campo ausente en un fuente sintetico', () => {
    const completo = 'interface MemoryItem {\n  revision: number\n  updatedAt: string\n}'
    const mutilado = 'interface MemoryItem {\n  revision: number\n}'
    expect(missingTupleFields(completo)).toEqual([])
    expect(missingTupleFields(mutilado)).toEqual([`${TARGET}: MemoryItem sin 'updatedAt'`])
  })
})

describe('C33 memoryItemSync — tupla de sync en MemoryItem', () => {
  it('MemoryItem declara revision y updatedAt', () => {
    // C16: el módulo murió (sin importador de producción) → invariante vacuo.
    if (!existsSync(join(ROOT, TARGET))) return
    const src = readFileSync(join(ROOT, TARGET), 'utf8')
    expect(src.match(/interface MemoryItem\s*\{[\s\S]*?\n\}/), 'Debe existir la interfaz MemoryItem').not.toBeNull()
    expect(missingTupleFields(src), 'Tupla de sync incompleta').toEqual([])
  })
})
