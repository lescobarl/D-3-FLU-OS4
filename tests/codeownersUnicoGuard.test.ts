/**
 * codeownersUnicoGuard — .github/CODEOWNERS declara CADA patrón una sola vez.
 *
 * Lección medida (2026-11-08): tras unir listas, el bloque de líneas base de la
 * conversación quedó DUPLICADO entero (4 rutas). GitHub resuelve con la ÚLTIMA
 * coincidencia, así que la entrada anterior queda muerta y diverge en silencio:
 * nada rompe hoy y nadie se entera después. Un patrón, una línea.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CODEOWNERS = readFileSync(join(process.cwd(), '.github', 'CODEOWNERS'), 'utf8')

/**
 * Líneas de código del archivo: sin vacías ni comentarios, espacios normalizados.
 * @param {string} texto Contenido del CODEOWNERS.
 * @returns {string[]} Líneas declarativas.
 */
function lineasDeCodigo(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter((linea) => linea && !linea.startsWith('#'))
    .map((linea) => linea.split(/\s+/).join(' '))
}

/**
 * Patrones declarados más de una vez. El patrón es el PRIMER campo de la línea:
 * la última coincidencia gana, así que las anteriores son entradas muertas.
 * @param {string} texto Contenido del CODEOWNERS.
 * @returns {string[]} Patrones repetidos, ordenados.
 */
function patronesDuplicados(texto: string): string[] {
  const cuenta = new Map<string, number>()
  for (const linea of lineasDeCodigo(texto)) {
    const patron = linea.split(' ')[0]
    cuenta.set(patron, (cuenta.get(patron) ?? 0) + 1)
  }
  return [...cuenta]
    .filter(([, veces]) => veces > 1)
    .map(([patron]) => patron)
    .sort()
}

describe('CODEOWNERS — un patrón, una línea', () => {
  it('ANTI-VACUIDAD: lee las líneas reales del archivo', () => {
    const lineas = lineasDeCodigo(CODEOWNERS)
    expect(lineas.length).toBeGreaterThan(30)
    expect(lineas.some((linea) => linea.startsWith('/scripts/'))).toBe(true)
    expect(lineas.every((linea) => linea.includes('@'))).toBe(true)
  })

  it('ningún patrón se declara dos veces', () => {
    expect(patronesDuplicados(CODEOWNERS)).toEqual([])
  })

  it('FALSIFICACIÓN: el mismo patrón dos veces se marca; dos distintos no', () => {
    expect(patronesDuplicados('/a @x\n/a @x\n')).toEqual(['/a'])
    expect(patronesDuplicados('/a @x\n/b @y\n')).toEqual([])
    // Espacios y comentarios no esconden el duplicado.
    expect(patronesDuplicados('# lista\n/a   @x\n\n   /a @x   \n')).toEqual(['/a'])
  })
})
