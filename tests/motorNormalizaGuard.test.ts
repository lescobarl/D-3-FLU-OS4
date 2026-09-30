/**
 * C39 — motorNormaliza: el motor no usa un segundo normalizador ni re-deriva
 * la frase tras el commit (§9.2/§9.3).
 * Nace ROJO (normalizeTranscriptText en :1705 y cleanForSpeech(wakeAnalysis.afterWake) en :3725).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const TARGET = 'src/voice/hooks/useFluVoiceAssistant.js'
const strip = (line: string) => {
  const t = line.trim()
  if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return ''
  return line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '')
}

/**
 * Predicado del guard (expuesto para poder FALSIFICARLO con una entrada
 * sintetica, sin tocar el motor real): lineas de `src` que re-normalizan o
 * re-derivan la frase canonica.
 */
export function findReNormalizaciones(src: string): string[] {
  const offenders: string[] = []
  src.split(/\r?\n/).forEach((line, i) => {
    const s = strip(line)
    if (/normalizeTranscriptText\s*\(/.test(s)) offenders.push(`${TARGET}:${i + 1}:${line.trim().slice(0, 110)}`)
    if (/cleanForSpeech\(\s*wakeAnalysis\.afterWake/.test(s))
      offenders.push(`${TARGET}:${i + 1}:${line.trim().slice(0, 110)}`)
  })
  return offenders
}

describe('C39 motorNormaliza — sin segundo normalizador ni re-derivación', () => {
  it('el motor no re-normaliza ni re-deriva la frase canónica', () => {
    const offenders = findReNormalizaciones(readFileSync(join(ROOT, TARGET), 'utf8'))
    expect(
      offenders,
      `Re-normalización en el motor (N=${offenders.length}):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

// P2.4 — prueba de detector: alimentado el infractor sintetico, la marca.
describe('C39 motorNormaliza — el detector no es decorativo', () => {
  it('marca la re-normalizacion sintetica y deja pasar la frase limpia', () => {
    expect(findReNormalizaciones('const a = normalizeTranscriptText(text)')).toHaveLength(1)
    expect(findReNormalizaciones('commitVisibleTranscript(cleanForSpeech(wakeAnalysis.afterWake))')).toHaveLength(1)
    expect(findReNormalizaciones('commitVisibleTranscript(cleanForSpeech(phrase))')).toHaveLength(0)
    expect(findReNormalizaciones('// normalizeTranscriptText(text)')).toHaveLength(0)
  })
})
