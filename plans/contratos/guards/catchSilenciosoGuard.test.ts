/**
 * C13 — catchSilencioso: ningún catch traga el error sin registrarlo.
 * Nace ROJO (160 bloques catch sin log ni propagación).
 * Heurística de cuerpo: se considera manejado si el bloque registra o propaga.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const HANDLED =
  /\b(throw|console\.|relayLog|logger|log\w*\s*\(|report\w*\s*\(|reject\s*\(|notification|setError|onError|emit\w*\s*\()/
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

describe('C13 catchSilencioso — todo catch registra o propaga', () => {
  it('no hay bloques catch que traguen el error', () => {
    const offenders: string[] = []
    for (const f of walk(SRC)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      const src = readFileSync(f, 'utf8')
      const re = /catch\s*(?:\([^)]*\))?\s*\{/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) {
        const open = src.indexOf('{', m.index)
        let depth = 0
        let i = open
        for (; i < src.length; i += 1) {
          if (src[i] === '{') depth += 1
          else if (src[i] === '}') {
            depth -= 1
            if (depth === 0) break
          }
        }
        const body = src.slice(open + 1, i)
        if (!HANDLED.test(body)) {
          const line = src.slice(0, m.index).split('\n').length
          offenders.push(`${r}:${line}:catch sin log/propagación`)
        }
      }
    }
    expect(
      offenders,
      `Catches silenciosos (N=${offenders.length}):\n  ${offenders.slice(0, 40).join('\n  ')}${offenders.length > 40 ? '\n  …' : ''}`,
    ).toEqual([])
  })
})
