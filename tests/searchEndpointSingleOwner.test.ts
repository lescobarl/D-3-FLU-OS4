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
import { SEARCH_PROXY_ENDPOINTS } from '../src/core/config/sharedConfig'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig'

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

/** Rutas /api/ literales en un fuente (mismo criterio del guard). */
export function apiLiterals(src: string, rel: string): string[] {
  const hits: string[] = []
  src.split(/\r?\n/).forEach((line, i) => {
    if (isComment(line)) return
    if (LITERAL_RE.test(line)) hits.push(rel + ":" + (i + 1))
  })
  return hits
}

describe('C63 - rutas del proxy de busqueda con dueno unico', () => {
  it('la capa de consumo (src/hooks) no hardcodea rutas /api/', () => {
    const hits: string[] = []
    for (const { path, src } of hookSources()) {
      const rel = path.slice(process.cwd().length + 1).replace(/\\/g, '/')
      hits.push(...apiLiterals(src, rel))
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

describe('C64 - una sola declaracion de las rutas (sharedConfig)', () => {
  const SHARED = 'src/core/config/sharedConfig.ts'
  const CONFIG = 'src/voice/lib/fluConfig.js'

  it('las rutas viven UNA vez en sharedConfig y ninguna en fluConfig', () => {
    const shared = readFileSync(join(process.cwd(), SHARED), 'utf8')
    const config = readFileSync(join(process.cwd(), CONFIG), 'utf8')
    const dup: string[] = []
    for (const route of ['/api/search/web', '/api/search/images', '/api/search/video']) {
      const nShared = shared.split(route).length - 1
      const nConfig = config.split(route).length - 1
      if (nShared !== 1) dup.push(`${route} en sharedConfig x${nShared}`)
      if (nConfig !== 0) dup.push(`${route} en fluConfig x${nConfig}`)
    }
    expect(dup, 'Rutas duplicadas:\n  ' + dup.join('\n  ')).toEqual([])
  })

  it('runtime, fallback y dueno declaran exactamente las MISMAS rutas', () => {
    const s = FLU_CONFIG.browser.search as { endpoints?: Record<string, string> }
    expect(s.endpoints).toEqual(SEARCH_PROXY_ENDPOINTS)
    expect(SEARCH_ENDPOINT_DEFAULTS).toEqual(SEARCH_PROXY_ENDPOINTS)
  })

  it('el comparador no es decorativo', () => {
    expect({ ...SEARCH_PROXY_ENDPOINTS, web: '/api/search/otra' }).not.toEqual(SEARCH_PROXY_ENDPOINTS)
  })
})

// P2.4 - prueba de detector: alimentado el infractor sintetico, la marca.
describe('C63 - rutas del proxy - el detector no es decorativo', () => {
  it('marca la ruta literal y deja pasar la resuelta por config', () => {
    expect(apiLiterals("fetch('/api/search/web')", 'src/hooks/x.ts')).toHaveLength(1)
    expect(apiLiterals("// fetch('/api/search/web')", 'src/hooks/x.ts')).toEqual([])
    expect(apiLiterals('fetch(SEARCH_ENDPOINT_DEFAULTS.web)', 'src/hooks/x.ts')).toEqual([])
  })
})