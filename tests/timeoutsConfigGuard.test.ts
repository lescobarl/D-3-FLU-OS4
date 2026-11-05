/**
 * C18 — timeoutsConfig: los timeouts de red salen de la config central.
 * Nace ROJO (7 constantes TIMEOUT fuera de appConfig/sharedConfig).
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const ALLOWED = new Set(['src/core/config/appConfig.ts', 'src/core/config/sharedConfig.ts'])
const RE = /\b[A-Z_]*TIMEOUT(?:_MS)?\s*=/
/** Detector PURO de la regla: lineas de UN fuente que la infringen. La prueba de que
 *  discrimina (y de que no esta siempre-rojo) vive en el describe de abajo (P2.4). */
export function findOffenders(content: string, file = 'src/sintetico.ts'): string[] {
  const out: string[] = []
  content.split(/\r?\n/).forEach((line, i) => {
    if (RE.test(strip(line))) out.push(`${file}:${i + 1}:${line.trim().slice(0, 110)}`)
  })
  return out
}

const strip = (line: string) => {
  const t = line.trim()
  if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return ''
  return line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '')
}

describe('C18 timeoutsConfig — timeouts desde config central', () => {
  it('no hay constantes de timeout fuera de la config', () => {
    const offenders: string[] = []
    for (const f of walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      if (ALLOWED.has(r)) continue
      offenders.push(...findOffenders(readFileSync(f, 'utf8'), r))
    }
    expect(
      offenders,
      `Timeouts fuera de config (N=${offenders.length}):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

/** P2.4: el detector no es decorativo; marca una entrada infractora y perdona una limpia. */
describe('P2.4 timeoutsConfigGuard - el detector no es decorativo', () => {
  it('marca una entrada infractora sintetica y no marca una limpia', () => {
    expect(findOffenders('const FETCH_TIMEOUT_MS = 5000', 'src/sintetico.ts')).toHaveLength(1)
    expect(findOffenders('const ms = TIMEOUT_POLICY_MS.healthProbeAbort', 'src/sintetico.ts')).toHaveLength(0)
  })
})
