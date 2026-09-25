/**
 * C38 — umbralesConfig: los umbrales de autonomía/voz salen de config.
 * Nace ROJO (4 módulos con umbrales 0.xx inline).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const FILES = [
  'src/voice/lib/speakerDiarization.js',
  'src/core/autonomy/healthMonitor.ts',
  'src/core/autonomy/decisionEngine.ts',
  'src/core/autonomy/autoOptimization.ts',
  'src/lib/participantProfiles.ts',
]
const RE = /0\.[0-9]{2}/

describe('C38 umbralesConfig — umbrales desde config', () => {
  it('ningún módulo define umbrales numéricos inline', () => {
    const offenders = FILES.filter((p) => existsSync(join(ROOT, p)) && RE.test(readFileSync(join(ROOT, p), 'utf8')))
    expect(
      offenders,
      `Módulos con umbrales inline (N=${offenders.length}):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
