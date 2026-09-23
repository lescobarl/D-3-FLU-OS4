/**
 * C6 ΓÇö wakeWordRuntime: la wake word en runtime sale de FLU_CONFIG (┬º9.4).
 *
 * El criterio se DERIVA de `FLU_WAKE_WORDS` en fluConfig.js en vez de copiarse a
 * mano: antes cubria 2 de las 16 variantes (`/ok\s*flu|okay\s*flow/`) y dejaba
 * pasar 'oye flu', 'hey flu', 'okay flu', 'ok flow'... (guard teatro). Al derivarla,
 * anadir una wake word a la config amplia el guard solo.
 *
 * El segundo describe comprueba el detector (AGENTS.md ┬ºB11/B12): un guard que no
 * distingue el defecto no es barrera.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const CONFIG = 'src/voice/lib/fluConfig.js'
const CANONICAL_COUNT = 16
const strip = (line: string) => {
  const t = line.trim()
  if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return ''
  return line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '')
}
/** Wake words canonicas, leidas de la config (fuente unica, ┬º9.4). */
function readWakeWords(): string[] {
  const src = readFileSync(join(ROOT, CONFIG), 'utf8')
  const block = src.match(/FLU_WAKE_WORDS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/)
  if (!block) throw new Error(`No se pudo leer FLU_WAKE_WORDS de ${CONFIG}`)
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const WAKE_WORDS = readWakeWords()
const WAKE_RE = new RegExp(
  `\\b(?:${WAKE_WORDS.map((w) => w.trim().split(/\s+/).map(escapeRe).join('\\s+')).join('|')})\\b`,
  'i',
)
/** true si la linea usa una wake word en codigo (no en comentario). */
function isWakeLiteral(line: string): boolean {
  return WAKE_RE.test(strip(line))
}
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}
describe('C6 wakeWordRuntime ΓÇö wake word solo de config', () => {
  it('la config conserva las variantes canonicas (4 prefijos x 4 alias ASR)', () => {
    expect(WAKE_WORDS.length).toBeGreaterThanOrEqual(CANONICAL_COUNT)
  })
  it('no hay wake words en codigo fuera de fluConfig.js', () => {
    const offenders: string[] = []
    for (const f of walk(SRC)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      if (r === CONFIG) continue
      readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (isWakeLiteral(line)) offenders.push(`${r}:${i + 1}:${line.trim().slice(0, 110)}`)
        })
    }
    expect(
      offenders,
      `Wake words hardcodeadas en runtime (N=${offenders.length}):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
describe('C6 wakeWordRuntime ΓÇö el detector no es decorativo', () => {
  it('detecta las 16 variantes (la regex vieja solo cubria 2)', () => {
    const missed = WAKE_WORDS.filter((w) => !isWakeLiteral(`if (t === '${w}') return true`))
    expect(missed, `Variantes que el guard NO detecta: ${missed.join(', ')}`).toEqual([])
  })
  it('detecta una wake word dentro de un literal entrecomillado', () => {
    expect(isWakeLiteral("const A = ['oye flu', 'hey flow']")).toBe(true)
  })
  it('no marca un comentario', () => {
    expect(isWakeLiteral('// ok flu')).toBe(false)
    expect(isWakeLiteral('* di la wake word para empezar')).toBe(false)
  })
  it('no marca identificadores que solo contienen FLU', () => {
    expect(isWakeLiteral('FLU_CONFIG.voiceCommands.wakeWords')).toBe(false)
    expect(isWakeLiteral('const FLU_WAKE_WORDS = []')).toBe(false)
  })
})
