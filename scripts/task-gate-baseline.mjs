#!/usr/bin/env node
/**
 * task-gate-baseline — captura los cambios PREEXISTENTES al iniciar una tarea.
 *
 * Escribe .task/baseline.json con los archivos ya modificados/nuevos en el árbol.
 * La puerta ignora esos archivos, de modo que solo evalúa lo que se toca EN la tarea.
 *
 * Uso:  node scripts/task-gate-baseline.mjs
 *       (recomendado tras un checkpoint, o al empezar una tarea sobre árbol sucio)
 */
import { writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const sh = (cmd) => (spawnSync(cmd, { shell: true, encoding: 'utf8' }).stdout || '').trim()

const tracked = sh('git diff --name-only HEAD').split('\n')
const untracked = sh('git ls-files --others --exclude-standard').split('\n')
const files = [...new Set([...tracked, ...untracked])]
  .map((s) => s.trim())
  .filter(Boolean)
  // La infraestructura de la puerta no cuenta como cambio de tarea.
  .filter((f) => !/^\.task\//.test(f))
  .filter((f) => !/^scripts\/task-gate/.test(f))

writeFileSync('.task/baseline.json', JSON.stringify(files, null, 2) + '\n', 'utf8')
console.log(`✅ Baseline: ${files.length} archivos preexistentes ignorados por la puerta.`)
