#!/usr/bin/env node
/**
 * Guard de duplicacion por pares (trinquete de jscpd).
 *
 * Fija los pares de archivos que HOY comparten un bloque clonado. Si aparece un
 * par NUEVO, el commit falla. Si un par de la lista ya no se duplica, tambien
 * falla: la lista solo se recorta (un par arreglado que se queda en la lista
 * volveria a permitir el mismo defecto). Y el total no puede crecer nunca:
 * `maxPairs` es el techo y solo baja.
 *
 * Cada excepcion declara `reason`, `owner` y `date`: una excepcion sin dueño ni
 * motivo es una linea anonima que nadie revisa.
 *
 * La allowlist vive en `scripts/duplicados-allowlist.json` y esta protegida por
 * CODEOWNERS: anadir un par exige aprobacion del dueno del repo.
 *
 * Uso:
 *   node scripts/guard-duplicados.mjs            # gate (exit 1 si hay deriva)
 *   node scripts/guard-duplicados.mjs --report   # lista los pares con su tamaño
 *
 * Exit: 0 todo como estaba, 1 deriva, 2 no se puede medir.
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

const { minTokens, maxPairs, allowedPairs } = JSON.parse(readFileSync(ALLOWLIST, 'utf8'))
for (const entrada of allowedPairs) {
  for (const campo of ['pair', 'reason', 'owner', 'date']) {
    if (!entrada[campo]) {
      console.error(`[duplicados] excepcion sin "${campo}": ${JSON.stringify(entrada)}`)
      process.exit(2)
    }
  }
}
if (!Number.isInteger(maxPairs) || maxPairs < allowedPairs.length) {
  console.error(`[duplicados] maxPairs invalido (${maxPairs}) para ${allowedPairs.length} excepciones`)
  process.exit(2)
}

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

/** Par -> clones y lineas duplicadas de ese par. */
const medidos = new Map()
for (const d of report.duplicates) {
  const key = pairKey(d.firstFile.name, d.secondFile.name)
  const previo = medidos.get(key) ?? { clones: 0, lineas: 0 }
  medidos.set(key, { clones: previo.clones + 1, lineas: previo.lineas + (d.lines ?? 0) })
}

const allowed = new Map(allowedPairs.map((e) => [e.pair, e]))

if (process.argv.includes('--report')) {
  for (const [key, m] of [...medidos].sort()) {
    const exc = allowed.get(key)
    const estado = exc ? `aceptado (${exc.owner}, ${exc.date})` : 'NUEVO'
    console.log(`${m.clones}x ${m.lineas}L  ${key}  -> ${estado}`)
  }
  console.log(`Total: ${medidos.size} pares, ${total.clones} clones, ${total.duplicatedLines} lineas (${total.percentage}%).`)
  process.exit(0)
}

const nuevas = [...medidos.keys()].filter((p) => !allowed.has(p)).sort()
const viejas = [...allowed.keys()].filter((p) => !medidos.has(p)).sort()

if (nuevas.length > 0 || viejas.length > 0 || medidos.size > maxPairs) {
  if (nuevas.length > 0) {
    console.error(`[duplicados] ${nuevas.length} par(es) NUEVO(s) con bloque clonado:`)
    for (const p of nuevas) console.error(`  - ${p} (${medidos.get(p).lineas}L)`)
  }
  if (viejas.length > 0) {
    console.error(
      `[duplicados] ${viejas.length} par(es) de la lista ya no se duplican: ` +
        'borralos de scripts/duplicados-allowlist.json en este mismo commit',
    )
    for (const p of viejas) console.error(`  - ${p}`)
  }
  if (medidos.size > maxPairs) {
    console.error(
      `[duplicados] el total subio: ${medidos.size} pares (> maxPairs=${maxPairs}). ` +
        'El techo solo baja: arregla uno antes de aceptar otro.',
    )
  }
  console.error('Unifica el bloque en un solo dueno. Anadir un par exige aprobacion del dueno (CODEOWNERS).')
  process.exit(1)
}

console.log(
  `[duplicados] OK: ${medidos.size}/${maxPairs} pares aceptados, ${total.clones} clones, ` +
    `${total.duplicatedLines} lineas (${total.percentage}%) en ${sources} archivos.`,
)
