/**
 * C31 — voiceProfilesLocalStorage: los perfiles de voz viven solo en Dexie.
 * Nace ROJO (backupSystem usa localStorage STORAGE_KEYS.VOICE_PROFILES).
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const CONFIG = 'src/core/config/appConfig.ts'
const RE = /STORAGE_KEYS\.VOICE_PROFILES/

describe('C31 voiceProfilesLocalStorage — perfiles solo en Dexie', () => {
  it('ningún módulo duplica los perfiles en localStorage', () => {
    const files = walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)
      .filter((f) => {
        const r = relative(ROOT, f).replace(/\\/g, '/')
        return r !== CONFIG && RE.test(readFileSync(f, 'utf8'))
      })
      .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
      .sort()
    expect(
      files,
      `Duplican perfiles en localStorage (N=${files.length}):\n  ${files.join('\n  ')}`,
    ).toEqual([])
  })
})

/** P2.4 - prueba de DETECTOR: el predicado del guard marca una entrada infractora
 *  sintetica y PERDONA una limpia. Si alguien lo neutra (regex vacio, `true`...),
 *  este caso cae; el bucle sobre src que lo aplica lo cubre la asercion de arriba. */
describe('P2.4 voiceProfilesLocalStorageGuard - el detector no es decorativo', () => {
  it('marca una entrada infractora y no marca una limpia', () => {
    const pred = (texto: string) => RE.test(texto)
    expect(pred("localStorage.setItem(STORAGE_KEYS.VOICE_PROFILES, x)")).toBe(true)
    expect(pred("localStorage.setItem(STORAGE_KEYS.PARTICIPANTS, x)")).toBe(false)
  })
})
