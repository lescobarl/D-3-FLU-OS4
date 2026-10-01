/**
 * C1 — vozInstanciaUnica: UNA sola puerta de instancia de reconocimiento (§9.1).
 *
 * `src/voice/lib/speechRecognitionLocal.js` se declara a sí mismo como la ÚNICA
 * puerta de creación (`createSpeechRecognition`/`acquireSpeechRecognition`).
 * Cualquier `new Recognition()` / `new SpeechRecognition()` fuera de ese módulo
 * esquiva el lock de escucha única (start/stop centralizados).
 *
 * Nace ROJO (AsrLab instancia reconocimiento por su cuenta) y pasa cuando todo
 * consumidor usa la fábrica central.
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const CENTRAL = 'src/voice/lib/speechRecognitionLocal.js'
const RE = /new\s+Recognition\s*\(|new\s+(?:window\.)?(?:webkit)?SpeechRecognition\s*\(/

/** Instancias de reconocimiento creadas en un fuente (mismo criterio del guard). */
export function newRecognitionCalls(src: string, file: string): string[] {
  const offenders: string[] = []
  src.split(/\r?\n/).forEach((line, i) => {
    if (RE.test(line)) offenders.push(`${file}:${i + 1}:${line.trim().slice(0, 110)}`)
  })
  return offenders
}

describe('C1 vozInstanciaUnica — una sola puerta de instancia (§9.1)', () => {
  it('ninguna instancia de reconocimiento se crea fuera de speechRecognitionLocal.js', () => {
    const offenders: string[] = []
    for (const f of walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      if (r === CENTRAL) continue
      offenders.push(...newRecognitionCalls(readFileSync(f, 'utf8'), r))
    }
    expect(
      offenders,
      `Instancias fuera de la puerta única (N=${offenders.length}); usa acquireSpeechRecognition:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

// P2.4 - prueba de detector: alimentado el infractor sintetico, la marca.
describe('C1 vozInstanciaUnica - el detector no es decorativo', () => {
  it('marca la instancia directa y deja pasar la fabrica', () => {
    expect(newRecognitionCalls('const r = new Recognition()', 'f.js')).toHaveLength(1)
    expect(newRecognitionCalls('const r = new window.SpeechRecognition()', 'f.js')).toHaveLength(1)
    expect(newRecognitionCalls('const r = acquireSpeechRecognition()', 'f.js')).toEqual([])
  })
})