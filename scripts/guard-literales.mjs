#!/usr/bin/env node
/**
 * Trinquete de literales repetidos (>=18 chars presentes en >=2 archivos).
 *
 * El detector es de `scripts/auditoria-codigo.mjs` (dueño unico); aqui solo se
 * compara el resultado contra una linea base versionada. Un literal nuevo que
 * aparezca en dos archivos rompe el commit; un literal de la lista que ya no se
 * repite tambien (la lista solo se recorta, nunca envejece).
 *
 * Uso:
 *   node scripts/guard-literales.mjs            # gate
 *   node scripts/guard-literales.mjs --report   # lista los literales con su alcance
 *
 * Exit: 0 sin deriva, 1 deriva, 2 no se puede medir.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readSources } from './fsScan.mjs'
import { repeatedLiterals } from './auditoria-codigo.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const BASELINE = join(ROOT, 'scripts', 'literales-allowlist.json')
const MIN_SOURCES = 400

const { minChars, literales } = JSON.parse(readFileSync(BASELINE, 'utf8'))
process.chdir(ROOT)
const sources = readSources('src')
if (sources.length < MIN_SOURCES) {
  console.error(`[literales] escaneo vacuo: ${sources.length} archivos (< ${MIN_SOURCES}). Abortado.`)
  process.exit(2)
}

const actuales = repeatedLiterals(sources, minChars)
const actualesSet = new Set(actuales.map((l) => l.lit))
const baseSet = new Set(literales)

if (process.argv.includes('--report')) {
  for (const l of [...actuales].sort((a, b) => b.files - a.files || a.lit.localeCompare(b.lit))) {
    console.log(`${l.files} archivos  ${JSON.stringify(l.lit)}`)
  }
  console.log(`Total: ${actuales.length} literales (linea base ${literales.length}).`)
  process.exit(0)
}

const nuevos = [...actualesSet].filter((l) => !baseSet.has(l)).sort()
const viejos = [...baseSet].filter((l) => !actualesSet.has(l)).sort()

if (nuevos.length > 0 || viejos.length > 0) {
  if (nuevos.length > 0) {
    console.error(`[literales] ${nuevos.length} literal(es) NUEVO(s) repetido(s) en >=2 archivos:`)
    for (const l of nuevos.slice(0, 20)) console.error(`  - ${JSON.stringify(l)}`)
  }
  if (viejos.length > 0) {
    console.error(
      `[literales] ${viejos.length} literal(es) de la lista ya no se repiten: ` +
        'borralos de scripts/literales-allowlist.json en este mismo commit',
    )
    for (const l of viejos.slice(0, 20)) console.error(`  - ${JSON.stringify(l)}`)
  }
  console.error('Unifica el literal en su dueño (config/catalogo) o elimina la copia. Anadir uno exige aprobacion del dueno (CODEOWNERS).')
  process.exit(1)
}

console.log(`[literales] OK: ${actuales.length} literales repetidos congelados (minChars=${minChars}) en ${sources.length} archivos.`)
