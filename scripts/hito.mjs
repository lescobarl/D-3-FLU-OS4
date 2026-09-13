#!/usr/bin/env node
/**
 * hito.mjs — arnés COMPLETO del hito de unificación (setup + verificación).
 * UN SOLO ARCHIVO. El ejecutor lo corre; el arnés prepara, verifica y bloquea.
 *
 *   node scripts/hito.mjs          -> PREP + PRE   (deja el criterio listo y confirma guard ROJO)
 *   node scripts/hito.mjs prep     -> solo PREP    (aparta cambios ajenos, commit criterio, contrato)
 *   node scripts/hito.mjs pre      -> solo PRE     (exige guard ROJO)
 *   node scripts/hito.mjs post     -> POST         (DoD + guard verde + typecheck + lint + gate)
 *
 *   HITO_DRY=1 node scripts/hito.mjs prep   -> imprime lo que haría, SIN tocar git.
 *
 * No implementa el refactor: eso lo hace el agente entre `pre` y `post`.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// ------------------------------------------------------------------
// CONFIGURACIÓN DEL HITO (única fuente dentro del script)
// ------------------------------------------------------------------
const BRANCH_FORBIDDEN = /^(main|master)$/
const CRITERION = [
  '.task/frozen.json',
  'kilo.json',
  'package.json',
  'plans/unificacion-duplicados.md',
  'tests/schedulerSingleDefinition.test.ts',
  'scripts/hito.mjs',
]
const CONTRACT_PATH = '.task/contract.json'
const GUARD_CMD = 'npx vitest run tests/schedulerSingleDefinition.test.ts --reporter=dot'
const DOD_CMD =
  'npx vitest run tests/scheduleEngine.test.ts tests/reminderScheduler.test.ts tests/schedulerSingleDefinition.test.ts --reporter=dot'

// Métrica: nº de definiciones `export function isDue|collectDue|collectDueOrdered` en src.
// HOY = 6 · META = 3 (todas en scheduleEngine.ts). Sin dependencias externas.
const METRIC_CMD = String.raw`node -e "const fs=require('fs');let n=0;const w=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=d+'/'+e.name;if(e.isDirectory())w(p);else if(/\.(ts|tsx|js|jsx)$/.test(e.name))n+=(fs.readFileSync(p,'utf8').match(/export\s+function\s+(isDue|collectDue|collectDueOrdered)\b/g)||[]).length;}};w('src');console.log(n)"`

const DRY = process.env.HITO_DRY === '1' || process.argv.includes('--dry')
const phaseArg = (process.argv.find((a) => ['prep', 'pre', 'post'].includes(a)) || 'run').toLowerCase()

// ------------------------------------------------------------------
const sh = (cmd) => {
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8' })
  return { code: r.status === null ? 1 : r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }
}
const shRaw = (cmd) => {
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8' })
  return { code: r.status === null ? 1 : r.status, out: r.stdout || '', err: r.stderr || '' }
}
const step = (label, cmd) => {
  console.log(`  $ ${cmd}`)
  if (DRY) return { code: 0, out: '', err: '' }
  const r = sh(cmd)
  if (r.code !== 0) {
    console.error(`❌ ${label}\n${r.err || r.out}`)
    process.exit(1)
  }
  return r
}
const check = (label, cmd, expect) => {
  console.log(`\n— ${label} (esperado: ${expect}) :: ${cmd}`)
  const r = sh(cmd)
  const ok = expect === 'fail' ? r.code !== 0 : r.code === 0
  console.log(r.out || r.err || '(sin salida)')
  console.log(ok ? `✅ ${label}` : `❌ ${label}`)
  return ok
}

// ------------------------------------------------------------------
// PREP — deja el criterio commiteado y escribe el contrato con `base`
// ------------------------------------------------------------------
function buildContract(base) {
  return {
    id: 'T-DUP-SCHEDULER',
    mode: 'full',
    objective: 'La logica de vencimiento (isDue/collectDue/collectDueOrdered) se define una sola vez.',
    base,
    allow: ['src/core/temporal/scheduleEngine.ts', 'src/core/reminders/reminderScheduler.ts'],
    deny: ['.task/**', 'scripts/task-gate*.mjs', 'scripts/hito.mjs'],
    ignore: ['.task/**', 'scripts/task-gate*.mjs', 'scripts/hito.mjs', 'kilo.json', '.github/**'],
    maxFiles: 2,
    maxLines: 250,
    dod: DOD_CMD,
    guard: GUARD_CMD,
    guardExpect: 'green',
    invariant: {
      statement: 'isDue/collectDue/collectDueOrdered se declaran 3 veces, todas en scheduleEngine.ts',
      metric: { command: METRIC_CMD, target: 3 },
      base,
      guardFiles: ['tests/schedulerSingleDefinition.test.ts'],
    },
  }
}

function prep() {
  const branch = sh('git rev-parse --abbrev-ref HEAD').out
  if (BRANCH_FORBIDDEN.test(branch)) {
    console.error(`❌ Estás en "${branch}". Usa una rama feature/* (no commits directos a main).`)
    process.exit(1)
  }
  console.log(`[prep] rama: ${branch}${DRY ? '  (DRY RUN)' : ''}`)

  // 1) Apartar cambios ajenos al hito (fuera de CRITERION y del contrato)
  const status = shRaw('git status --porcelain').out.split('\n').filter((l) => l.length > 3)
  const paths = status.map((l) => l.slice(3).trim().replace(/^"|"$/g, ''))
  const ajenos = paths.filter((p) => !CRITERION.includes(p) && p !== CONTRACT_PATH)
  if (ajenos.length) {
    console.log(`[prep] apartando cambios ajenos (git stash): ${ajenos.join(', ')}`)
    step(
      'stash ajenos',
      `git stash push -u -m "hito1: wip ajeno al criterio" -- ${ajenos.map((p) => `"${p}"`).join(' ')}`,
    )
  } else {
    console.log('[prep] sin cambios ajenos')
  }

  // 2) Commit del criterio
  step('stage criterio', `git add -- ${CRITERION.map((p) => `"${p}"`).join(' ')}`)
  const staged = DRY ? '' : sh('git diff --cached --name-only').out
  if (staged || DRY) {
    step('commit criterio', 'git commit -m "chore(criterio): hito 1 scheduler (guard + arnes + brief)"')
  } else {
    console.log('[prep] el criterio ya estaba commiteado')
  }

  // 3) base = commit del criterio (así el guard vive en base y el scope no cuenta el criterio)
  const base = DRY ? '<DRY>' : sh('git rev-parse HEAD').out
  console.log(`[prep] base del hito: ${base}`)

  // 4) Contrato con base fijado
  console.log(`[prep] escribiendo ${CONTRACT_PATH}`)
  if (!DRY) writeFileSync(CONTRACT_PATH, JSON.stringify(buildContract(base), null, 2) + '\n', 'utf8')
  step('stage contrato', `git add -- ${CONTRACT_PATH}`)
  step('commit contrato', 'git commit -m "chore(criterio): contrato hito 1 (base fijado)"')
  console.log('[prep] ✅ criterio listo')
}

// ------------------------------------------------------------------
// PRE — el guard DEBE nacer rojo
// ------------------------------------------------------------------
function pre() {
  if (!existsSync(CONTRACT_PATH)) {
    console.error(`❌ Falta ${CONTRACT_PATH}. Corre primero: node scripts/hito.mjs prep`)
    process.exit(1)
  }
  const ok = check('GUARD debe nacer ROJO', GUARD_CMD, 'fail')
  if (!ok) {
    console.error('\n❌ El guard NO nace rojo: la tarea no está definida (§B11). Abortado.')
    process.exit(1)
  }
  console.log('\n👉 Guard ROJO confirmado. Ahora implementa el hito. Al terminar:')
  console.log('   node scripts/hito.mjs post')
}

// ------------------------------------------------------------------
// POST — cierre verificado
// ------------------------------------------------------------------
function post() {
  if (!existsSync(CONTRACT_PATH)) {
    console.error(`❌ Falta ${CONTRACT_PATH}.`)
    process.exit(1)
  }
  const c = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8'))
  const results = [
    check('DoD', c.dod, 'pass'),
    check('GUARD verde', c.guard, 'pass'),
    check('TYPECHECK', 'npm run typecheck', 'pass'),
    check('LINT', 'npm run lint', 'pass'),
    check('GATE', 'node scripts/task-gate.mjs', 'pass'),
  ]
  console.log('\n=== git diff --stat ===')
  console.log(sh('git diff --stat').out || '(sin cambios)')
  const failed = results.filter((ok) => !ok).length
  if (failed) {
    console.error(`\n❌ Faltan ${failed} checks. La tarea NO está hecha.`)
    process.exit(1)
  }
  console.log('\n✅ Hito verificado. Pega esta salida como cierre.')
}

// ------------------------------------------------------------------
if (phaseArg === 'prep') prep()
else if (phaseArg === 'pre') pre()
else if (phaseArg === 'post') post()
else {
  prep()
  pre()
}
