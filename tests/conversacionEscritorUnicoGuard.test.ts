/**
 * C8 — conversacionEscritorUnico: un solo escritor de fluDb.conversations.
 * Nace ROJO (3 escritores: App, useConversationPersistence, fluStorage).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const RE = /fluDb\.conversations\.(?:put|add|delete|bulkDelete)\s*\(|fluDb\.conversations\.where\s*\(/
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

describe('C8 conversacionEscritorUnico — un solo escritor de conversación', () => {
  it('un único archivo escribe fluDb.conversations', () => {
    const writers = walk(SRC)
      .filter((f) => RE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
      .sort()
    expect(
      writers,
      `Escritores de fluDb.conversations (N=${writers.length}); debe quedar 1:\n  ${writers.join('\n  ')}`,
    ).toHaveLength(1)
  })
})
