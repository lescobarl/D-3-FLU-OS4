/**
 * C3 — voiceProfilesEscritorUnico: UN solo escritor de la tabla de perfiles de voz.
 *
 * Hoy escriben la tabla: `useVoiceProfiles.ts` (servicio), `fluStorage.js`
 * (CRUD legacy) y `App.tsx` (borrado directo). Tres rutas para la misma
 * intención (§2.8): una debe quedar.
 *
 * Nace ROJO (3 escritores) y pasa cuando solo `useVoiceProfiles.ts` escribe.
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const SINGLE = 'src/hooks/useVoiceProfiles.ts'
const RE = /fluDb\.voiceProfiles\.(?:put|add|delete|bulkDelete)\s*\(/

describe('C3 voiceProfilesEscritorUnico — un solo escritor de perfiles de voz', () => {
  it('solo useVoiceProfiles.ts escribe fluDb.voiceProfiles', () => {
    const writers = walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)
      .filter((f) => RE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
      .sort()
    expect(
      writers,
      `Escritores de fluDb.voiceProfiles (N=${writers.length}); debe quedar 1 (${SINGLE}):\n  ${writers.join('\n  ')}`,
    ).toEqual([SINGLE])
  })
})

/** P2.4 - prueba de DETECTOR: el predicado del guard marca una entrada infractora
 *  sintetica y PERDONA una limpia. Si alguien lo neutra (regex vacio, `true`...),
 *  este caso cae; el bucle sobre src que lo aplica lo cubre la asercion de arriba. */
describe('P2.4 voiceProfilesEscritorUnicoGuard - el detector no es decorativo', () => {
  it('marca una entrada infractora y no marca una limpia', () => {
    const pred = (texto: string) => RE.test(texto)
    expect(pred("fluDb.voiceProfiles.put(p)")).toBe(true)
    expect(pred("fluDb.participants.put(p)")).toBe(false)
  })
})
