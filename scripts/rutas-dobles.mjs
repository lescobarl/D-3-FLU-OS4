#!/usr/bin/env node
/**
 * Guard de RUTAS DOBLES por responsabilidad.
 *
 * Cada caso declara un DUENO unico, un patron que detecta la responsabilidad y
 * los ficheros que HOY la implementan fuera de ese dueno. El guard falla si:
 *   - aparece un fichero NUEVO que casa (ruta doble nueva),
 *   - un fichero permitido deja de casar (la lista solo se recorta),
 *   - el total supera el techo `goal` (el techo solo baja),
 *   - el escaneo lee menos fuentes que `minSources` (medida vacua).
 *
 * Uso:
 *   node scripts/rutas-dobles.mjs            # gate (exit 1 si hay deriva)
 *   node scripts/rutas-dobles.mjs --report   # lista casos y recuentos
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')
const BASELINE = join(ROOT, 'scripts', 'rutas-dobles-baseline.json')
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/

/**
 * Recorre un directorio y devuelve las rutas absolutas de los ficheros de codigo.
 * @param {string} dir Directorio raiz.
 * @returns {string[]} Rutas absolutas.
 */
export function walkCodeFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkCodeFiles(full))
    else if (CODE_EXT.test(entry.name)) out.push(full)
  }
  return out
}

/**
 * Clave estable de un fichero: ruta relativa al repo con separador `/`.
 * @param {string} abs Ruta absoluta.
 * @returns {string} Ruta relativa.
 */
export function relKey(abs) {
  return relative(ROOT, abs).replace(/\\/g, '/')
}

/**
 * Cuenta las coincidencias de un caso por fichero.
 * @param {{pattern: string, kind: 'files'|'sites'}} caso Caso de la linea base.
 * @param {Array<{rel: string, text: string}>} files Fuentes ya leidas.
 * @returns {Map<string, number>} Fichero relativo -> coincidencias.
 */
export function measureCaseByFiles(caso, files) {
  const re = new RegExp(caso.pattern, 'g')
  const medidos = new Map()
  for (const file of files) {
    const matches = file.text.match(re)
    if (!matches || matches.length === 0) continue
    medidos.set(file.rel, caso.kind === 'files' ? 1 : matches.length)
  }
  return medidos
}

/**
 * Evalua un caso contra su linea base.
 * @param {{id: string, kind: 'files'|'sites', allowed: Record<string, number>, goal: number}} caso Caso.
 * @param {Map<string, number>} medidos Recuento por fichero.
 * @returns {{nuevos: string[], obsoletos: string[], total: number, excede: boolean}} Veredicto.
 */
export function evaluateCase(caso, medidos) {
  const permitidos = new Set(Object.keys(caso.allowed))
  const nuevos = [...medidos.keys()].filter((f) => !permitidos.has(f)).sort()
  const obsoletos = [...permitidos].filter((f) => !medidos.has(f)).sort()
  const total = [...medidos.values()].reduce((n, v) => n + v, 0)
  return { nuevos, obsoletos, total, excede: total > caso.goal }
}

/**
 * Carga la linea base versionada.
 * @param {string} [ruta] Ruta alternativa (pruebas).
 * @returns {object} Linea base.
 */
export function loadBaseline(ruta = BASELINE) {
  return JSON.parse(readFileSync(ruta, 'utf8'))
}

/**
 * ¿La ruta relativa vive bajo la raiz indicada?
 * @param {string} rel Ruta relativa.
 * @param {string} root Raiz relativa.
 * @returns {boolean} Pertenencia.
 */
function isUnder(rel, root) {
  return rel === root || rel.startsWith(`${root}/`)
}

/**
 * Mide un caso sobre las fuentes ya leidas, acotado a sus raices.
 * @param {object} caso Caso de la linea base.
 * @param {Array<{rel: string, text: string}>} allFiles Fuentes del repo.
 * @returns {{medidos: Map<string, number>, veredicto: object}} Medida y veredicto.
 */
export function runCase(caso, allFiles) {
  const files = allFiles.filter((f) => caso.roots.some((root) => isUnder(f.rel, root)))
  const medidos = measureCaseByFiles(caso, files)
  return { medidos, veredicto: evaluateCase(caso, medidos) }
}

/**
 * Ejecuta el gate sobre la linea base.
 * @returns {number} Codigo de salida.
 */
function main() {
  const baseline = loadBaseline()
  const allFiles = walkCodeFiles(join(ROOT, 'src')).map((abs) => ({
    rel: relKey(abs),
    text: readFileSync(abs, 'utf8'),
  }))
  if (allFiles.length < baseline.minSources) {
    console.error(`[rutas-dobles] escaneo vacuo: ${allFiles.length} fuentes (< ${baseline.minSources})`)
    return 2
  }
  const report = process.argv.includes('--report')
  let deriva = false
  for (const caso of baseline.cases) {
    const { medidos, veredicto } = runCase(caso, allFiles)
    if (report) {
      const sitios = [...medidos].map(([f, n]) => `${f}(${n})`).join(', ') || '(ninguno)'
      console.log(`${caso.id}: total=${veredicto.total} goal=${caso.goal} -> ${sitios}`)
      continue
    }
    if (veredicto.nuevos.length > 0) {
      deriva = true
      console.error(`[rutas-dobles] ${caso.id}: fichero(s) NUEVO(s) fuera del dueno ${caso.owner}:`)
      for (const f of veredicto.nuevos) console.error(`  - ${f}`)
    }
    if (veredicto.obsoletos.length > 0) {
      deriva = true
      console.error(`[rutas-dobles] ${caso.id}: la lista tiene fichero(s) que ya no casan; recorta la linea base:`)
      for (const f of veredicto.obsoletos) console.error(`  - ${f}`)
    }
    if (veredicto.excede) {
      deriva = true
      console.error(`[rutas-dobles] ${caso.id}: total ${veredicto.total} > goal ${caso.goal} (${caso.owner})`)
    }
  }
  if (report) return 0
  if (deriva) {
    console.error('[rutas-dobles] unifica el caso en su dueno declarado; el techo solo baja.')
    return 1
  }
  console.log(`[rutas-dobles] OK: ${baseline.cases.length} casos, ${allFiles.length} fuentes, sin deriva.`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}
