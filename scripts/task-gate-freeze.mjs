#!/usr/bin/env node
/**
 * task-gate-freeze — congela un archivo (su criterio) por hash.
 *
 * Guarda el SHA-256 de cada archivo congelado en .task/frozen.json.
 * La puerta verifica en cada ejecución que esos archivos NO cambiaron:
 * si su hash difiere, falla y bloquea el cierre/commit.
 *
 * Uso:  node scripts/task-gate-freeze.mjs <archivo> [archivo2 ...]
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const LOCK = '.task/frozen.json'
const files = process.argv.slice(2).filter(Boolean)
if (!files.length) {
  console.error('Uso: node scripts/task-gate-freeze.mjs <archivo> [archivo2 ...]')
  process.exit(1)
}

const lock = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : {}
for (const file of files) {
  if (!existsSync(file)) {
    console.error(`❌ No existe: ${file}`)
    process.exit(1)
  }
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex')
  lock[file] = hash
  console.log(`🔒 Congelado ${file}\n   sha256=${hash}`)
}
writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n', 'utf8')
console.log(`\nGuardado en ${LOCK}`)
