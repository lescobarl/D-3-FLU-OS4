/**
 * C30 — indexedDbSingle: una sola base IndexedDB propia (flu-os3).
 * Nace ROJO (2 módulos abren su propia DB: longTermMemory, fluStorage).
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const EXCLUDE = 'src/core/autonomy/healthMonitor.ts'
const RE = /indexedDB\.open\s*\(/

describe('C30 indexedDbSingle — una sola base IndexedDB propia', () => {
  it('ningún módulo fuera de la capa Dexie abre su propia DB', () => {
    const files = walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)
      .filter((f) => {
        const r = relative(ROOT, f).replace(/\\/g, '/')
        return r !== EXCLUDE && RE.test(readFileSync(f, 'utf8'))
      })
      .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
      .sort()
    expect(
      files,
      `Bases IndexedDB propias (N=${files.length}); debe quedar solo fluDatabase:\n  ${files.join('\n  ')}`,
    ).toEqual([])
  })
})

/** P2.4 - prueba de DETECTOR: el predicado del guard marca una entrada infractora
 *  sintetica y PERDONA una limpia. Si alguien lo neutra (regex vacio, `true`...),
 *  este caso cae; el bucle sobre src que lo aplica lo cubre la asercion de arriba. */
describe('P2.4 indexedDbSingleGuard - el detector no es decorativo', () => {
  it('marca una entrada infractora y no marca una limpia', () => {
    const pred = (texto: string) => RE.test(texto)
    expect(pred("const db = indexedDB.open('otra')")).toBe(true)
    expect(pred("const db = new Dexie('flu')")).toBe(false)
  })
})
