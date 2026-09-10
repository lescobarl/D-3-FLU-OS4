#!/usr/bin/env node
/**
 * task-gate-setup — monta la puerta de tareas (AGENTS.md §10).
 *
 * 1) Instala el hook pre-commit que ejecuta scripts/task-gate.mjs (bloquea commits
 *    fuera de alcance / sin DoD / con guard en rojo).
 * 2) Añade el script npm "gate".
 *
 * Uso:  node scripts/task-gate-setup.mjs
 */
import { writeFileSync, existsSync, chmodSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const HOOK = '.git/hooks/pre-commit'
const HOOK_BODY = '#!/bin/sh\nnode scripts/task-gate.mjs || exit 1\n'

if (!existsSync('.git')) {
  console.error('❌ No hay repositorio git en la raíz.')
  process.exit(1)
}

writeFileSync(HOOK, HOOK_BODY, 'utf8')
try {
  chmodSync(HOOK, 0o755)
} catch {
  /* Windows: git ejecuta el hook vía sh aunque no tenga bit +x */
}

// package.json -> "gate"
if (existsSync('package.json')) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  pkg.scripts = pkg.scripts || {}
  pkg.scripts.gate = 'node scripts/task-gate.mjs'
  pkg.scripts['gate:baseline'] = 'node scripts/task-gate-baseline.mjs'
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n', 'utf8')
}

// Captura baseline de cambios preexistentes (árbol sucio).
spawnSync('node scripts/task-gate-baseline.mjs', { shell: true, stdio: 'inherit' })

const check = spawnSync('node scripts/task-gate.mjs', { shell: true, encoding: 'utf8' })
console.log('✅ Hook pre-commit instalado. Script npm "gate" añadido.')
console.log('Prueba del gate (estado actual):')
console.log(check.stdout || '')
console.error(check.stderr || '')
