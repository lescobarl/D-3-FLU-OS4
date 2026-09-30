/**
 * C11 — notasCompras: una sola tabla/servicio para notas y listas.
 * Nace ROJO (2 tablas: fluDb.notes y fluDb.shoppingItems).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const RE = /fluDb\.(?:notes|shoppingItems)/
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

describe('C11 notasCompras — una sola tabla de notas/listas', () => {
  it('solo una tabla almacena notas/listas', () => {
    const tables = walk(SRC)
      .filter((f) => RE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
      .sort()
    expect(
      tables,
      `Tablas de notas/listas (N=${tables.length}); debe quedar 1:\n  ${tables.join('\n  ')}`,
    ).toHaveLength(1)
  })
})

/** P2.4 - prueba de DETECTOR: el predicado del guard marca una entrada infractora
 *  sintetica y PERDONA una limpia. Si alguien lo neutra (regex vacio, `true`...),
 *  este caso cae; el bucle sobre src que lo aplica lo cubre la asercion de arriba. */
describe('P2.4 notasComprasGuard - el detector no es decorativo', () => {
  it('marca una entrada infractora y no marca una limpia', () => {
    const pred = (texto: string) => RE.test(texto)
    expect(pred("fluDb.notes.toArray()")).toBe(true)
    expect(pred("fluDb.minutes.toArray()")).toBe(false)
  })
})
