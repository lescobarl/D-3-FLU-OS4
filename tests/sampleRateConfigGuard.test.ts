/**
 * C29 — sampleRateConfig: el sample rate sale de config.
 * Nace ROJO (10 literales 48000 en useFluVoiceAssistant.js).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const TARGET = 'src/voice/hooks/useFluVoiceAssistant.js'
const RE = /\b48000\b/

describe('C29 sampleRateConfig — sample rate desde config', () => {
  it('no hay literales de sample rate en el motor', () => {
    const offenders: string[] = []
    readFileSync(join(ROOT, TARGET), 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (RE.test(line)) offenders.push(`${TARGET}:${i + 1}:${line.trim().slice(0, 110)}`)
      })
    expect(
      offenders,
      `Literales de sample rate (N=${offenders.length}); usa FLU_CONFIG:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
