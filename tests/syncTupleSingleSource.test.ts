// ============================================================
// syncTupleSingleSource.test.ts — GUARD: la tupla de sincronización vive en UN lugar.
// ------------------------------------------------------------
// Invariante: la lógica `buildSync` (§3.7: revision, updated_at, deleted) se define
// UNA sola vez. Hoy está copiada en 15 servicios core.
// Nace ROJO y lista `archivo:linea` de cada copia.
// ============================================================
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
export const CANONICAL = 'src/core/db/syncTuple.ts'

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx)$/.test(e)) acc.push(p)
  }
  return acc
}

/** Definiciones de buildSync/buildSyncTuple (function o const) en todo src. */
export function findBuildSyncDefs(root: string = join(ROOT, 'src')): string[] {
  const re = /(?:function|const)\s+buildSync(?:Tuple)?\s*[=(]/
  const isComment = (l: string) => /^\s*(\/\/|\*|\/\*)/.test(l)
  const out: string[] = []
  for (const f of walk(root)) {
    readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (!isComment(line) && re.test(line)) {
          out.push(`${relative(root, f).replace(/\\/g, '/')}:${i + 1}`)
        }
      })
  }
  return out
}

describe('tupla de sincronización — una sola fuente', () => {
  it('buildSync/buildSyncTuple se define en UN solo archivo', () => {
    const defs = findBuildSyncDefs()
    expect(
      defs,
      `Definiciones (N=${defs.length}); debe quedar 1 en ${CANONICAL}:\n  ${defs.join('\n  ')}`,
    ).toHaveLength(1)
  })
})

/** P2.4 - prueba de DETECTOR: escribe entradas sinteticas en un directorio temporal
 *  y comprueba que el detector MARCA la infractora y PERDONA la limpia. */
function dirSintetico(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'p24-'))
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c)
  return dir
}

describe('P2.4 syncTupleSingleSource - el detector no es decorativo', () => {
  it('marca una definicion sintetica de buildSyncTuple', () => {
    const dir = dirSintetico({
      'infractor.ts': 'export function buildSyncTuple(prev) { return prev }',
      'limpio.ts': 'export function otra(prev) { return prev }',
    })
    try {
      const d = findBuildSyncDefs(dir)
      expect(d).toHaveLength(1)
      expect(d[0]).toContain('infractor.ts')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
