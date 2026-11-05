#!/usr/bin/env node
/**
 * Puerta PreToolUse del revisor de funciones.
 *
 * Corre antes de un `Write` o un `Edit` sobre `src/`. Simula el cambio, detecta
 * las funciones que aparecen por primera vez y las evalúa contra el índice. Si
 * alguna se parece a una existente y no declara su veredicto en el JSDoc, la
 * escritura se bloquea (exit 2) y el informe dice qué candidatos hay.
 *
 * Entrada (stdin, la entrega el harness). El nombre del tool se acepta en
 * cualquier capitalización (`Write`, `write`, `EDIT`, ...) y las claves del
 * input en sus variantes habituales (`file_path`/`filePath`/`path`,
 * `old_string`/`oldString`, `new_string`/`newString`, `replace_all`/`replaceAll`)
 * para que la MISMA puerta sirva a Claude Code, al plugin de Kilo y al
 * opencode-claude-hooks:
 *   {"tool_name":"Write","tool_input":{"file_path":"src/...","content":"..."}}
 *   {"tool_name":"Edit","tool_input":{"file_path":"src/...","old_string":"...","new_string":"..."}}
 *
 * Alcance: código bajo `src/`. Tests y scripts no pasan por esta puerta.
 * LÍMITE: la etiqueta `@revisor` la escribe el agente; la puerta obliga a mirar
 * y deja rastro, no demuestra equivalencia semántica.
 */
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { indexarFunciones, indexarRepo, loadCasosRuta } from './revisor-funciones.mjs'
import { evaluarFuncion, formatearBloqueo, funcionesAgregadas } from './revisor-puertas.mjs'

const ROOT = process.env.CLAUDE_PROJECT_DIR || resolve(import.meta.dirname, '..')
const SRC_DIR = 'src/'
const CODE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i
const TOOL_WRITE = /^write$/
const TOOL_EDIT = /^edit$/

/**
 * Nombre del tool en minúsculas, venga de `tool_name` (Claude) o de `tool`
 * (Kilo/OpenCode).
 * @param {object} input Entrada del hook.
 * @returns {string} Nombre normalizado.
 */
function nombreTool(input) {
  return String(input?.tool_name ?? input?.tool ?? '').toLowerCase()
}

/**
 * Entrada del tool, de la clave que el harness use.
 * @param {object} input Entrada del hook.
 * @returns {object} Mapa de argumentos.
 */
function argsTool(input) {
  return input?.tool_input ?? input?.args ?? input?.input ?? input?.arguments ?? {}
}

/**
 * Ruta del archivo relativa a la raíz del repo, con `/`.
 * @param {string} filePath Ruta del tool.
 * @returns {string} Ruta relativa.
 */
function relativeToRoot(filePath) {
  const absolute = isAbsolute(filePath) ? filePath : resolve(ROOT, filePath)
  return relative(ROOT, absolute).split(sep).join('/')
}

/**
 * Contenido que tendría el archivo después del tool.
 * @param {string} actual Contenido actual.
 * @param {object} input Entrada del hook.
 * @returns {string|null} Contenido nuevo, o null si no aplica.
 */
function contenidoNuevo(actual, input) {
  const entrada = argsTool(input)
  if (TOOL_WRITE.test(nombreTool(input))) return typeof entrada.content === 'string' ? entrada.content : null
  if (!TOOL_EDIT.test(nombreTool(input))) return null
  const viejo = entrada.old_string ?? entrada.oldString
  const nuevo = entrada.new_string ?? entrada.newString
  if (typeof nuevo !== 'string') return null
  if (typeof viejo !== 'string' || viejo.length === 0) return nuevo
  if ((entrada.replace_all ?? entrada.replaceAll) === true) return actual.split(viejo).join(nuevo)
  const indice = actual.indexOf(viejo)
  // Si el Edit no encuentra el texto, el tool fallará; evaluar el fragmento
  // nuevo contra el archivo viejo sigue siendo un aviso útil.
  if (indice === -1) return nuevo
  return actual.slice(0, indice) + nuevo + actual.slice(indice + viejo.length)
}

/**
 * Evalúa la entrada del hook.
 * @returns {number} 0 permite, 2 bloquea.
 */
function main() {
  if (process.stdin.isTTY) return 0
  let input
  try {
    const crudo = readFileSync(0, 'utf8').trim()
    if (!crudo) return 0
    input = JSON.parse(crudo)
  } catch (error) {
    process.stderr.write(`[revisor-funciones] entrada ilegible: ${error.message}\n`)
    return 2
  }
  if (!input) return 0
  if (!TOOL_WRITE.test(nombreTool(input)) && !TOOL_EDIT.test(nombreTool(input))) return 0
  const target = argsTool(input).file_path ?? argsTool(input).filePath ?? argsTool(input).path ?? argsTool(input).absolutePath
  if (!target) return 0
  const rel = relativeToRoot(target)
  if (rel.startsWith('..')) return 0
  if (!rel.toLowerCase().startsWith(SRC_DIR)) return 0
  if (!CODE_EXT.test(rel)) return 0

  const absoluta = resolve(ROOT, rel)
  const actual = existsSync(absoluta) ? readFileSync(absoluta, 'utf8') : ''
  const nuevo = contenidoNuevo(actual, input)
  if (nuevo === null || nuevo === actual) return 0

  const viejas = indexarFunciones(actual, rel)
  const nuevas = indexarFunciones(nuevo, rel)
  const agregadas = funcionesAgregadas(viejas, nuevas)
  if (agregadas.length === 0) return 0

  const funciones = indexarRepo(join(ROOT, 'src'), ROOT)
  const casos = loadCasosRuta()
  const evaluaciones = agregadas.map((funcion) => evaluarFuncion(funcion, funciones, casos))
  const bloqueadas = evaluaciones.filter((evaluacion) => evaluacion.bloquea)
  if (bloqueadas.length === 0) return 0

  process.stderr.write(`${formatearBloqueo(bloqueadas, 'PreToolUse')}\n`)
  return 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main())
  } catch (error) {
    // La puerta falla cerrada: un error del revisor no deja pasar la escritura.
    process.stderr.write(`[revisor-funciones] fallo cerrado: ${error.message}\n`)
    process.exit(2)
  }
}
