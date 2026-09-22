/**
 * C13 — catchSilencioso: ningún catch traga el error sin registrarlo.
 *
 * Criterio endurecido: cuenta como manejo PROPAGAR (throw/reject/emit,
 * setError/onError), REGISTRAR en el registro central
 * (logCaughtError/relayLog/auditLog/systemEventLog) o declarar una omisión
 * deliberada con la marca `ignorado:`. `console.*` NO cuenta (AGENTS.md 2.6):
 * con la regla anterior, `console.warn('[catch] ...')` daba el guard por verde
 * mientras 296 bloques no registraban nada.
 *
 * El segundo describe comprueba el propio detector: un guard de conteo que
 * nunca puede fallar no es una barrera (AGENTS.md 0.12).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const HANDLED =
  /\b(throw|relayLog|logCaughtError|systemEventLog|auditLog|logAudit|reportError|reject\s*\(|setError|onError|emit\w*\s*\()|ignorado:/

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

/** Líneas de los `catch` cuyo cuerpo no registra ni propaga el error. */
function findSilent(src: string): number[] {
  const lines: number[] = []
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
    if (!HANDLED.test(src.slice(open + 1, i))) {
      lines.push(src.slice(0, m.index).split('\n').length)
    }
  }
  return lines
}

describe('C13 catchSilencioso — todo catch registra o propaga', () => {
  it('no hay bloques catch que traguen el error', () => {
    const offenders: string[] = []
    for (const f of walk(SRC)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      for (const line of findSilent(readFileSync(f, 'utf8'))) {
        offenders.push(`${r}:${line}:catch sin registro ni propagación`)
      }
    }
    expect(
      offenders,
      `Catches silenciosos (N=${offenders.length}):\n  ${offenders.slice(0, 40).join('\n  ')}${
        offenders.length > 40 ? '\n  …' : ''
      }`,
    ).toEqual([])
  })
})

describe('C13 catchSilencioso — el detector no es decorativo', () => {
  it('marca un catch que solo hace console.warn (la regla vieja lo daba por bueno)', () => {
    expect(findSilent('try { f() } catch (e) { console.warn("x", e) }')).toHaveLength(1)
  })

  it('no marca un catch que registra en el registro central', () => {
    expect(findSilent('try { f() } catch (e) { logCaughtError("x", e) }')).toHaveLength(0)
  })

  it('no marca un catch que propaga', () => {
    expect(findSilent('try { f() } catch (e) { throw new Error(String(e)) }')).toHaveLength(0)
  })

  it('no marca un catch con omisión declarada', () => {
    expect(findSilent('try { f() } catch { /* ignorado: caso esperado */ }')).toHaveLength(0)
  })
})
