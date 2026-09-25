/**
 * C45 - onboardingSingleStore: el estado de onboarding vive SOLO en Dexie.
 *
 * CONTEXTO MEDIDO: ademas de la tabla Dexie onboardingStates (gateway unico, C44),
 * el onboarding se persistia en localStorage con las claves
 * flu-onboarding-completed / flu-onboarding-step para la fase "sin participante"
 * (useOnboarding) y App.tsx las borraba por su cuenta en tres sitios. Dos
 * almacenes para el mismo dato, y el de localStorage solo conservaba el flag
 * "completado": la sesion incompleta ya se auto-sanaba al recargar.
 *
 * Ahora la fase sin participante es EFIMERA (memoria) y al completar App registra
 * al participante y siembra su estado en Dexie (persistForParticipant). Las claves
 * legacy se retiran del todo (appConfig incluido).
 *
 * REGLA: las claves legacy no pueden reaparecer en src/ y useOnboarding.ts no
 * puede tocar localStorage para nada que no sea el espejo del nombre (nameKey).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const LEGACY = /ONBOARDING_COMPLETED|ONBOARDING_STEP|flu-onboarding-completed|flu-onboarding-step/
const LOCAL = /localStorage\.(?:setItem|getItem|removeItem)\s*\(/
const isCommentLine = (line: string) => /^\s*(?:\/\/|\*|\/\*)/.test(line)
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx)$/.test(e)) acc.push(p)
  }
  return acc
}
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/')
/** Referencias vivas a las claves legacy de onboarding (fuera de comentarios). */
export function legacyOnboardingHits(files: string[] = walk(SRC)): string[] {
  const hits: string[] = []
  for (const f of files) {
    readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (!isCommentLine(line) && LEGACY.test(line)) hits.push(rel(f) + ':' + (i + 1))
      })
  }
  return hits
}
/** Lineas con acceso a localStorage que NO son el espejo del nombre (nameKey). */
export function localStorageOutsideNameKey(src: string): number[] {
  const bad: number[] = []
  src.split(/\r?\n/).forEach((line, i) => {
    if (!isCommentLine(line) && LOCAL.test(line) && !line.includes('nameKey')) bad.push(i + 1)
  })
  return bad
}
describe('C45 onboardingSingleStore - estado de onboarding solo en Dexie', () => {
  it('ninguna referencia viva a las claves legacy en src/', () => {
    const hits = legacyOnboardingHits()
    expect(hits, 'Claves legacy de onboarding vivas: ' + hits.join(', ')).toEqual([])
  })
  it('src/ no nombra el lector legacy retirado', () => {
    const hits = walk(SRC).filter((f) => /readLegacyOnboarding/.test(readFileSync(f, 'utf8')))
    expect(hits.map(rel)).toEqual([])
  })
  it('useOnboarding solo usa localStorage para el espejo del nombre', () => {
    const src = readFileSync(join(SRC, 'hooks/useOnboarding.ts'), 'utf8')
    expect(localStorageOutsideNameKey(src)).toEqual([])
  })
  it('useOnboarding persiste a traves del gateway (no escribe la tabla)', () => {
    const src = readFileSync(join(SRC, 'hooks/useOnboarding.ts'), 'utf8')
    expect(/serviceRef\.current\?\.(?:save|load|reset)\(/.test(src)).toBe(true)
  })
  it('el universo analizado no es vacio (anti-vacuidad)', () => {
    expect(walk(SRC).length).toBeGreaterThan(100)
  })
})
describe('C45 onboardingSingleStore - el detector no es decorativo', () => {
  it('marca una linea que usa la clave legacy', () => {
    expect(LEGACY.test('window.localStorage.setItem(STORAGE_KEYS.ONBOARDING_STEP, raw)')).toBe(true)
    expect(LEGACY.test("localStorage.removeItem('flu-onboarding-completed')")).toBe(true)
    expect(LEGACY.test('const step = config.steps[state.stepIndex]')).toBe(false)
  })
  it('marca un acceso a localStorage que no es el espejo del nombre', () => {
    expect(localStorageOutsideNameKey("window.localStorage.setItem('foo', 'bar')")).toEqual([1])
    expect(localStorageOutsideNameKey('window.localStorage.setItem(config.nameKey, name)')).toEqual([])
    expect(localStorageOutsideNameKey("// window.localStorage.setItem('foo', 'bar')")).toEqual([])
  })
})
