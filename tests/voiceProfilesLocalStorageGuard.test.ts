/**
 * C31 — voiceProfilesLocalStorage: los perfiles de voz viven solo en Dexie.
 * Nace ROJO (backupSystem usa localStorage STORAGE_KEYS.VOICE_PROFILES).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const CONFIG = 'src/core/config/appConfig.ts'
const RE = /STORAGE_KEYS\.VOICE_PROFILES/
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

describe('C31 voiceProfilesLocalStorage — perfiles solo en Dexie', () => {
  it('ningún módulo duplica los perfiles en localStorage', () => {
    const files = walk(SRC)
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
