/**
 * C36 — consumidoresNorm: los consumidores no re-normalizan (§9.2).
 * Nace ROJO (10 llamadas en generationTopic, agendaCommandParser, noteIntentParser).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const FILES = [
  'src/lib/generationTopic.ts',
  'src/core/agenda/agendaCommandParser.ts',
  'src/voice/lib/noteIntentParser.js',
]
const RE =
  /(?:cleanForSpeech|normalizeTranscriptText|stripWakeWord|stripWakeWordAnywhere|collapseStutter|normalizeCommandForDeterministic)\s*\(/
const strip = (line: string) => {
  const t = line.trim()
  if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return ''
  return line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '')
}

describe('C36 consumidoresNorm — consumidores no re-normalizan', () => {
  it('ningún consumidor llama normalizadores de la frase canónica', () => {
    const offenders: string[] = []
    for (const p of FILES) {
      readFileSync(join(ROOT, p), 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          const s = strip(line)
          if (/^\s*import/.test(s)) return
          if (RE.test(s)) offenders.push(`${p}:${i + 1}:${line.trim().slice(0, 110)}`)
        })
    }
    expect(
      offenders,
      `Re-normalización en consumidores (N=${offenders.length}):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
