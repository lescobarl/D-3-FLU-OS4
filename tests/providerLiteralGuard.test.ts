/**
 * providerLiteralGuard — el proveedor de IA solo se declara en config.
 *
 * Regla #1 (NO HARDCODE): la identidad, el default y el orden de fallback de
 * los proveedores de IA viven en UN único módulo de configuración
 * (`src/core/config/`, hoy `sharedConfig.ts`). Ningún consumidor puede
 * re-declarar la lista ni quemar `'openrouter' | 'gemini' | 'deepseek' | 'local'`.
 *
 * Alcance (por qué no es un escaneo de cualquier string con esa palabra):
 *   - Módulos de SELECCIÓN de proveedor → prohibido CUALQUIER literal de
 *     proveedor (identidad, default, fallback). Deben derivar de config.
 *   - Resto de `src/` → prohibida la RE-DECLARACIÓN del catálogo, entendida
 *     como un ARRAY con ≥2 nombres de proveedor. Un nombre suelto, o una
 *     unión de otro dominio (p. ej. `MinuteLookupMode = 'local' | 'gemini'`),
 *     NO es identidad de proveedor y no se marca.
 *
 * Nace ROJO (17 literales en los módulos de selección) y pasa cuando todos
 * importan la fuente única. Patrón fs-scan (AGENTS.md §8.6 / §10.2).
 *
 * AMPLIACION C76 — la misma regla para los proveedores de BUSQUEDA: su identidad
 * vivia TRES veces (catalogo en fluConfig, dispatch en searchSession, etiquetas de
 * UI en ImageGrid/VideoGrid) y 8 de los ids estaban SOLO en codigo, asi que
 * renombrar en la config rompia la normalizacion en silencio. Ahora todos derivan
 * de SEARCH_PROVIDERS / SEARCH_PROVIDER_IDS (sharedConfig.ts).
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

/** Directorio de configuración: única zona donde se declaran proveedores. */
const CONFIG_DIR = 'src/core/config/'

/** Nombres canónicos de proveedor cuya identidad no debe quemarse. */
const PROVIDER_LITERAL_RE = /['"](openrouter|gemini|deepseek|local)['"]/g
const ARRAY_RE = /\[[^\]]*\]/gs

/**
 * Identidad ASIGNADA o COMPARADA (ampliacion de P7.10). El escaneo anterior solo miraba
 * literales sueltos en los SELECTION_MODULES y arrays de >=2 nombres, asi que
 * `id: 'openrouter'` (fluConfig.js) y `source: 'openrouter'` /
 * `providerId === 'openrouter'` (searchSession.ts) pasaban de largo.
 *
 * El criterio distingue por AMBIGUEDAD del nombre, no por la mera presencia del literal:
 *   - `openrouter` y `deepseek` solo significan un proveedor de IA -> cualquier posicion
 *     de identidad (clave `id`/`source`/... o comparacion) es violacion.
 *   - `gemini` y `local` tienen otros dominios (`local` = almacenamiento, `local`/`gemini`
 *     como modos) -> solo cuentan con una clave ESPECIFICA de proveedor.
 * MEDIDO antes de acotarlo asi: marcar todo literal en posicion de identidad daba 6
 * hits, de los que 2 eran el dominio de almacenamiento de storyteller.ts
 * (`source: 'local' | 'external'`, `source: 'local'`). Un guard que marca eso no sirve.
 */
const UNAMBIGUOUS = 'openrouter|deepseek'
const ANY_PROVIDER = 'openrouter|gemini|deepseek|local'
const IDENTITY_RES = [
  new RegExp(`\\b(provider|providerId|aiProvider)\\s*[:=]{1,3}\\s*['"](?:${ANY_PROVIDER})['"]`, 'g'),
  new RegExp(`\\b(id|source)\\s*[:=]{1,3}\\s*['"](?:${UNAMBIGUOUS})['"]`, 'g'),
  new RegExp(`===?\\s*['"](?:${UNAMBIGUOUS})['"]`, 'g'),
]

/** Identidad de proveedor de BUSQUEDA (C76): otro catalogo, misma regla. */
const SEARCH_PROVIDER = 'tavily|commons|commons-video|youtube|invidious|duckduckgo|wikipedia'
const SEARCH_IDENTITY_RES = [
  new RegExp(`\\b(provider|providerId)\\s*[:=]{1,3}\\s*['"](?:${SEARCH_PROVIDER})['"]`, 'g'),
  new RegExp(`\\b(id|source)\\s*[:=]{1,3}\\s*['"](?:${SEARCH_PROVIDER})['"]`, 'g'),
  new RegExp(`===?\\s*['"](?:${SEARCH_PROVIDER})['"]`, 'g'),
]
const SEARCH_LITERAL_RE = new RegExp(`['"](?:${SEARCH_PROVIDER})['"]`, 'g')

function identityLiteralsIn(line: string): string[] {
  // Un hit por linea: los patrones pueden solaparse (providerId === ya cubre el caso de
  // comparacion) y la lista de infractores se agrupa por linea de todos modos.
  for (const re of IDENTITY_RES) {
    re.lastIndex = 0
    const hit = line.match(re)
    if (hit) return hit
  }
  // Proveedor de BUSQUEDA (C76). Se exceptua la linea que declara `domain:`: esa es
  // una entrada del catalogo de SITIOS navegables (id + domain), donde 'wikipedia' y
  // 'youtube' nombran SITIOS, no proveedores de busqueda. Criterio medido, no un
  // perdon: el catalogo de sitios es el unico sitio que aparea id con domain.
  if (!/\bdomain\s*:/.test(line)) {
    for (const re of SEARCH_IDENTITY_RES) {
      re.lastIndex = 0
      const hit = line.match(re)
      if (hit) return hit
    }
  }
  return []
}

/**
 * Módulos que seleccionan/derivan el proveedor de IA. Cero literales de
 * proveedor permitidos: importan de `src/core/config/sharedConfig.ts`.
 */
const SELECTION_MODULES = new Set<string>([
  'src/services/aiServiceFactory.ts',
  'src/core/autonomy/decisionEngine.ts',
  'src/core/autonomy/autoRecovery.ts',
  'src/core/autonomy/backupSystem.ts',
  'src/core/branding/useEnhancedBranding.ts',
  'src/components/FluSettingsPanel.tsx',
])

/** Quita comentarios preservando el número de línea (bloques → saltos). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Nombres de proveedor aparecidos como literal en un texto. */
function providerLiteralsIn(text: string): string[] {
  return text.match(PROVIDER_LITERAL_RE) ?? []
}

/**
 * Literales de proveedor (IA o busqueda) dentro de un posible array.
 * Las entradas que declaran `domain:` son catalogo de SITIOS navegables
 * (id + domain), donde 'wikipedia'/'youtube' nombran sitios, no proveedores:
 * no cuentan. Criterio medido, no un perdon.
 */
export function providerArrayHits(text: string): string[] {
  const sinSitios = text.replace(/^.*\bdomain\s*:.*$/gm, '')
  return [...(text.match(PROVIDER_LITERAL_RE) ?? []), ...(sinSitios.match(SEARCH_LITERAL_RE) ?? [])]
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

describe('providerLiteralGuard — proveedores de IA solo desde config', () => {
  it('el escáner cubre los módulos de selección (no es un no-op)', () => {
    expect(SELECTION_MODULES.size).toBeGreaterThanOrEqual(6)
  })

  it('no hay literales de proveedor fuera del módulo de configuración', () => {
    const offenders: string[] = []
    for (const file of walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)) {
      const relPath = relative(ROOT, file).replace(/\\/g, '/')
      if (relPath.startsWith(CONFIG_DIR)) continue

      const raw = readFileSync(file, 'utf8')
      const stripped = stripComments(raw)
      const lines = stripped.split(/\r?\n/)

      if (SELECTION_MODULES.has(relPath)) {
        lines.forEach((line, i) => {
          if (providerLiteralsIn(line).length > 0) {
            offenders.push(`${relPath}:${i + 1}:${line.trim().slice(0, 120)}`)
          }
        })
        continue
      }

      lines.forEach((line, i) => {
        if (identityLiteralsIn(line).length > 0) {
          offenders.push(`${relPath}:${i + 1}:${line.trim().slice(0, 120)}`)
        }
      })

      let match: RegExpExecArray | null
      ARRAY_RE.lastIndex = 0
      while ((match = ARRAY_RE.exec(stripped)) !== null) {
        if (providerArrayHits(match[0]).length >= 2) {
          const line = lineAt(stripped, match.index)
          offenders.push(`${relPath}:${line}:${(lines[line - 1] ?? '').trim().slice(0, 120)}`)
        }
      }
    }
    const report = offenders.join('\n  ')
    expect(
      offenders,
      `Literales de proveedor fuera de la config (N=${offenders.length}); usa ` +
        `AI_PROVIDERS / AI_PROVIDER_IDS / DEFAULT_AI_PROVIDER y SEARCH_PROVIDERS / ` +
          `SEARCH_PROVIDER_IDS de sharedConfig.ts:\n  ${report}`,
    ).toEqual([])
  })
})

describe('providerLiteralGuard - el detector no es decorativo', () => {
  it('habria cazado los dos hardcodes reales que motivaron la ampliacion', () => {
    // Las cadenas EXACTAS que estaban en el arbol antes de P7.7.
    expect(identityLiteralsIn("            id: 'openrouter',")).toHaveLength(1)
    expect(identityLiteralsIn("            source: 'openrouter',")).toHaveLength(1)
    expect(identityLiteralsIn("    if (providerId === 'openrouter') return normalizeOpenRouter(raw);")).toHaveLength(1)
  })

  it('no marca el dominio de almacenamiento ni las uniones legitimas', () => {
    // storyteller.ts: 'local' aqui es almacenamiento, no proveedor. Este fue el falso
    // positivo medido que obligo a separar nombres inequivocos de ambiguos.
    expect(identityLiteralsIn("    source: 'local' | 'external';")).toEqual([])
    expect(identityLiteralsIn("      source: 'local',")).toEqual([])
    // Una clave especifica SI cuenta aunque el nombre sea ambiguo.
    expect(identityLiteralsIn("  provider: 'gemini',")).toHaveLength(1)
  })

  it('habria cazado la triple escritura de la identidad de BUSQUEDA (C76)', () => {
    // Las cadenas EXACTAS que estaban en el arbol antes de C76.
    expect(identityLiteralsIn("        id: 'tavily',")).toHaveLength(1)
    expect(identityLiteralsIn("            source: 'youtube',")).toHaveLength(1)
    expect(
      identityLiteralsIn("    if (providerId === 'commons-video') return normalizeCommonsMedia(raw, 'video', provider);"),
    ).toHaveLength(1)
    expect(identityLiteralsIn("    if (source === 'invidious') return ui.sourceInvidious;")).toHaveLength(1)
    expect(identityLiteralsIn("            source: 'duckduckgo',")).toHaveLength(1)
  })

  it('no marca el catalogo de SITIOS navegables (id + domain, no proveedor)', () => {
    // Unico falso positivo medido de la ampliacion: estas dos entradas existen y NO
    // son proveedores de busqueda.
    expect(
      identityLiteralsIn("        { id: 'wikipedia', label: 'Wikipedia', domain: 'wikipedia.org', category: 'educacion' },"),
    ).toEqual([])
    expect(
      identityLiteralsIn("        { id: 'youtube', label: 'YouTube', domain: 'youtube.com', category: 'musica' },"),
    ).toEqual([])
    // Sin el domain, el MISMO id si es infraccion: la excepcion no es un perdon.
    expect(identityLiteralsIn("        { id: 'youtube', label: 'YouTube' },")).toHaveLength(1)
  })

  it('el consumidor que deriva de la fuente unica pasa', () => {
    expect(
      identityLiteralsIn("    [SEARCH_PROVIDER_IDS.YOUTUBE]: (raw, { provider }) => normalizeYouTube(raw, provider),"),
    ).toEqual([])
    expect(identityLiteralsIn("    return normalizer ? normalizer(raw, { lang, provider }) : [];")).toEqual([])
    expect(identityLiteralsIn("    source: SEARCH_PROVIDER_IDS.COMMONS_VIDEO,")).toEqual([])
  })

  it('el escaneo de arrays distingue una lista re-declarada del catalogo de sitios', () => {
    // La lista compacta que el heuristico existe para cazar.
    expect(providerArrayHits("const ids = ['tavily', 'wikipedia']")).toHaveLength(2)
    // El catalogo de sitios navegables real (id + domain): no son proveedores.
    expect(
      providerArrayHits(
        "tiles: [\n  { id: 'wikipedia', label: 'Wikipedia', domain: 'wikipedia.org' },\n  { id: 'youtube', label: 'YouTube', domain: 'youtube.com' },\n]",
      ),
    ).toEqual([])
  })
})
