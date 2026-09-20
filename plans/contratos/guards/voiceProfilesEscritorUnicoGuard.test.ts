/**
 * C3 — voiceProfilesEscritorUnico: UN solo escritor de la tabla de perfiles de voz.
 *
 * Hoy escriben la tabla: `useVoiceProfiles.ts` (servicio), `fluStorage.js`
 * (CRUD legacy) y `App.tsx` (borrado directo). Tres rutas para la misma
 * intención (§2.8): una debe quedar.
 *
 * Nace ROJO (3 escritores) y pasa cuando solo `useVoiceProfiles.ts` escribe.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const SINGLE = 'src/hooks/useVoiceProfiles.ts'
const RE = /fluDb\.voiceProfiles\.(?:put|add|delete|bulkDelete)\s*\(/

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) acc.push(p)
  }
  return acc
}

describe('C3 voiceProfilesEscritorUnico — un solo escritor de perfiles de voz', () => {
  it('solo useVoiceProfiles.ts escribe fluDb.voiceProfiles', () => {
    const writers = walk(SRC)
      .filter((f) => RE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
      .sort()
    expect(
      writers,
      `Escritores de fluDb.voiceProfiles (N=${writers.length}); debe quedar 1 (${SINGLE}):\n  ${writers.join('\n  ')}`,
    ).toEqual([SINGLE])
  })
})
