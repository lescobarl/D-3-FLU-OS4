/**
 * C63 - dueno UNICO de las rutas del proxy de busqueda.
 *
 * EVIDENCIA MEDIDA (por que existe este guard): las rutas del proxy estaban copiadas
 * en TRES sitios: la config (fluConfig.js), el servidor que las registra (searchProxy)
 * y, de sobra, un fallback literal dentro del hook (useWorkspaceSearch.ts:91-93). El
 * tercero no aporta nada (la config siempre las trae) y garantiza que el dia que una
 * ruta cambie, el hook siga apuntando a la vieja.
 *
 * REGLA VIGILADA: la capa de CONSUMO (src/hooks/**) no escribe rutas /api/ literales;
 * las resuelve desde la config o desde SEARCH_ENDPOINT_DEFAULTS. El servidor (que las
 * PRODUCE) y la config (que las declara) quedan fuera de alcance a proposito.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SEARCH_ENDPOINT_DEFAULTS } from '../src/core/search/searchConfigOverrides'

const LITERAL_RE = /['"`]\/api\//
const isComment = (line: string) => /^\s*(?:\/\/|\*|\/\*)/.test(line)

function hookSources(): Array<{ path: string; src: string }> {
  const out: Array<{ path: string; src: string }> = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(e.name)) out.push({ path: full, src: readFileSync(full, 'utf8') })
    }
  }
  walk(join(process.cwd(), 'src', 'hooks'))
  return out
}

describe('C63 - rutas del proxy de busqueda con dueno unico', () => {
  it('la capa de consumo (src/hooks) no hardcodea rutas /api/', () => {
    const hits: string[] = []
    for (const { path, src } of hookSources()) {
      const rel = path.slice(process.cwd().length + 1).replace(/\\/g, '/')
      src.split(/\r?\n/).forEach((line, i) => {
        if (isComment(line)) return
        if (LITERAL_RE.test(line)) hits.push(`${rel}:${i + 1}`)
      })
    }
    expect(
      hits,
      'Rutas /api/ hardcodeadas en la capa de consumo (N=' + hits.length + '):\n  ' +
        hits.join('\n  ') + '\nUsa SEARCH_ENDPOINT_DEFAULTS o la config.',
    ).toEqual([])
  })

  it('SEARCH_ENDPOINT_DEFAULTS cubre los 3 tipos y no esta vacio ni inventado', () => {
    expect(Object.keys(SEARCH_ENDPOINT_DEFAULTS).sort()).toEqual(['images', 'video', 'web'])
    for (const [k, v] of Object.entries(SEARCH_ENDPOINT_DEFAULTS)) {
      expect(v, `endpoint de ${k}`).toMatch(/^\/api\/search\/[a-z]+$/)
    }
  })
})
