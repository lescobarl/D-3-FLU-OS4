/**
 * voiceDisplaySingleSource — Invariante §9.3: UNA SOLA derivación de la frase visible.
 *
 * Nace ROJO (§10.2): lista `archivo:línea:contenido` mientras existan derivaciones
 * competidoras de "última frase" fuera del selector canónico `selectVisiblePhrase`.
 *
 *   C1  sin derivación muerta `phraseDisplay` (App re-derivaba la frase).
 *   C2  `listenParity` usa la lib única `evaluateListenParity` (sin re-normalizar inline).
 *   C3  la última frase del usuario se deriva por `deriveUserLastText` (sin escaneo inline).
 *   C4  `selectVisiblePhrase` es el ÚNICO selector de frase visible.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) acc.push(p)
  }
  return acc
}

const FILES = walk(SRC)
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/')
const fileLines = (f: string) => readFileSync(f, 'utf8').split(/\r?\n/)
const stripLineComment = (line: string) => {
  const trimmed = line.trim()
  if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) return ''
  return line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '')
}

function grep(re: RegExp, files: string[]): string[] {
  const out: string[] = []
  for (const f of files) {
    fileLines(f).forEach((raw, index) => {
      const line = stripLineComment(raw)
      re.lastIndex = 0
      if (re.test(line)) out.push(`${rel(f)}:${index + 1}:${line.trim().slice(0, 110)}`)
    })
  }
  return out
}

const count = (re: RegExp, files: string[]) => grep(re, files).length

describe('voiceDisplaySingleSource — 1 sola derivación de frase visible (§9.3)', () => {
  it('C1 — no existe `phraseDisplay` (derivación muerta)', () => {
    const findings = grep(/phraseDisplay/, FILES)
    expect(
      findings,
      `Derivaciones competidoras de display (N=${findings.length}); debe quedar 0:\n  ${findings.join('\n  ')}`,
    ).toEqual([])
  })

  it('C2 — listenParity usa la lib única (sin re-normalizar inline)', () => {
    const inline = grep(/liveNorm/, [join(SRC, 'App.tsx')])
    expect(
      inline,
      `Normalización inline de listenParity (N=${inline.length}); usar evaluateListenParity:\n  ${inline.join('\n  ')}`,
    ).toEqual([])
    const lib = grep(/evaluateListenParity\s*\(/, FILES)
    expect(
      lib.length,
      `listenParity debe consumir evaluateListenParity (N=${lib.length})`,
    ).toBeGreaterThanOrEqual(1)
  })

  it('C3 — última frase del usuario se deriva por la lib (sin escaneo inline)', () => {
    const defined = count(/export function deriveUserLastText/, FILES)
    expect(defined, `deriveUserLastText debe definirse 1 vez (N=${defined})`).toBe(1)
    const used = grep(/deriveUserLastText\s*\(/, [join(SRC, 'App.tsx')])
    expect(
      used.length,
      `App debe consumir deriveUserLastText (N=${used.length})`,
    ).toBeGreaterThanOrEqual(1)
  })

  it('C4 — `selectVisiblePhrase` es el ÚNICO selector de frase visible', () => {
    const definition = count(/export function selectVisiblePhrase/, FILES)
    const uses = count(/selectVisiblePhrase\s*\(/, FILES) - definition
    expect(definition, `selectVisiblePhrase debe definirse 1 vez (N=${definition})`).toBe(1)
    expect(uses, `selectVisiblePhrase debe usarse al menos 1 vez (N=${uses})`).toBeGreaterThanOrEqual(1)
  })
})
