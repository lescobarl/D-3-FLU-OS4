/**
 * C14 — borradoLogico: sin borrado físico de entidades Dexie.
 * Nace ROJO (4 borrados: voiceProfiles, conversations, auditLog.clear).
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const RE = /fluDb\.[A-Za-z]+\.(?:delete|bulkDelete|clear)\s*\(|\.where\([^)]*\)\s*\.delete\(/g
/** Detector PURO de la regla sobre el CONTENIDO (mismo regex /g y mismo numero de
 *  linea). Prueba de mutacion en el describe de abajo (P2.4). */
export function findOffenders(content: string, file = 'src/sintetico.ts'): string[] {
  const out: string[] = []
  const lines = content.split(/\r?\n/)
  RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RE.exec(content)) !== null) {
    const line = content.slice(0, m.index).split('\n').length
    out.push(`${file}:${line}:${lines[line - 1]?.trim().slice(0, 100)}`)
  }
  return out
}

describe('C14 borradoLogico — sin borrado físico en Dexie', () => {
  it('ninguna entidad se borra físicamente (deleted:true)', () => {
    const offenders: string[] = []
    for (const f of walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      offenders.push(...findOffenders(readFileSync(f, 'utf8'), r))
    }
    expect(
      offenders,
      `Borrado físico de entidades (N=${offenders.length}); usa deleted:true:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

/** P2.4: el detector no es decorativo; marca una entrada infractora y perdona una limpia. */
describe('P2.4 borradoLogicoGuard - el detector no es decorativo', () => {
  it('marca una entrada infractora sintetica y no marca una limpia', () => {
    expect(findOffenders('await fluDb.notes.delete(id)', 'src/sintetico.ts')).toHaveLength(1)
    expect(findOffenders('await fluDb.notes.update(id, { deleted: true })', 'src/sintetico.ts')).toHaveLength(0)
  })
})
