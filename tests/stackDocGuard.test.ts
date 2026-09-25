/**
 * C23 — stackDoc: AGENTS.md alineado con el stack real.
 * Nace ROJO (manda React 18 / Vite 5 / Tailwind CSS 3; el repo usa React 19 / Vite 8 / TS 6 y CSS plano).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const RE = /React 18|Vite 5|Tailwind CSS 3/g

describe('C23 stackDoc — AGENTS.md alineado con el stack real', () => {
  it('no quedan versiones/stack obsoletos en AGENTS.md', () => {
    const content = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')
    const lines = content.split(/\r?\n/)
    const offenders: string[] = []
    RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = RE.exec(content)) !== null) {
      const line = content.slice(0, m.index).split('\n').length
      offenders.push(`AGENTS.md:${line}:${lines[line - 1]?.trim().slice(0, 110)}`)
    }
    expect(
      offenders,
      `Stack obsoleto en AGENTS.md (N=${offenders.length}):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
