#!/usr/bin/env node
/**
 * Puerta de git del revisor de funciones.
 *
 * Dos modos, la misma comprobación:
 *   --staged [--msg <archivo>]  hook commit-msg: compara el índice contra HEAD.
 *   --diff <base>               CI: compara HEAD contra la base del push/PR.
 *
 * En ambos modos detecta las funciones que aparecen por primera vez bajo
 * `src/` y las evalúa contra el índice del árbol de trabajo. Una función nueva
 * que se parece a una existente exige declaración en su JSDoc
 * (`@revisor CREAR NUEVO — ...`) o, en commit, los trailers
 * `Revisor-Funciones:` / `Revisor-Motivo:`.
 *
 * El modo --diff no juzga la historia: si el gate no existía en la base, se
 * omite. Así la rama que lo introduce no se bloquea a sí misma.
 *
 * Uso:
 *   node scripts/revisor-git.mjs --staged --msg .git/COMMIT_EDITMSG
 *   node scripts/revisor-git.mjs --diff origin/main
 *
 * Salida: 0 permite, 2 bloquea, 1 error de uso.
 * Alcance: archivos de código (.ts/.tsx/.js/.jsx/.mjs/.cjs) bajo src/.
 * Los renombrados puros (R) no se evalúan; sus funciones ya existían.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { indexarFunciones, indexarRepo, loadCasosRuta } from './revisor-funciones.mjs'
import { evaluarFuncion, formatearBloqueo, funcionesAgregadas } from './revisor-puertas.mjs'

const ROOT = process.env.CLAUDE_PROJECT_DIR || resolve(import.meta.dirname, '..')
const SRC_PATHSPEC = ':(icase)src/'
const CODE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i
const USO = [
  'Uso: node scripts/revisor-git.mjs --staged [--msg <archivo>]',
  '  o: node scripts/revisor-git.mjs --diff <base>',
].join('\n')

/**
 * Lee `--clave valor` o `--clave=valor`; null si no está.
 * @param {string} nombre Nombre del argumento.
 * @returns {string|null} Valor.
 */
function argValue(nombre) {
  const indice = process.argv.indexOf(nombre)
  if (indice !== -1) return process.argv[indice + 1] ?? null
  const prefijado = process.argv.find((arg) => arg.startsWith(`${nombre}=`))
  return prefijado ? prefijado.slice(nombre.length + 1) : null
}

/**
 * Ejecuta git en la raíz del repo.
 * @param {string[]} args Argumentos.
 * @returns {string} Salida.
 */
function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
}

/**
 * Bloquea la puerta con un mensaje.
 * @param {string} mensaje Motivo.
 * @returns {never} No retorna.
 */
function block(mensaje) {
  process.stderr.write(`${mensaje}\n`)
  process.exit(2)
}

/**
 * Contenido de un archivo en un commit; '' si no existe.
 * @param {string} ref Commit o base.
 * @param {string} rel Ruta relativa.
 * @returns {string} Contenido.
 */
function contenidoCommit(ref, rel) {
  try {
    return git(['show', `${ref}:${rel}`])
  } catch {
    return ''
  }
}

/**
 * Contenido de un archivo en el índice; '' si no existe.
 * @param {string} rel Ruta relativa.
 * @returns {string} Contenido.
 */
function contenidoIndice(rel) {
  try {
    return git(['show', `:${rel}`])
  } catch {
    return ''
  }
}

/**
 * Archivos de código añadidos o modificados bajo src/.
 * @param {string[]} args Argumentos del diff.
 * @returns {string[]} Rutas relativas.
 */
function archivosCambiados(args) {
  const salida = git([
    'diff',
    '--name-only',
    '--diff-filter=AM',
    '-z',
    ...args,
    '--',
    SRC_PATHSPEC,
  ])
  return salida.split('\0').filter((rel) => rel && CODE_EXT.test(rel))
}

/**
 * ¿El gate ya existía en esa base?
 * @param {string} ref Commit base.
 * @returns {boolean} Existe.
 */
function existeGateEn(ref) {
  try {
    return git(['ls-tree', '--name-only', ref, '--', 'scripts/revisor-git.mjs']).trim() !== ''
  } catch {
    // No pude leer la base: fallo cerrado, trato el gate como existente.
    return true
  }
}

/**
 * Comprueba las funciones nuevas de un conjunto de archivos.
 * @param {string[]} archivos Rutas relativas.
 * @param {(rel: string) => string} leerViejo Contenido anterior.
 * @param {(rel: string) => string} leerNuevo Contenido nuevo.
 * @param {string} mensaje Mensaje de commit, si hay.
 * @param {string} contexto Nombre de la puerta.
 * @returns {number} 0 permite, 2 bloquea.
 */
function comprobar(archivos, leerViejo, leerNuevo, mensaje, contexto) {
  if (archivos.length === 0) {
    process.stdout.write(`[revisor] OK (${contexto}): 0 archivo(s) de código tocado(s) bajo src/.\n`)
    return 0
  }
  const funciones = indexarRepo(join(ROOT, 'src'), ROOT)
  const casos = loadCasosRuta()
  const bloqueadas = []
  for (const rel of archivos) {
    const viejas = indexarFunciones(leerViejo(rel), rel)
    const nuevas = indexarFunciones(leerNuevo(rel), rel)
    for (const funcion of funcionesAgregadas(viejas, nuevas)) {
      const evaluacion = evaluarFuncion(funcion, funciones, casos, mensaje)
      if (evaluacion.bloquea) bloqueadas.push(evaluacion)
    }
  }
  if (bloqueadas.length === 0) {
    process.stdout.write(
      `[revisor] OK (${contexto}): ${archivos.length} archivo(s), sin funciones nuevas sospechosas.\n`,
    )
    return 0
  }
  process.stderr.write(`${formatearBloqueo(bloqueadas, contexto)}\n`)
  return 2
}

/**
 * Ejecuta la puerta.
 * @returns {number} Código de salida.
 */
function main() {
  const staged = process.argv.includes('--staged')
  const diffArg = argValue('--diff')
  const msgArg = argValue('--msg')
  if (staged === Boolean(diffArg)) {
    process.stderr.write(`${USO}\n`)
    return 1
  }
  if (msgArg && !staged) {
    process.stderr.write(`${USO}\n`)
    return 1
  }

  if (staged) {
    let mensaje = ''
    if (msgArg) {
      try {
        mensaje = readFileSync(msgArg, 'utf8')
      } catch (error) {
        block(`[revisor] BLOQUEADO (commit-msg): no pude leer el mensaje: ${error.message}`)
      }
    }
    let archivos
    try {
      archivos = archivosCambiados(['--cached'])
    } catch (error) {
      block(`[revisor] BLOQUEADO (commit-msg): no pude leer el índice: ${error.message}`)
    }
    return comprobar(archivos, (rel) => contenidoCommit('HEAD', rel), contenidoIndice, mensaje, 'commit-msg')
  }

  try {
    git(['rev-parse', '--verify', '--end-of-options', `${diffArg}^{commit}`])
  } catch {
    block(`[revisor] BLOQUEADO (CI): la base "${diffArg}" no es un commit válido.`)
  }
  if (!existeGateEn(diffArg)) {
    process.stdout.write('[revisor] El gate no existía en la base; no se juzga la historia.\n')
    return 0
  }
  let archivos
  try {
    archivos = archivosCambiados([diffArg, 'HEAD'])
  } catch (error) {
    block(`[revisor] BLOQUEADO (CI): no pude leer el diff: ${error.message}`)
  }
  return comprobar(
    archivos,
    (rel) => contenidoCommit(diffArg, rel),
    (rel) => contenidoCommit('HEAD', rel),
    '',
    'CI',
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main())
  } catch (error) {
    process.stderr.write(`[revisor] fallo cerrado: ${error.message}\n`)
    process.exit(2)
  }
}
