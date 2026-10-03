/**
 * C23 — stackDoc: AGENTS.md alineado con el stack real.
 * Nace ROJO (manda React 18 / Vite 5 / Tailwind CSS 3; el repo usa React 19 / Vite 8 / TS 6 y CSS plano).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const RE = /React 18|Vite 5|Tailwind CSS 3/g

/**
 * Detector: lineas de un texto con stack obsoleto, con su numero de linea.
 * Exportado para poder falsificarlo (guardMutationGuard: sin prueba de detector es teatro).
 * @param content Texto a medir (el caso real lee AGENTS.md).
 */
export function stackObsoleto(content: string): string[] {
  const lines = content.split(/\r?\n/)
  const offenders: string[] = []
  RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RE.exec(content)) !== null) {
    const line = content.slice(0, m.index).split('\n').length
    offenders.push(`AGENTS.md:${line}:${lines[line - 1]?.trim().slice(0, 110)}`)
  }
  return offenders
}

describe('C23 stackDoc — AGENTS.md alineado con el stack real', () => {
  it('no quedan versiones/stack obsoletos en AGENTS.md', () => {
    const content = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')
    const offenders = stackObsoleto(content)
    expect(
      offenders,
      `Stack obsoleto en AGENTS.md (N=${offenders.length}):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  it('PRUEBA DE DETECTOR: el detector marca el stack obsoleto y no marca el real', () => {
    expect(stackObsoleto('Stack: React 18 y Vite 5 con Tailwind CSS 3')).toHaveLength(3)
    expect(stackObsoleto('Stack: React 19, Vite 8, TypeScript 6, CSS propio')).toEqual([])
  })
})
