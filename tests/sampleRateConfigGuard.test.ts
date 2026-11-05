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

/**
 * Predicado del guard (expuesto para poder FALSIFICARLO con una entrada
 * sintetica): literales de sample rate en `src`.
 */
export function sampleRateLiterals(src: string): string[] {
  const offenders: string[] = []
  src.split(/\r?\n/).forEach((line, i) => {
    if (RE.test(line)) offenders.push(`${TARGET}:${i + 1}:${line.trim().slice(0, 110)}`)
  })
  return offenders
}

describe('C29 sampleRateConfig — sample rate desde config', () => {
  it('no hay literales de sample rate en el motor', () => {
    const offenders = sampleRateLiterals(readFileSync(join(ROOT, TARGET), 'utf8'))
    expect(
      offenders,
      `Literales de sample rate (N=${offenders.length}); usa FLU_CONFIG:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

// P2.4 — prueba de detector: alimentado el infractor sintetico, la marca.
describe('C29 sampleRateConfig — el detector no es decorativo', () => {
  it('marca el literal 48000 y no el valor que sale de config', () => {
    expect(sampleRateLiterals('new AudioContext({ sampleRate: 48000 })')).toHaveLength(1)
    expect(sampleRateLiterals('new AudioContext({ sampleRate: getVoiceSampleRate() })')).toHaveLength(0)
  })
})
