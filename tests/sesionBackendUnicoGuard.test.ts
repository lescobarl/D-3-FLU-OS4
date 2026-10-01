/**
 * C9 — sesionBackendUnico: un solo backend de sesión (Dexie o localStorage).
 * Nace ROJO (2 backends: useSessionPersistence localStorage y fluStorage Dexie).
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const RE = /flu-session-state|fluDb\.sessionState/

describe('C9 sesionBackendUnico — un solo backend de sesión', () => {
  it('un único archivo implementa la persistencia de sesión', () => {
    const backends = walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)
      .filter((f) => RE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
      .sort()
    expect(
      backends,
      `Backends de sesión (N=${backends.length}); debe quedar 1:\n  ${backends.join('\n  ')}`,
    ).toHaveLength(1)
  })
})

/** P2.4 - prueba de DETECTOR: el predicado del guard marca una entrada infractora
 *  sintetica y PERDONA una limpia. Si alguien lo neutra (regex vacio, `true`...),
 *  este caso cae; el bucle sobre src que lo aplica lo cubre la asercion de arriba. */
describe('P2.4 sesionBackendUnicoGuard - el detector no es decorativo', () => {
  it('marca una entrada infractora y no marca una limpia', () => {
    const pred = (texto: string) => RE.test(texto)
    expect(pred("localStorage.setItem('flu-session-state', x)")).toBe(true)
    expect(pred("const k = SESSION_STORE")).toBe(false)
  })
})
