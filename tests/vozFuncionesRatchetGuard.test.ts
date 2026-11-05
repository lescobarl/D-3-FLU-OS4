/**
 * vozFuncionesRatchetGuard — ratchet de nombres de función de `src/voice`.
 *
 * El módulo CONVERSACIÓN tiene su propio ratchet (conversacionRutasDoblesGuard).
 * Este cubre el RESTO del subsistema de voz: cualquier función nombrada nueva
 * en `src/voice` fuera de `conversation/` debe declararse en la línea base en
 * el MISMO cambio. Ahí se decide, en el diff, si es un helper o una segunda
 * ruta. La línea base solo crece: quitar funciones no dispara el guard.
 */
// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { funcionesNuevas, nombresDeFunciones } from '../scripts/funciones-ratchet.mjs'

type Fuente = Readonly<{ nombre: string; src: string }>

const RAIZ = process.cwd()
const VOZ = join(RAIZ, 'src/voice')
const MODULO = join(VOZ, 'conversation')
const BASELINE = JSON.parse(
  readFileSync(join(RAIZ, 'scripts/voz-funciones-baseline.json'), 'utf8'),
) as { minSources: number; funciones: Record<string, readonly string[]> }

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return full === MODULO ? [] : walk(full)
    return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [full] : []
  })
}

const FUENTES: readonly Fuente[] = walk(VOZ).map((abs) => ({
  nombre: relative(RAIZ, abs).replaceAll('\\', '/'),
  src: readFileSync(abs, 'utf8'),
}))

describe('VOZ — ratchet de funciones fuera del módulo', () => {
  it('ANTI-VACUIDAD: el escaneo lee la fuente real', () => {
    expect(FUENTES.length).toBeGreaterThanOrEqual(BASELINE.minSources)
  })

  it('toda función nombrada de src/voice está en la línea base (ratchet)', () => {
    expect(funcionesNuevas(FUENTES, BASELINE.funciones)).toEqual([])
  })

  it('una función nueva sin declarar falla (falsificación del ratchet)', () => {
    const nueva = [{ nombre: 'src/voice/lib/ejemplo.js', src: 'function nuevaRuta() {}\n' }]
    expect(
      funcionesNuevas(nueva, { 'src/voice/lib/ejemplo.js': ['existente'] }),
    ).toEqual(['src/voice/lib/ejemplo.js:nuevaRuta'])
    // La entrada legítima (el subsistema real) no marca nada.
    expect(funcionesNuevas(FUENTES, BASELINE.funciones)).toEqual([])
  })

  it('cuenta la función asignada como expresión, no solo la flecha', () => {
    expect(nombresDeFunciones('const nuevaRuta = function () {}\n')).toEqual(['nuevaRuta'])
  })

  it('quitar una función no dispara el ratchet (solo sube)', () => {
    expect(
      funcionesNuevas([{ nombre: 'src/voice/lib/ejemplo.js', src: '' }], {
        'src/voice/lib/ejemplo.js': ['existente'],
      }),
    ).toEqual([])
  })

  it('el módulo CONVERSACIÓN queda fuera: tiene su propio ratchet', () => {
    expect(
      FUENTES.some((archivo) => archivo.nombre.startsWith('src/voice/conversation/')),
    ).toBe(false)
    expect(
      Object.keys(BASELINE.funciones).some((nombre) =>
        nombre.startsWith('src/voice/conversation/'),
      ),
    ).toBe(false)
  })
})
