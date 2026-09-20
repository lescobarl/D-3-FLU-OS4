/**
 * C34 — fallbackResponses: sin módulo muerto de respuestas de fallback.
 * Nace ROJO (src/services/fallbackResponses.ts existe sin importador de producción).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const DEAD = 'src/services/fallbackResponses.ts'

describe('C34 fallbackResponses — sin módulo muerto', () => {
  it('el módulo fallbackResponses está eliminado', () => {
    expect(existsSync(join(ROOT, DEAD)), `Sigue existiendo ${DEAD}`).toBe(false)
  })
})
