/**
 * C8 — conversacionEscritorUnico: un solo escritor de fluDb.conversations.
 * Nace ROJO (3 escritores: App, useConversationPersistence, fluStorage).
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const RE = /fluDb\.conversations\.(?:put|add|delete|bulkDelete)\s*\(|fluDb\.conversations\.where\s*\(/

describe('C8 conversacionEscritorUnico — un solo escritor de conversación', () => {
  it('un único archivo escribe fluDb.conversations', () => {
    const writers = walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)
      .filter((f) => RE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
      .sort()
    expect(
      writers,
      `Escritores de fluDb.conversations (N=${writers.length}); debe quedar 1:\n  ${writers.join('\n  ')}`,
    ).toHaveLength(1)
  })
})

/** P2.4 - prueba de DETECTOR: el predicado del guard marca una entrada infractora
 *  sintetica y PERDONA una limpia. Si alguien lo neutra (regex vacio, `true`...),
 *  este caso cae; el bucle sobre src que lo aplica lo cubre la asercion de arriba. */
describe('P2.4 conversacionEscritorUnicoGuard - el detector no es decorativo', () => {
  it('marca una entrada infractora y no marca una limpia', () => {
    const pred = (texto: string) => RE.test(texto)
    expect(pred("fluDb.conversations.put(row)")).toBe(true)
    expect(pred("fluDb.notes.put(row)")).toBe(false)
  })
})
