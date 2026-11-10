// @vitest-environment node
// BARRERA: barrera-unica
/**
 * BARRERA ÚNICA — una prohibición, un test dueño.
 *
 * Cline duplicó una barrera (dos tests declarando la misma prohibición) y el
 * arnés no lo vio: `guard:duplicados` es léxico y el guard de conversación no
 * cuenta prohibiciones de tests. El manifiesto `scripts/prohibiciones.json`
 * declara el dueño único de cada prohibición y el marcador `// BARRERA: <id>`.
 *
 * FALSIFICACIÓN: dos entradas con el mismo id, o el mismo marcador en dos
 * archivos, deben marcar rojo. Una entrada sin test/motivo/fecha también.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = process.cwd()
const TESTS = join(RAIZ, 'tests')
const MANIFIESTO = JSON.parse(
  readFileSync(join(RAIZ, 'scripts/prohibiciones.json'), 'utf8'),
) as { barreras: Entrada[] }
const MARCA = /\/\/\s*BARRERA:\s*([a-z0-9-]+)/

type Entrada = { id: string; test: string; motivo: string; fecha: string }
type Marcador = { archivo: string; id: string }

function archivos(dir: string): string[] {
  const salida: string[] = []
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada)
    const info = statSync(ruta)
    if (info.isDirectory()) {
      salida.push(...archivos(ruta))
    } else if (entrada.endsWith('Guard.test.ts')) {
      salida.push(relative(RAIZ, ruta).replaceAll('\\', '/'))
    }
  }
  return salida
}

function leerMarcadores(): Marcador[] {
  return archivos(TESTS).flatMap((archivo) => {
    const src = readFileSync(join(RAIZ, archivo), 'utf8')
    const match = src.match(MARCA)
    return match ? [{ archivo, id: match[1]! }] : []
  })
}

/** Verifica el manifiesto contra los marcadores; devuelve los errores. */
function verificar(barreras: Entrada[], marcadores: Marcador[]): string[] {
  const errores: string[] = []
  const vistos = new Set<string>()
  for (const barrera of barreras) {
    if (!barrera.id || !barrera.test || !barrera.motivo || !barrera.fecha) {
      errores.push(`entrada incompleta: ${barrera.id || '(sin id)'}`)
      continue
    }
    if (vistos.has(barrera.id)) {
      errores.push(`prohibicion duplicada en el manifiesto: ${barrera.id}`)
    }
    vistos.add(barrera.id)
    if (!existsSync(join(RAIZ, barrera.test))) {
      errores.push(`test inexistente en el manifiesto: ${barrera.test}`)
    }
  }
  const porArchivo = new Map<string, string>()
  for (const marcador of marcadores) {
    if (porArchivo.has(marcador.archivo)) {
      errores.push(`barrera duplicada en el archivo: ${marcador.archivo}`)
    }
    porArchivo.set(marcador.archivo, marcador.id)
    const dueno = barreras.find((barrera) => barrera.id === marcador.id)
    if (!dueno) {
      errores.push(`prohibicion sin manifiesto: ${marcador.id} (${marcador.archivo})`)
    } else if (dueno.test !== marcador.archivo) {
      errores.push(`prohibicion ${marcador.id} declarada en ${dueno.test} pero marcada en ${marcador.archivo}`)
    }
  }
  const idsMarcados = new Set(marcadores.map((marcador) => marcador.id))
  const archivosMarcados = new Set(marcadores.map((marcador) => marcador.archivo))
  for (const barrera of barreras) {
    if (!idsMarcados.has(barrera.id)) {
      errores.push(`entrada sin marca: ${barrera.id}`)
    }
    if (!archivosMarcados.has(barrera.test)) {
      errores.push(`entrada sin archivo marcado: ${barrera.test}`)
    }
  }
  const ids = marcadores.map((marcador) => marcador.id)
  const duplicados = ids.filter((id, indice) => ids.indexOf(id) !== indice)
  for (const id of new Set(duplicados)) {
    errores.push(`prohibicion duplicada en dos tests: ${id}`)
  }
  return errores
}

describe('barrera única — una prohibición, un test dueño', () => {
  it('el manifiesto y los marcadores cuadran sin duplicados', () => {
    expect(verificar(MANIFIESTO.barreras, leerMarcadores())).toEqual([])
  })

  it('FALSIFICACIÓN: dos entradas con el mismo id son una barrera duplicada', () => {
    const base = MANIFIESTO.barreras[0]!
    const errores = verificar(
      [...MANIFIESTO.barreras, { ...base }],
      leerMarcadores(),
    )
    expect(errores.some((error) => error.includes('duplicada'))).toBe(true)
  })

  it('FALSIFICACIÓN: el mismo marcador en dos archivos es una barrera duplicada', () => {
    const marcadores = leerMarcadores()
    const errores = verificar(MANIFIESTO.barreras, [
      ...marcadores,
      { archivo: 'tests/otraBarreraGuard.test.ts', id: marcadores[0]!.id },
    ])
    expect(errores.some((error) => error.includes('duplicada'))).toBe(true)
  })

  it('una prohibición sin manifiesto falla', () => {
    const errores = verificar(MANIFIESTO.barreras, [
      ...leerMarcadores(),
      { archivo: 'tests/nuevaBarreraGuard.test.ts', id: 'prohibicion-nueva' },
    ])
    expect(errores.some((error) => error.includes('sin manifiesto'))).toBe(true)
  })
})
