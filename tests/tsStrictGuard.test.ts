/**
 * C49 — tsStrict: sin doble cast (`as unknown as`) y TS estricto de verdad.
 *
 * Antes: 67 `as unknown as` en src (casi todos en src/core/games/** para el
 * `state` de la sesion). Causa raiz: `GameSession.state` estaba tipado
 * `Record<string, unknown>`, forzando el doble cast en cada juego. Ahora el
 * estado es opaco (`unknown`) y `GameSession<TState>` propaga el tipo real.
 *
 * El segundo describe prueba que el detector falla de verdad (0.12).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const DOUBLE_CAST = /as unknown as/
const ANY_TYPE = /\bas\s+any\b|<any\b|:\s*any\b|\bany\s*\[\]/

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

/** Líneas con doble cast (`as unknown as`) en un fuente. */
function findDoubleCasts(src: string): number[] {
  const out: number[] = []
  src.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim()
    if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return
    if (DOUBLE_CAST.test(line)) out.push(i + 1)
  })
  return out
}

describe('C49 tsStrict — sin doble cast', () => {
  it('no hay "as unknown as" en src', () => {
    const offenders: string[] = []
    for (const f of walk(SRC)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      for (const line of findDoubleCasts(readFileSync(f, 'utf8'))) {
        offenders.push(`${r}:${line}`)
      }
    }
    expect(offenders, `Doble cast (N=${offenders.length}):\n  ${offenders.join('\n  ')}`).toEqual([])
  })

  it('tsconfig exige noUnusedLocals y noUnusedParameters', () => {
    const ts = JSON.parse(readFileSync(join(ROOT, 'tsconfig.json'), 'utf8')) as {
      compilerOptions: Record<string, unknown>
    }
    expect(ts.compilerOptions.noUnusedLocals).toBe(true)
    expect(ts.compilerOptions.noUnusedParameters).toBe(true)
    expect(ts.compilerOptions.strict).toBe(true)
  })
})

/** Líneas con `any` en posición de TIPO (`: any`, `as any`, `<any>`, `any[]`). */
function findAnyTypes(src: string): number[] {
  const out: number[] = []
  src.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim()
    if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return
    if (ANY_TYPE.test(line)) out.push(i + 1)
  })
  return out
}

describe('C49 tsStrict — sin `any` de tipo', () => {
  it('no hay `any` en posición de tipo en src', () => {
    const offenders: string[] = []
    for (const f of walk(SRC)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      for (const line of findAnyTypes(readFileSync(f, 'utf8'))) {
        offenders.push(`${r}:${line}`)
      }
    }
    expect(offenders, `Any de tipo (N=${offenders.length}):\n  ${offenders.join('\n  ')}`).toEqual([])
  })
})

describe('C49 tsStrict — el detector de `any` no es decorativo', () => {
  it('no marca nombres que solo CONTIENEN "any"', () => {
    expect(findAnyTypes('const addMany = (labels: string[]) => labels')).toEqual([])
    expect(findAnyTypes('const anyWs = ws as XlsxSheet')).toEqual([])
    expect(findAnyTypes('// filtra cualquier any entrante')).toEqual([])
  })
  it('marca el `any` de tipo en sus cuatro formas', () => {
    expect(findAnyTypes('function f(x: any) {}')).toEqual([1])
    expect(findAnyTypes('const y = z as any')).toEqual([1])
    expect(findAnyTypes('const w: Array<any> = []')).toEqual([1])
    expect(findAnyTypes('const v: string[] = [] as any[]')).toEqual([1])
  })
})
describe('C49 tsStrict — el detector no es decorativo', () => {
  it('marca un doble cast', () => {
    expect(findDoubleCasts("session.state = state as unknown as Record<string, unknown>;")).toHaveLength(1)
  })
  it('no marca un cast simple', () => {
    expect(findDoubleCasts("const state = session.state as TriviaState;")).toHaveLength(0)
  })
  it('ignora comentarios', () => {
    expect(findDoubleCasts("// usa x as unknown as Y")).toHaveLength(0)
  })
})
