#!/usr/bin/env node
/**
 * promote — prepara un contrato de plans/contratos/ para la puerta de tareas.
 *
 * El agente NO edita .task/** (§B16). Este script lo ejecuta el USUARIO:
 *   Fase stage:    copia guard(s) y audit-metric a su destino. NO toca .task/.
 *   (checkpoint)   git add -A ; git commit
 *   Fase activate: fija base=HEAD en .task/contract.json y congela el criterio.
 *
 * Uso:
 *   node plans/contratos/promote.mjs C1 stage
 *   node plans/contratos/promote.mjs C1 activate
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = process.cwd()
const id = process.argv[2]
const phase = (process.argv[3] || '').toLowerCase()

if (!id || !['stage', 'activate'].includes(phase)) {
  console.error('Uso: node plans/contratos/promote.mjs <C1..C5> <stage|activate>')
  process.exit(1)
}

const templatePath = join(ROOT, 'plans', 'contratos', 'contracts', `${id}.json`)
if (!existsSync(templatePath)) {
  console.error(`No existe el contrato ${templatePath}`)
  process.exit(1)
}
const contract = JSON.parse(readFileSync(templatePath, 'utf8'))
const guardFiles = contract?.invariant?.guardFiles || []

function copy(srcRel, dstRel) {
  const src = join(ROOT, srcRel)
  const dst = join(ROOT, dstRel)
  if (!existsSync(src)) {
    console.error(`Falta el origen ${srcRel}`)
    process.exit(1)
  }
  mkdirSync(dirname(dst), { recursive: true })
  copyFileSync(src, dst)
  console.log(`copiado ${srcRel} -> ${dstRel}`)
}

if (phase === 'stage') {
  copy('plans/contratos/audit-metric.mjs', 'scripts/audit-metric.mjs')
  for (const g of guardFiles) copy(join('plans', 'contratos', 'guards', g.split('/').pop()), g)
  console.log('\nLos guards nacen ROJOS (es lo correcto, §B11).')
  console.log('Siguiente:')
  console.log('  git status                     # revisa qué queda dentro del checkpoint')
  console.log('  git add -A ; git commit -m "chore(contratos): activos ' + id + ' (guard rojo)"')
  console.log(`  node plans/contratos/promote.mjs ${id} activate`)
  process.exit(0)
}

const head = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
const json = JSON.stringify(contract, null, 2).replace(/__BASE__/g, head) + '\n'
writeFileSync(join(ROOT, '.task', 'contract.json'), json, 'utf8')
console.log(`.task/contract.json escrito (base=${head})`)

const freezeArgs = ['scripts/audit-metric.mjs', ...guardFiles].map((s) => `"${s}"`).join(' ')
execSync(`node scripts/task-gate-freeze.mjs ${freezeArgs}`, { stdio: 'inherit' })
console.log('\nCriterio congelado. Lanza la sesión B con plans/contratos/launch-prompt.md.')
console.log('Nota: `npm run gate` saldrá ROJO hasta que la sesión B implemente (es esperado).')
