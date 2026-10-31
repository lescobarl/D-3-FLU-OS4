#!/usr/bin/env node
/**
 * Guard de duplicacion por pares (trinquete de jscpd).
 *
 * Fija los pares de archivos que HOY comparten un bloque clonado. Si aparece un
 * par NUEVO, el commit falla. Si un par de la lista ya no se duplica, tambien
 * falla: la lista solo se recorta, nunca se deja crecer ni envejecer (un par
 * arreglado que se queda en la lista volveria a permitir el mismo defecto).
 *
 * La allowlist vive en `scripts/duplicados-allowlist.json` y esta protegida por
 * CODEOWNERS: anadir un par exige aprobacion del dueno del repo.
 *
 * Uso: node scripts/guard-duplicados.mjs
 * Sale con 0 si todo esta como estaba, 1 si hay deriva, 2 si no puede medir.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const ALLOWLIST = join(ROOT, 'scripts', 'duplicados-allowlist.json')
const SCAN_DIR = 'src'
/** Si el escaneo lee menos archivos que esto, la medida es vacua y se aborta. */
const MIN_SOURCES = 400

/** Clave estable de un par de archivos, sin depender del orden ni del separador. */
function pairKey(a, b) {
  return [String(a).replace(/\\/g, '/'), String(b).replace(/\\/g, '/')].sort().join(' | ')
}

const { minTokens, allowedPairs } = JSON.parse(readFileSync(ALLOWLIST, 'utf8'))
const out = mkdtempSync(join(tmpdir(), 'jscpd-guard-'))
let report
try {
  execFileSync(
    process.execPath,
    [
      join(ROOT, 'node_modules', 'jscpd', 'bin', 'jscpd'),
      SCAN_DIR,
      '--min-tokens', String(minTokens),
      '--reporters', 'json',
      '--output', out,
      '--silent',
    ],
    { cwd: ROOT, stdio: 'pipe' },
  )
  report = JSON.parse(readFileSync(join(out, 'jscpd-report.json'), 'utf8'))
} catch (error) {
  console.error('[duplicados] no se pudo medir con jscpd:', error instanceof Error ? error.message : error)
  process.exit(2)
} finally {
  rmSync(out, { recursive: true, force: true })
}

const total = report.statistics?.total ?? {}
const sources = total.sources ?? 0
if (sources < MIN_SOURCES) {
  console.error(`[duplicados] escaneo vacuo: ${sources} archivos leidos (< ${MIN_SOURCES}). Abortado.`)
  process.exit(2)
}

const pairs = new Set(report.duplicates.map((d) => pairKey(d.firstFile.name, d.secondFile.name)))
const allowed = new Set(allowedPairs)
const nuevas = [...pairs].filter((p) => !allowed.has(p)).sort()
const viejas = [...allowed].filter((p) => !pairs.has(p)).sort()

if (nuevas.length > 0 || viejas.length > 0) {
  if (nuevas.length > 0) {
    console.error(`[duplicados] ${nuevas.length} par(es) NUEVO(s) con bloque clonado:`)
    for (const p of nuevas) console.error(`  - ${p}`)
  }
  if (viejas.length > 0) {
    console.error(
      `[duplicados] ${viejas.length} par(es) de la lista ya no se duplican: ` +
        'borralos de scripts/duplicados-allowlist.json en este mismo commit',
    )
    for (const p of viejas) console.error(`  - ${p}`)
  }
  console.error('Unifica el bloque en un solo dueno. Anadir un par exige aprobacion del dueno (CODEOWNERS).')
  process.exit(1)
}

console.log(
  `[duplicados] OK: ${pairs.size} pares conocidos, ${total.clones} clones, ` +
    `${total.duplicatedLines} lineas (${total.percentage}%) en ${sources} archivos.`,
)
