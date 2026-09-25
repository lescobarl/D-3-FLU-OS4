// ============================================================
// syncTupleInlineGuard.test.ts — GUARD §3.7: la tupla de sincronización
// [revision, updated_at, deleted] se construye SÓLO en `src/core/db/syncTuple.ts`.
// ------------------------------------------------------------
// Nace ROJO: hoy `newSyncTuple`/`bumpSync` viven en fluDatabase.ts y hay tuplas
// inline con `updated_at: new Date().toISOString()` repartidas por src.
// Inspecciona el CÓDIGO REAL (fs + regex) y lista `archivo:simbolo:linea`.
// ============================================================
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSyncTuple } from '../src/core/db/syncTuple'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const CANONICAL = 'src/core/db/syncTuple.ts'

/** Identificadores duplicados de la tupla de sync. */
const DUPLICATE_HELPER_RE = /\b(newSyncTuple|bumpSync)\b/
/** Construcción inline del campo `updated_at` de la tupla. */
const INLINE_UPDATED_AT_RE = /updated_at\s*:\s*new Date\(\)\.toISOString\(\)/

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx)$/.test(e)) acc.push(p)
  }
  return acc
}

const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line)

/**
 * Recorre `src` y devuelve una violación `archivo:simbolo:linea` por cada
 * definición/uso de `newSyncTuple`/`bumpSync` y por cada `updated_at` inline,
 * fuera de la fuente canónica.
 */
export function findSyncTupleViolations(): string[] {
  const violations: string[] = []
  for (const file of walk(SRC)) {
    const rel = relative(ROOT, file).replace(/\\/g, '/')
    if (rel === CANONICAL) continue
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .forEach((line, index) => {
        if (isComment(line)) return
        const helper = line.match(DUPLICATE_HELPER_RE)
        if (helper) violations.push(`${rel}:${helper[1]}:${index + 1}`)
        if (INLINE_UPDATED_AT_RE.test(line)) {
          violations.push(`${rel}:updated_at:new Date().toISOString():${index + 1}`)
        }
      })
  }
  return violations
}

describe('tupla de sync — construcción inline fuera de la fuente única', () => {
  it(`sólo ${CANONICAL} construye la tupla de sincronización`, () => {
    const violations = findSyncTupleViolations()
    expect(
      violations,
      `Violaciones (N=${violations.length}); la tupla [revision, updated_at, deleted] sólo se construye en ${CANONICAL}:\n  ${violations.join('\n  ')}`,
    ).toEqual([])
  })
})

describe('buildSyncTuple — comportamiento canónico (§3.7)', () => {
  it('nace en revisión 1; incrementa revisión y conserva deleted; actualiza updated_at', () => {
    const t0 = Date.UTC(2026, 0, 2, 3, 4, 5)
    const first = buildSyncTuple(undefined, t0)
    expect(first).toEqual({
      revision: 1,
      updated_at: new Date(t0).toISOString(),
      deleted: false,
    })

    const bumped = buildSyncTuple(first, t0 + 1000)
    expect(bumped.revision).toBe(2)
    expect(bumped.deleted).toBe(false)
    expect(bumped.updated_at).toBe(new Date(t0 + 1000).toISOString())

    const stillDeleted = buildSyncTuple({ ...first, deleted: true }, t0 + 2000)
    expect(stillDeleted.revision).toBe(2)
    expect(stillDeleted.deleted).toBe(true)
  })
})
