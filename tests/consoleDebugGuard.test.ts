/**
 * C35 — consoleDebug: sin console.debug residual.
 * Nace ROJO (12 console.debug).
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const RE = /console\.debug\s*\(/
/** Detector PURO de la regla: lineas de UN fuente que la infringen. La prueba de que
 *  discrimina (y de que no esta siempre-rojo) vive en el describe de abajo (P2.4). */
export function findOffenders(content: string, file = 'src/sintetico.ts'): string[] {
  const out: string[] = []
  content.split(/\r?\n/).forEach((line, i) => {
    if (RE.test(line)) out.push(`${file}:${i + 1}:${line.trim().slice(0, 110)}`)
  })
  return out
}

describe('C35 consoleDebug — sin console.debug', () => {
  it('no hay console.debug residual', () => {
    const offenders: string[] = []
    for (const f of walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      offenders.push(...findOffenders(readFileSync(f, 'utf8'), r))
    }
    expect(
      offenders,
      `console.debug residual (N=${offenders.length}):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

/** P2.4: el detector no es decorativo; marca una entrada infractora y perdona una limpia. */
describe('P2.4 consoleDebugGuard - el detector no es decorativo', () => {
  it('marca una entrada infractora sintetica y no marca una limpia', () => {
    expect(findOffenders("console.debug('rastro')", 'src/sintetico.ts')).toHaveLength(1)
    expect(findOffenders("console.warn('aviso')", 'src/sintetico.ts')).toHaveLength(0)
  })
})
