/**
 * C15 — uuidV4Insercion: todo insert usa UUIDv4 (§3.6).
 * Nace ROJO (fallback voice-${Date.now()} en fluStorage.js).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const RE = /voice-\$\{Date\.now\(\)\}/
/** Detector PURO de la regla: lineas de UN fuente que la infringen. La prueba de que
 *  discrimina (y de que no esta siempre-rojo) vive en el describe de abajo (P2.4). */
export function findOffenders(content: string, file = 'src/sintetico.ts'): string[] {
  const out: string[] = []
  content.split(/\r?\n/).forEach((line, i) => {
    if (RE.test(line)) out.push(`${file}:${i + 1}:${line.trim().slice(0, 110)}`)
  })
  return out
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

describe('C15 uuidV4Insercion — IDs UUIDv4 al insertar', () => {
  it('no hay IDs derivados de Date.now()', () => {
    const offenders: string[] = []
    for (const f of walk(SRC)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      offenders.push(...findOffenders(readFileSync(f, 'utf8'), r))
    }
    expect(
      offenders,
      `IDs no-UUIDv4 (N=${offenders.length}); usa uuidv4:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

/** P2.4: el detector no es decorativo; marca una entrada infractora y perdona una limpia. */
describe('P2.4 uuidV4InsercionGuard - el detector no es decorativo', () => {
  it('marca una entrada infractora sintetica y no marca una limpia', () => {
    expect(findOffenders('id: `voice-${Date.now()}`', 'src/sintetico.ts')).toHaveLength(1)
    expect(findOffenders('id: uuidv4()', 'src/sintetico.ts')).toHaveLength(0)
  })
})
