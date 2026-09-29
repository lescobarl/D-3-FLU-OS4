#!/usr/bin/env node
/**
 * session-brief - briefing de arranque de una sesion, en UN comando.
 *
 * POR QUE EXISTE (medido, no supuesto): en una sesion nueva el coste mayor no es
 * escribir codigo, es la ARQUEOLOGIA de arranque: averiguar que queda pendiente,
 * contra que base se mide, si el arbol esta limpio y en que orden se valida. Sin
 * este comando eso son ~8 lecturas encadenadas (ledger completo, git log con
 * cuerpos, .task/contract.json, .task/report de cientos de KB, package.json,
 * git status, git log --stat). Con el, una sola y corta.
 *
 * QUE MIDE Y QUE NO: solo LEE. No ejecuta tests, no escribe nada y NO comprueba el
 * alcance del contrato: el dueno unico de esa comprobacion es "npm run gate".
 * Repetir aqui el matcher de globs seria una segunda fuente de la misma regla, y
 * una regla con dos duenos se desincroniza.
 *
 * USO
 *   npm run brief              -> resumen legible
 *   npm run brief -- --files   -> anade la lista de ficheros cambiados
 *   npm run brief -- --json    -> el mismo dato, legible por maquina
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const OPCIONES = new Set(process.argv.slice(2))
const CONTRATO = '.task/contract.json'
const LEDGER = 'plans/ledger.json'

/** git sin ruido: si el comando falla (base inexistente, repo sin commits) devuelve ''. */
function git(...args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

/** Lee un JSON del repo; si no existe o esta roto, devuelve el valor por defecto. */
function leerJson(ruta, porDefecto) {
  if (!existsSync(ruta)) return porDefecto
  try {
    return JSON.parse(readFileSync(ruta, 'utf8'))
  } catch {
    return porDefecto
  }
}

const lineas = (texto) => String(texto || '').split('\n').filter(Boolean)
const recorta = (texto, n) => (texto.length > n ? texto.slice(0, n - 3) + '...' : texto)

const contrato = leerJson(CONTRATO, {})
const ledger = leerJson(LEDGER, { items: [], done: [] })
const base = String(contrato.base || 'HEAD')

const seguidos = lineas(git('diff', '--name-only', base))
const nuevos = lineas(git('ls-files', '--others', '--exclude-standard'))
const cambiados = [...new Set([...seguidos, ...nuevos])]
const sucios = lineas(git('status', '--porcelain'))
const pendientes = (ledger.items || []).filter((i) => i.estado && i.estado !== 'done')

const dato = {
  rama: git('rev-parse', '--abbrev-ref', 'HEAD') || '(sin rama)',
  head: git('log', '-1', '--format=%h %s'),
  arbol: sucios.length ? `sucio (${sucios.length})` : 'limpio',
  base,
  cambiados: cambiados.length,
  seguidos: seguidos.length,
  nuevos: nuevos.length,
  maxFiles: contrato.maxFiles,
  maxLines: contrato.maxLines,
  allow: (contrato.allow || []).length,
  e2eScope: Object.keys(contrato.e2eScope || {}).length,
  done: (ledger.done || []).length,
  pendientes: pendientes.map((i) => ({ id: i.id, titulo: i.titulo, estado: i.estado })),
  ficheros: cambiados,
}

if (OPCIONES.has('--json')) {
  console.log(JSON.stringify(dato, null, 2))
  process.exit(0)
}

const fila = (etiqueta, valor) => console.log(`${etiqueta.padEnd(12)}${valor}`)

console.log(`BRIEF ${new Date().toISOString().slice(0, 19)}`)
fila('rama', dato.rama)
fila('HEAD', recorta(dato.head, 96))
fila('arbol', dato.arbol)
fila(
  'base',
  `${dato.base}  cambiados ${dato.cambiados} (seguidos ${dato.seguidos} + nuevos ${dato.nuevos})` +
    `  limites maxFiles ${dato.maxFiles} / maxLines ${dato.maxLines}`,
)
fila('allow', `${dato.allow} rutas   e2eScope ${dato.e2eScope} rutas`)
fila('ledger', `${pendientes.length} pendientes | ${dato.done} done`)

if (pendientes.length) {
  console.log('pendientes')
  for (const p of pendientes) console.log(`  - ${String(p.id).padEnd(8)} [${p.estado}] ${recorta(p.titulo || '', 92)}`)
} else {
  console.log('pendientes  ninguno: el ledger no tiene trabajo abierto')
}

if (OPCIONES.has('--files')) {
  console.log(`ficheros (${cambiados.length})`)
  for (const f of cambiados) console.log(`  ${f}`)
}

console.log('validacion (en este orden)')
console.log('  1) npm run test:file <ruta tocada>      <- solo el fichero del cambio')
console.log('  2) npm run lint && npm run typecheck    <- barrera por cambio')
console.log('  3) npm run gate                         <- CIERRE, UNA sola vez')
console.log('  4) npm run e2e:plan                     <- dry-run acotado al bloque')
console.log('prohibido   npm run test:full salvo peticion explicita del usuario en ESE turno')
