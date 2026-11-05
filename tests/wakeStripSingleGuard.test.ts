/**
 * C28 — wakeStripSingle: una sola implementación de strip de wake word (§9.2).
 * Nace ROJO (5 funciones exportadas).
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const RE =
  /export function (?:stripWakeWord|stripWakeWordAnywhere|removeWakeWord|splitTranscriptAtWakeWord|stripWakeWordForDisplay)\s*\(/

describe('C28 wakeStripSingle — una sola implementación de strip', () => {
  it('una única implementación de strip de wake word', () => {
    const impls: string[] = []
    for (const f of walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (RE.test(line)) impls.push(`${r}:${i + 1}:${line.trim().slice(0, 110)}`)
        })
    }
    expect(
      impls,
      `Implementaciones de strip (N=${impls.length}); debe quedar 1:\n  ${impls.join('\n  ')}`,
    ).toHaveLength(1)
  })
})

/** P2.4 - prueba de DETECTOR: el predicado del guard marca una entrada infractora
 *  sintetica y PERDONA una limpia. Si alguien lo neutra (regex vacio, `true`...),
 *  este caso cae; el bucle sobre src que lo aplica lo cubre la asercion de arriba. */
describe('P2.4 wakeStripSingleGuard - el detector no es decorativo', () => {
  it('marca una entrada infractora y no marca una limpia', () => {
    const pred = (texto: string) => RE.test(texto)
    expect(pred("export function stripWakeWord(text) {")).toBe(true)
    expect(pred("export function quitaAcentos(text) {")).toBe(false)
  })
})
