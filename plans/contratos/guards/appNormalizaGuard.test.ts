/**
 * C25 — appNormaliza: App no re-normaliza la frase canónica (§9.2).
 * Nace ROJO (4 llamadas a normalizeCommandForDeterministic/actionBelongsToTranscript).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const TARGET = 'src/App.tsx'
const RE = /normalizeCommandForDeterministic\s*\(|actionBelongsToTranscript\s*\(/
const strip = (line: string) => {
  const t = line.trim()
  if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return ''
  return line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '')
}

describe('C25 appNormaliza — App no re-normaliza', () => {
  it('App no normaliza la frase ya canónica', () => {
    const offenders: string[] = []
    readFileSync(join(ROOT, TARGET), 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (RE.test(strip(line))) offenders.push(`${TARGET}:${i + 1}:${line.trim().slice(0, 110)}`)
      })
    expect(
      offenders,
      `Re-normalización en App (N=${offenders.length}):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
