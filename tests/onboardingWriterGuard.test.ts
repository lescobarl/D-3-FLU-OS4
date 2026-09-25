/**
 * C44 — onboardingWriter: un solo escritor de la tabla `onboardingStates`.
 *
 * Antes (RED): `src/hooks/useParticipants.ts` escribía la tabla directamente
 * (`fluDb.onboardingStates.put(...)`) reimplementando el borrado lógico que el
 * gateway ya hace en `createOnboardingService().reset()`. Ahora toda escritura
 * pasa por el gateway (único escritor); no debe haber `put/add/...` directos.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const WRITE = /fluDb\.onboardingStates\.(?:put|add|update|modify|delete|bulkDelete|clear)\s*\(/
const isCommentLine = (line: string) => /^\s*(?:\/\/|\*|\/\*)/.test(line)

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx)$/.test(e)) acc.push(p)
  }
  return acc
}

/** Archivos con escritura directa a la tabla (excluye comentarios). */
export function directOnboardingWriters(files: string[] = walk(SRC)): string[] {
  const hits: string[] = []
  for (const f of files) {
    const bad = readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .some((line) => !isCommentLine(line) && WRITE.test(line))
    if (bad) hits.push(relative(ROOT, f).replace(/\\/g, '/'))
  }
  return hits.sort()
}

describe('C44 onboardingWriter — un solo escritor de onboardingStates', () => {
  it('ningún módulo escribe fluDb.onboardingStates directamente', () => {
    const hits = directOnboardingWriters()
    expect(
      hits,
      `Escritores directos de onboardingStates (N=${hits.length}): ${hits.join(', ')}`,
    ).toEqual([])
  })
})

describe('C44 onboardingWriter — el detector no es decorativo', () => {
  it('marca un put directo', () => {
    expect(WRITE.test('await fluDb.onboardingStates.put({ id })')).toBe(true)
  })
  it('marca un delete directo', () => {
    expect(WRITE.test('await fluDb.onboardingStates.delete(id)')).toBe(true)
  })
  it('no marca una lectura ni el gateway inyectado', () => {
    expect(WRITE.test('const row = await fluDb.onboardingStates.get(id)')).toBe(false)
    expect(WRITE.test('await db.put(record)')).toBe(false)
  })
})
