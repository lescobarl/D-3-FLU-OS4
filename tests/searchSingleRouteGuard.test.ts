/**
 * searchSingleRouteGuard — invariante: UNA sola ruta para el estado de Buscar.
 *
 * El estado de Buscar (query + resultados) tiene DOS escritores desfasados:
 *   RESET: App llama `dispatchFluResetSearch()` en cada resolución de turno.
 *   FILL:  useNavigationCommands llama `dispatchFluSearch()` 2800 ms después.
 *
 * Si el RESET cae después del FILL (p. ej. con muchas revisiones ASR o cambio
 * de hablante), los resultados se borran: la barra queda con la query y la
 * grilla vacía. Invariante: en un turno de BÚSQUEDA (BUSCAR) App NO debe
 * limpiar; el FILL es el único que escribe.
 *
 * Nace ROJO (App limpia incondicionalmente) y pasa cuando el reset queda
 * condicionado a "no es turno de búsqueda".
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP = join(process.cwd(), 'src', 'App.tsx')

describe('searchSingleRouteGuard — una sola ruta para el estado de Buscar', () => {
  it('G8 — App no limpia la búsqueda en un turno BUSCAR (el FILL manda)', () => {
    const lines = readFileSync(APP, 'utf8').split(/\r?\n/)
    const offenders: string[] = []
    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (trimmed.includes('dispatchFluResetSearch(') && !trimmed.includes('isSearchFillTurn')) {
        offenders.push(`src/App.tsx:${index + 1}:${trimmed.slice(0, 100)}`)
      }
    })
    expect(
      offenders,
      `Reset de búsqueda incondicional (N=${offenders.length}); debe ir gateado por isSearchFillTurn:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
