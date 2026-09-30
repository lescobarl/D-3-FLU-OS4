/**
 * C14 — borradoLogico: sin borrado físico de entidades Dexie.
 * Nace ROJO (4 borrados: voiceProfiles, conversations, auditLog.clear).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const RE = /fluDb\.[A-Za-z]+\.(?:delete|bulkDelete|clear)\s*\(|\.where\([^)]*\)\s*\.delete\(/g
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

describe('C14 borradoLogico — sin borrado físico en Dexie', () => {
  it('ninguna entidad se borra físicamente (deleted:true)', () => {
    const offenders: string[] = []
    for (const f of walk(SRC)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      const content = readFileSync(f, 'utf8')
      const lines = content.split(/\r?\n/)
      RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = RE.exec(content)) !== null) {
        const line = content.slice(0, m.index).split('\n').length
        offenders.push(`${r}:${line}:${lines[line - 1]?.trim().slice(0, 100)}`)
      }
    }
    expect(
      offenders,
      `Borrado físico de entidades (N=${offenders.length}); usa deleted:true:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
