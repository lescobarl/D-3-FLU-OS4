/**
 * C21 — ttsPuntoUnico: un solo punto de síntesis de voz.
 * Nace ROJO (8 archivos tocan speechSynthesis).
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
// Mide IMPLEMENTACION, no el literal (AGENTS.md 7.7.d): construccion del
// utterance, acceso al motor y llamadas al motor. Case-insensitive: el literal
// /speechSynthesis/ era ciego a `SpeechSynthesisUtterance` y `getSpeechEngine`.
const RE =
  /new\s+SpeechSynthesisUtterance\s*\(|getSpeechEngine\s*\(|getSpeechSynthesis\s*\(|speechSynthesis\.(?:speak|cancel|getVoices|resume)\s*\(/i


describe('C21 ttsPuntoUnico — un solo punto de TTS', () => {
  it('un único módulo usa speechSynthesis', () => {
    const files = walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)
      .filter((f) => RE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
      .sort()
    expect(
      files,
      `Usuarios de speechSynthesis (N=${files.length}); debe quedar 1:\n  ${files.join('\n  ')}`,
    ).toHaveLength(1)
  })
})

/** P2.4 - prueba de DETECTOR: el predicado del guard marca una entrada infractora
 *  sintetica y PERDONA una limpia. Si alguien lo neutra (regex vacio, `true`...),
 *  este caso cae; el bucle sobre src que lo aplica lo cubre la asercion de arriba. */
describe('P2.4 ttsPuntoUnicoGuard - el detector no es decorativo', () => {
  it('marca una entrada infractora y no marca una limpia', () => {
    const pred = (texto: string) => RE.test(texto)
    expect(pred("new SpeechSynthesisUtterance(t)")).toBe(true)
    expect(pred("const s = engine.speak(t)")).toBe(false)
  })
})
