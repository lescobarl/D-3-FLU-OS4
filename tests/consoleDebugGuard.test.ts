/**
 * C35 — consoleDebug: sin console.debug residual, y sin console.* como registro
 * de un catch (debe ir a logCaughtError, AGENTS.md 2.6).
 *
 * Nace ROJO (12 console.debug). AMPLIADO (auditoria 2026-10-02): el guard solo
 * miraba console.debug, asi que 9 sitios registraban un catch con console.error/
 * warn sin que nadie lo viera (deepseek, useAppAnalysis, useDocumentAnalysis,
 * useDocumentGeneration, useFluVoiceAssistant). Se detecta console.* DENTRO de un
 * bloque catch/.catch, con exencion para codigo gateado por IS_DEV.
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

/** El unico sitio que puede registrar con console: es EL logger (su razon de ser). */
const ALLOWLIST = new Set(['src/lib/caughtError.ts'])
const CATCH_START = /\bcatch\b\s*(\([^)]*\))?\s*\{|\.catch\s*\(/
const CONSOLE = /console\.(error|warn|log|info)\b/
const DEV_GATED = /IS_DEV|import\.meta\.env\.DEV/

/**
 * Detector PURO: lineas con console.* DENTRO de un bloque catch/.catch (emparejando
 * llaves desde la apertura). Exenta las lineas gateadas por IS_DEV/import.meta.env.DEV.
 */
export function findConsoleInCatch(content: string, file = 'src/sintetico.ts'): string[] {
  const lines = content.split(/\r?\n/)
  const out: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    if (!CATCH_START.test(lines[i])) continue
    const abre = lines[i].indexOf('{', lines[i].search(/\bcatch\b|\.catch/))
    if (abre < 0) continue
    let depth = 0
    let j = i
    for (; j < lines.length; j += 1) {
      const seg = j === i ? lines[i].slice(abre) : lines[j]
      for (const ch of seg) {
        if (ch === '{') depth += 1
        else if (ch === '}') depth -= 1
      }
      if (depth <= 0) break
    }
    const cabeceraDev = DEV_GATED.test(lines[i])
    for (let k = i; k <= j && k < lines.length; k += 1) {
      if (CONSOLE.test(lines[k]) && !cabeceraDev && !DEV_GATED.test(lines[k])) {
        out.push(`${file}:${k + 1}:${lines[k].trim().slice(0, 110)}`)
      }
    }
    i = j
  }
  return out
}

describe('C35 consoleDebug — sin console.debug ni console.* en catch', () => {
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

  it('ningun catch registra con console.* (usar logCaughtError)', () => {
    const offenders: string[] = []
    for (const f of walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      if (ALLOWLIST.has(r)) continue
      offenders.push(...findConsoleInCatch(readFileSync(f, 'utf8'), r))
    }
    expect(
      offenders,
      `console.* dentro de catch (N=${offenders.length}); usar logCaughtError:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

/** P2.4: el detector no es decorativo; marca una entrada infractora y perdona una limpia. */
describe('P2.4 consoleDebugGuard - el detector no es decorativo', () => {
  it('marca una entrada infractora sintetica y no marca una limpia', () => {
    expect(findOffenders("console.debug('rastro')", 'src/sintetico.ts')).toHaveLength(1)
    expect(findOffenders("console.warn('aviso')", 'src/sintetico.ts')).toHaveLength(0)
  })

  it('marca console.error DENTRO de un catch y no fuera', () => {
    const sucio = ['try {', "  x()", '} catch (e) {', "  console.error('boom', e)", '}'].join('\n')
    expect(findConsoleInCatch(sucio, 'src/sintetico.ts')).toHaveLength(1)
    const limpio = "console.error('fuera de catch')"
    expect(findConsoleInCatch(limpio, 'src/sintetico.ts')).toHaveLength(0)
    const conLog = ['try {', '  x()', '} catch (e) {', '  logCaughtError("m", e)', '}'].join('\n')
    expect(findConsoleInCatch(conLog, 'src/sintetico.ts')).toHaveLength(0)
  })

  it('exenta el codigo gateado por IS_DEV', () => {
    const dev = ['try {', '  x()', '} catch (e) {', '  if (IS_DEV) console.warn("m", e)', '}'].join('\n')
    expect(findConsoleInCatch(dev, 'src/sintetico.ts')).toHaveLength(0)
  })
})
