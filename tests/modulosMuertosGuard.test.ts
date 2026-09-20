/**
 * C16 — modulosMuertos: sin módulos muertos conocidos.
 * Nace ROJO (15 archivos existen: 14 de src/lib + voice/lib/localTranslate.js).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const DEAD = [
  'src/lib/conversationFlow.ts',
  'src/lib/emotionalState.ts',
  'src/lib/exportUtils.ts',
  'src/lib/forgettingCurve.ts',
  'src/lib/goalTracker.ts',
  'src/lib/longTermMemory.ts',
  'src/lib/memoryConsolidation.ts',
  'src/lib/minuteSuggester.ts',
  'src/lib/participantProfiles.ts',
  'src/lib/preferenceLearner.ts',
  'src/lib/proactiveEngine.ts',
  'src/lib/theoryOfMind.ts',
  'src/lib/transcriptQuality.ts',
  'src/lib/userEmotionDetector.ts',
  'src/voice/lib/localTranslate.js',
]

describe('C16 modulosMuertos — sin módulos muertos', () => {
  it('los módulos sin importador de producción están eliminados', () => {
    const remaining = DEAD.filter((p) => existsSync(join(ROOT, p)))
    expect(
      remaining,
      `Módulos muertos que siguen existiendo (N=${remaining.length}):\n  ${remaining.join('\n  ')}`,
    ).toEqual([])
  })
})
