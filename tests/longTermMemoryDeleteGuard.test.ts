/**
 * C32 — longTermMemoryDelete: borrado lógico en memoria a largo plazo.
 * Nace ROJO (1 store.delete físico).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const TARGET = 'src/lib/longTermMemory.ts'
const RE = /store\.delete\s*\(/

describe('C32 longTermMemoryDelete — borrado lógico', () => {
  it('no hay borrado físico en longTermMemory', () => {
    // C16: el módulo murió (sin importador de producción) → invariante vacuo.
    if (!existsSync(join(ROOT, TARGET))) return
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

/** P2.4 - prueba de DETECTOR: el predicado del guard marca una entrada infractora
 *  sintetica y PERDONA una limpia. Si alguien lo neutra (regex vacio, `true`...),
 *  este caso cae; el bucle sobre src que lo aplica lo cubre la asercion de arriba. */
describe('P2.4 longTermMemoryDeleteGuard - el detector no es decorativo', () => {
  it('marca una entrada infractora y no marca una limpia', () => {
    const pred = (texto: string) => RE.test(texto)
    expect(pred("await store.delete(id)")).toBe(true)
    expect(pred("await store.update(id, { deleted: true })")).toBe(false)
  })
})
