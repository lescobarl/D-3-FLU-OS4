#!/usr/bin/env node
/**
 * Guard del barrido de clones a 25 tokens.
 *
 * La linea base (`scripts/duplicados25-baseline.json`) declara cada par medido
 * con su motivo y dueno. El guard falla si:
 *   - aparece un par NUEVO (clon nuevo),
 *   - un par de la lista deja de existir (hay que recortarla),
 *   - el escaneo lee menos fuentes que la linea base (medida vacua).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const BASELINE = path.join(ROOT, 'scripts', 'duplicados25-baseline.json')
const OUT = path.join(process.env.TEMP || '.', 'flu-guard-jscpd25')

function walk(dir) {
  let n = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += walk(path.join(dir, entry.name))
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) n += 1
  }
  return n
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
const sources = walk(path.join(ROOT, 'src'))
if (sources < baseline.minSources) {
  console.error(`[duplicados25] escaneo vacuo: ${sources} fuentes (< ${baseline.minSources})`)
  process.exit(2)
}

fs.rmSync(OUT, { recursive: true, force: true })
execFileSync(
  process.execPath,
  ['node_modules/jscpd/bin/jscpd', 'src', '--min-tokens', '25', '--reporters', 'json', '--output', OUT, '--silent'],
  { cwd: ROOT, stdio: 'ignore' },
)
const report = JSON.parse(fs.readFileSync(path.join(OUT, 'jscpd-report.json'), 'utf8'))
const measured = new Set()
for (const d of report.duplicates) {
  const a = d.firstFile.name.replace(/\\/g, '/')
  const b = d.secondFile.name.replace(/\\/g, '/')
  measured.add([a, b].sort().join('|'))
}

const declared = new Set(baseline.pairs.map((p) => p.key))
const nuevos = [...measured].filter((k) => !declared.has(k)).sort()
const obsoletos = [...declared].filter((k) => !measured.has(k)).sort()

if (nuevos.length > 0) {
  console.error(`[duplicados25] par(es) NUEVO(s) no declarados (${nuevos.length}):`)
  for (const k of nuevos.slice(0, 20)) console.error('  - ' + k)
}
if (obsoletos.length > 0) {
  console.error(`[duplicados25] par(es) que ya no existen; recorta la linea base (${obsoletos.length}):`)
  for (const k of obsoletos.slice(0, 20)) console.error('  - ' + k)
}
if (nuevos.length > 0 || obsoletos.length > 0) {
  console.error('[duplicados25] unifica el par en su dueno o declara el dictamen; la lista solo baja.')
  process.exit(1)
}

console.log(
  `[duplicados25] OK: ${measured.size} pares declarados (${baseline.pairs.length} en la linea base), ${sources} fuentes.`,
)
