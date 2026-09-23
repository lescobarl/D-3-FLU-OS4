#!/usr/bin/env node
/**
 * task-gate — Puerta automática de tareas (AGENTS.md §10).
 *
 * Valida, sin intervención humana, que el trabajo hecho cumple el contrato:
 *   1) Alcance: solo se tocaron archivos dentro de "allow".
 *   2) Tamaño: no supera maxFiles / maxLines (fuerza trocear).
 *   3) DoD: el comando de verificación pasa (exit 0).
 *   4) Guard: el test de invariante pasa... o, en tareas de unificación que
 *      nacen rojas, DEBE fallar (guardExpect: "red").
 *
 * Uso:  node scripts/task-gate.mjs
 *       TASK_CONTRACT=otro.json node scripts/task-gate.mjs
 *
 * Sale con código != 0 y mensaje claro si algo no cumple. No hay cierre sin puerta verde.
 */
import {
  readFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  cpSync,
  rmSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { evaluateInvariant, parseMetricValue } from './task-gate-invariant.mjs'

const CONTRACT = process.env.TASK_CONTRACT || '.task/contract.json'
const BASELINE = process.env.TASK_BASELINE || '.task/baseline.json'

const fail = (msg) => {
  console.error(`\n❌ [task-gate] ${msg}\n`)
  process.exit(1)
}

function sh(cmd) {
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8' })
  return { code: r.status === null ? 1 : r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }
}

function must(cmd) {
  const r = sh(cmd)
  if (r.code !== 0) fail(`Comando falló: ${cmd}\n${r.err || r.out}`)
  return r.out
}

/** Ejecuta un comando en un directorio concreto (para el worktree base). */
function shIn(cmd, cwd) {
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8', cwd })
  return {
    code: r.status === null ? 1 : r.status,
    out: (r.stdout || '').trim(),
    err: (r.stderr || '').trim(),
  }
}

/**
 * Corre `fn(dir)` dentro de un worktree de `base`, con los guardFiles copiados
 * (pueden ser nuevos y no existir en base) y `node_modules` enlazado. Limpia
 * SIEMPRE (no llama a fail() por dentro para no saltarse el cleanup). Si el
 * montaje falla, devuelve `{ setupError }`.
 */
function runInBaseWorktree(base, guardFiles, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'flu-os4-base-'))
  const add = sh(`git worktree add --detach "${dir}" ${base}`)
  if (add.code !== 0) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    return { setupError: `No se pudo crear el worktree base (${base}):\n${add.err || add.out}` }
  }

  let result
  let setupError = null
  try {
    const nm = join(dir, 'node_modules')
    if (!existsSync(nm)) {
      try {
        symlinkSync(join(process.cwd(), 'node_modules'), nm, 'junction')
      } catch (e) {
        setupError = `No se pudo enlazar node_modules en el worktree base: ${e.message}`
      }
    }
    if (!setupError) {
      for (const f of guardFiles) {
        const dest = join(dir, f)
        mkdirSync(dirname(dest), { recursive: true })
        cpSync(f, dest)
      }
      result = fn(dir)
    }
  } catch (e) {
    setupError = e.message
  } finally {
    sh(`git worktree remove --force "${dir}"`)
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
  return setupError ? { setupError } : result
}

function globToRe(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    '^' + esc.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$',
  )
}

if (!existsSync(CONTRACT)) fail(`Falta el contrato: ${CONTRACT}`)
let c
try {
  c = JSON.parse(readFileSync(CONTRACT, 'utf8'))
} catch (e) {
  fail(`Contrato inválido (JSON): ${e.message}`)
}

const allow = Array.isArray(c.allow) ? c.allow : []
if (!allow.length) fail('El contrato no define "allow" (archivos permitidos).')
const ignore = Array.isArray(c.ignore)
  ? c.ignore
  : ['.task/**', 'scripts/task-gate*.mjs', 'kilo.json']

// 0) CONGELADOS (el criterio no puede cambiar) -----------------------------
const FROZEN = '.task/frozen.json'
if (existsSync(FROZEN)) {
  const lock = JSON.parse(readFileSync(FROZEN, 'utf8'))
  const bad = []
  for (const [file, expected] of Object.entries(lock)) {
    if (!existsSync(file)) {
      bad.push(`${file} (falta)`)
      continue
    }
    const actual = createHash('sha256').update(readFileSync(file)).digest('hex')
    if (actual !== expected) bad.push(`${file} (hash cambió)`)
  }
  if (bad.length) {
    fail(`Archivos CONGELADOS modificados (criterio inmutable):\n  ${bad.join('\n  ')}`)
  }
}

// 1) ALCANCE ---------------------------------------------------------------
const base = c.base || 'HEAD'
const tracked = must(`git diff --name-only ${base}`).split('\n')
const untracked = must('git ls-files --others --exclude-standard').split('\n')
const baseline = existsSync(BASELINE)
  ? new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).map((s) => String(s).trim()))
  : new Set()
const changed = [...new Set([...tracked, ...untracked])]
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((f) => !baseline.has(f))
  .filter((f) => !ignore.some((g) => globToRe(g).test(f)))

const outside = changed.filter((f) => !allow.some((g) => globToRe(g).test(f)))
if (outside.length) {
  fail(`Archivos FUERA de alcance (prohibido):\n  ${outside.join('\n  ')}`)
}

// 2) TAMAÑO (solo archivos del alcance, respetando baseline) -----------------
const maxFiles = Number(c.maxFiles) || 50
const maxLines = Number(c.maxLines) || 500
if (changed.length > maxFiles) {
  fail(`Demasiados archivos: ${changed.length} > ${maxFiles}. Trocea la tarea.`)
}
let lines = 0
const trackedSet = new Set(tracked.map((s) => s.trim()))
const changedTracked = changed.filter((f) => trackedSet.has(f))
if (changedTracked.length) {
  const quoted = changedTracked.map((f) => `"${f}"`).join(' ')
  const numstat = sh(`git diff --numstat ${base} -- ${quoted}`).out
  for (const row of numstat.split('\n')) {
    const [add, del] = row.split('\t')
    lines += (Number(add) || 0) + (Number(del) || 0)
  }
}
for (const f of changed.filter((f) => !trackedSet.has(f))) {
  try {
    lines += readFileSync(f, 'utf8').split('\n').length
  } catch {
    /* ignore */
  }
}
if (lines > maxLines) {
  fail(`Diff demasiado grande: ${lines} líneas > ${maxLines}. Trocea la tarea.`)
}

// 3) DoD -------------------------------------------------------------------
if (!c.dod) fail('El contrato no define "dod".')
console.log(`[task-gate] DoD: ${c.dod}`)
const dod = sh(c.dod)
if (dod.code !== 0) {
  console.log(dod.out)
  console.error(dod.err)
  fail('El comando DoD FALLÓ. La tarea NO está hecha (no sustituir por parcial).')
}

// 4) GUARD -----------------------------------------------------------------
if (c.guard) {
  const expect = c.guardExpect === 'red' ? 'red' : 'green'
  console.log(`[task-gate] Guard (${expect}): ${c.guard}`)
  const g = sh(c.guard)
  if (expect === 'green' && g.code !== 0) {
    console.log(g.out)
    console.error(g.err)
    fail('El GUARD FALLÓ: el invariante sigue en N>1. No se puede cerrar.')
  }
  if (expect === 'red' && g.code === 0) {
    fail('El GUARD debía nacer ROJO (N>1) y pasó: la tarea no está definida o la duplicación ya no existe.')
  }
}

// 4b) INVARIANTE: métrica recomputada + falsación del guard en `base` ------
// Mata el proxy genérico ("usé el helper") midiendo la PROPIEDAD: la métrica
// bajó al target Y el guard distingue base de actual. No se confía en el
// agente; la puerta recomputa todo. Ver scripts/task-gate-invariant.mjs.
if (c.invariant) {
  const inv = c.invariant
  if (!c.guard) fail('invariant requiere el comando "guard" (test del invariante).')
  if (!inv.metric || !inv.metric.command) fail('invariant.metric.command es obligatorio.')
  const target = Number(inv.metric.target)
  if (!Number.isFinite(target)) fail('invariant.metric.target debe ser un número.')

  const variantBase = inv.base || c.base || 'HEAD'
  const guardFiles = Array.isArray(inv.guardFiles) ? inv.guardFiles : []
  console.log(`[task-gate] Invariante: ${inv.statement || '(sin enunciado)'}`)
  console.log(`[task-gate]   métrica: ${inv.metric.command} → target ${target} (base ${variantBase})`)

  const baseRun = runInBaseWorktree(variantBase, guardFiles, (dir) => ({
    metric: parseMetricValue(shIn(inv.metric.command, dir).out),
    guard: shIn(c.guard, dir),
  }))
  if (baseRun.setupError) fail(baseRun.setupError)

  const verdict = evaluateInvariant({
    metricBase: () => baseRun.metric,
    metricNow: () => parseMetricValue(sh(inv.metric.command).out),
    guardBase: () => baseRun.guard,
    guardNow: () => sh(c.guard),
    target,
  })
  console.log(`[task-gate]   ${verdict.summary}`)
  if (!verdict.ok) {
    fail(`Invariante NO cumplido:\n  - ${verdict.failures.join('\n  - ')}`)
  }
}

// 5) GUARDS BASE (anti-hardcode / anti-rutas-dobles / estabilidad) ---------
if (c.skipBaseGuards !== true) {
  // P0.6: los tres guards son puramente estaticos (leen fuentes), asi que un fallo
  // intermitente NO puede venir de ellos. La causa medida era la propia invocacion:
  // arranque en frio de vitest (transform cache) con el testTimeout por defecto de 5s
  // y varios workers compitiendo. Se fija: sin paralelismo de archivos, timeout holgado
  // y UN reintento. El reintento NO tapa fallos reales: un guard determinista que falla
  // por una violacion real vuelve a fallar en el reintento y la puerta sigue en rojo.
  const BASE_GUARDS =
    'npx vitest run --no-file-parallelism --testTimeout=30000 --retry=1 --reporter=dot tests/hardcodeGuard.test.ts tests/protocolGuard.test.ts tests/stability-guards.test.ts'
  console.log(`[task-gate] Guards base: ${BASE_GUARDS}`)
  const bg = sh(BASE_GUARDS)
  if (bg.code !== 0) {
    console.log(bg.out)
    console.error(bg.err)
    fail('GUARDS BASE FALLARON (hardcode / rutas dobles / estabilidad).')
  }
}

const guardLabel = c.guard ? ' · guard OK' : ' · guard: n/a'
console.log(`\n✅ [task-gate] Alcance OK · tamaño OK · DoD OK${guardLabel}.\n`)
console.log('Cierre: pega también `git diff --stat` (evidencia §10).')
