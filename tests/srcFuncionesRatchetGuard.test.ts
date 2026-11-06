/**
 * srcFuncionesRatchetGuard — ratchet de nombres de función del producto fuera
 * de `src/voice`.
 *
 * El subsistema de voz tiene DOS ratchets propios (el módulo CONVERSACIÓN y el
 * resto de `src/voice`). Este cubre el RESTO de `src`: cualquier función
 * nombrada nueva fuera de `src/voice` debe declararse en la línea base en el
 * MISMO cambio. Así una segunda ruta con otro nombre no puede entrar en
 * silencio: aparece en el diff de la línea base. La línea base solo crece;
 * quitar funciones no dispara el guard.
 */
// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { funcionesNuevas, nombresDeFunciones } from '../scripts/funciones-ratchet.mjs'

type Fuente = Readonly<{ nombre: string; src: string }>

const RAIZ = process.cwd()
const SRC = join(RAIZ, 'src')
const VOZ = join(SRC, 'voice')
const BASELINE = JSON.parse(
  readFileSync(join(RAIZ, 'scripts/src-funciones-baseline.json'), 'utf8'),
) as { minSources: number; funciones: Record<string, readonly string[]> }

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return full === VOZ ? [] : walk(full)
    return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [full] : []
  })
}

const FUENTES: readonly Fuente[] = walk(SRC).map((abs) => ({
  nombre: relative(RAIZ, abs).replaceAll('\\', '/'),
  src: readFileSync(abs, 'utf8'),
}))

describe('SRC fuera de VOZ — ratchet de funciones', () => {
  it('ANTI-VACUIDAD: el escaneo lee la fuente real', () => {
    expect(FUENTES.length).toBeGreaterThanOrEqual(BASELINE.minSources)
  })

  it('toda función nombrada de src (fuera de voice) está en la línea base', () => {
    expect(funcionesNuevas(FUENTES, BASELINE.funciones)).toEqual([])
  })

  it('una función nueva sin declarar falla (falsificación del ratchet)', () => {
    const nueva = [{ nombre: 'src/lib/ejemplo.ts', src: 'function nuevaRuta() {}\n' }]
    expect(
      funcionesNuevas(nueva, { 'src/lib/ejemplo.ts': ['existente'] }),
    ).toEqual(['src/lib/ejemplo.ts:nuevaRuta'])
    // La entrada legítima (el producto real) no marca nada.
    expect(funcionesNuevas(FUENTES, BASELINE.funciones)).toEqual([])
  })

  it('cuenta la función asignada como expresión, no solo la flecha', () => {
    expect(nombresDeFunciones('const nuevaRuta = function () {}\n')).toEqual(['nuevaRuta'])
  })

  it('una flecha async anónima al inicio de línea no es un método', () => {
    expect(nombresDeFunciones('  async (x: number) => {\n    return x\n  }\n')).toEqual([])
  })

  it('quitar una función no dispara el ratchet (solo sube)', () => {
    expect(
      funcionesNuevas([{ nombre: 'src/lib/ejemplo.ts', src: '' }], {
        'src/lib/ejemplo.ts': ['existente'],
      }),
    ).toEqual([])
  })

  it('src/voice queda fuera: tiene sus propios ratchets', () => {
    expect(FUENTES.some((archivo) => archivo.nombre.startsWith('src/voice/'))).toBe(false)
    expect(
      Object.keys(BASELINE.funciones).some((nombre) => nombre.startsWith('src/voice/')),
    ).toBe(false)
  })

  it('cubre las áreas del producto, no solo una carpeta', () => {
    const areas = new Set(
      Object.keys(BASELINE.funciones).map((nombre) => nombre.split('/')[1]),
    )
    for (const area of ['core', 'lib', 'components', 'hooks', 'services', 'store']) {
      expect(areas).toContain(area)
    }
  })
})
