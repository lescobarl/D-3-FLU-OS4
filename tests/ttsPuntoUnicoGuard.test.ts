/**
 * C21 — ttsPuntoUnico: un solo punto de síntesis de voz.
 * Nace ROJO (8 archivos tocan speechSynthesis).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
// Mide IMPLEMENTACION, no el literal (AGENTS.md 7.7.d): construccion del
// utterance, acceso al motor y llamadas al motor. Case-insensitive: el literal
// /speechSynthesis/ era ciego a `SpeechSynthesisUtterance` y `getSpeechEngine`.
const RE =
  /new\s+SpeechSynthesisUtterance\s*\(|getSpeechEngine\s*\(|getSpeechSynthesis\s*\(|speechSynthesis\.(?:speak|cancel|getVoices|resume)\s*\(/i
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

describe('C21 ttsPuntoUnico — un solo punto de TTS', () => {
  it('un único módulo usa speechSynthesis', () => {
    const files = walk(SRC)
      .filter((f) => RE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
      .sort()
    expect(
      files,
      `Usuarios de speechSynthesis (N=${files.length}); debe quedar 1:\n  ${files.join('\n  ')}`,
    ).toHaveLength(1)
  })
})
