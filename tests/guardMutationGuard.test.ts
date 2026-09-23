/**
 * P2.4 - guardMutation: un guard sin prueba de su propio detector es teatro.
 *
 * CONTEXTO MEDIDO: de los 14 guards registrados en `lint:guards`, 11 no contenian
 * ninguna prueba de que su detector discrimine (es decir, no hay un caso que
 * alimente una entrada sintetica infractora y compruebe que la marca). Un guard
 * asi puede estar en verde para siempre sin proteger nada: es exactamente el
 * "guard teatro" del plan-T.
 *
 * REGLA (trinquete, shrink-only): todo guard registrado en `lint:guards` debe
 * tener prueba de detector. Las excepciones vivas estan listadas en
 * `.task/guard-proof-baseline.json` y la lista solo puede ENCOGER: si un guard
 * del baseline gana su prueba, hay que sacarlo del baseline o el meta-guard falla.
 * Asi el teatro no se puede AMPLIAR nunca y el existente obliga a reducirse.
 *
 * La lista de guards se lee del mecanismo (package.json), no de prosa.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
const PROOF_RE = /no es decorativo|no decorativo|mutaci[o├│]n|mutation|el detector/i
/** Guards (tests/*.test.ts) referenciados por un comando de package.json. */
export function guardFilesFrom(command: string): string[] {
  const found = command.match(/tests\/[A-Za-z0-9_.-]+\.test\.ts/g) || []
  return [...new Set(found)]
}
/** Un guard tiene prueba de detector si declara un caso que lo falsifica. */
export function hasDetectorProof(src: string): boolean {
  return PROOF_RE.test(src)
}
/** Guards de la lista que NO tienen prueba de detector (el teatro vivo). */
export function theaterGuards(files: string[], readSource: (f: string) => string): string[] {
  return files.filter((f) => !hasDetectorProof(readSource(f)))
}
/** Diferencia simetrica: lo que sobra o falta respecto al baseline. */
export function baselineDrift(theater: string[], baseline: string[]): string[] {
  const a = new Set(theater)
  const b = new Set(baseline)
  return [
    ...theater.filter((f) => !b.has(f)).map((f) => `NUEVO teatro (no estaba en baseline): ${f}`),
    ...baseline.filter((f) => !a.has(f)).map((f) => `YA no es teatro (quitalo del baseline): ${f}`),
  ]
}
const ROOT = process.cwd()
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const BASELINE_PATH = join(ROOT, '.task/guard-proof-baseline.json')
function readBaseline(): string[] {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  } catch {
    return []
  }
}
describe('P2.4 guardMutation - ningun guard teatro nuevo', () => {
  it('todo guard de lint:guards tiene prueba de detector, o esta en el baseline', () => {
    const files = guardFilesFrom(pkg.scripts['lint:guards'] || '')
    expect(files.length, 'no se pudo leer la lista de guards de package.json').toBeGreaterThan(0)
    const missing = files.filter((f) => !readFileSyncSafe(join(ROOT, f)))
    expect(missing, `guards registrados que no existen:\n  ${missing.join('\n  ')}`).toEqual([])
    const theater = theaterGuards(files, (f) => readFileSync(join(ROOT, f), 'utf8'))
    const drift = baselineDrift(theater, readBaseline())
    expect(
      drift,
      'Trinquete de P2.4 roto:\n  ' + drift.join('\n  ') +
        '\nAnade una prueba de detector al guard (alimenta una entrada infractora y comprueba la marca), ' +
        'o saca del baseline el guard que ya la tiene.',
    ).toEqual([])
  })
})
/** true si el archivo existe (devuelve el fuente o cadena vacia si no). */
function readFileSyncSafe(abs: string): string {
  try {
    return readFileSync(abs, 'utf8')
  } catch {
    return ''
  }
}
describe('P2.4 guardMutation - el detector no es decorativo', () => {
  it('extrae los guards del comando real de package.json', () => {
    const got = guardFilesFrom('vitest run tests/aGuard.test.ts tests/b.test.ts tests/aGuard.test.ts')
    expect(got).toEqual(['tests/aGuard.test.ts', 'tests/b.test.ts'])
  })
  it('reconoce un guard con prueba de detector', () => {
    expect(hasDetectorProof("describe('el detector no es decorativo', () => {})")).toBe(true)
    expect(hasDetectorProof("it('marca una entrada infractora sintetica', () => {})")).toBe(false)
  })
  it('marca un guard sin prueba de detector', () => {
    expect(hasDetectorProof("describe('C1 - invariante', () => { expect(x).toEqual([]) })")).toBe(false)
    expect(theaterGuards(['a.test.ts'], () => 'describe("C1", () => {})')).toEqual(['a.test.ts'])
  })
  it('el trinquete bloquea teatro NUEVO', () => {
    expect(baselineDrift(['a.test.ts', 'nuevo.test.ts'], ['a.test.ts'])).toEqual([
      'NUEVO teatro (no estaba en baseline): nuevo.test.ts',
    ])
  })
  it('el trinquete exige sacar del baseline al guard que ya tiene prueba', () => {
    expect(baselineDrift([], ['a.test.ts'])).toEqual([
      'YA no es teatro (quitalo del baseline): a.test.ts',
    ])
  })
  it('sin deriva si el teatro coincide con el baseline', () => {
    expect(baselineDrift(['a.test.ts'], ['a.test.ts'])).toEqual([])
  })
})