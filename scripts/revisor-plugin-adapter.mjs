/**
 * Adaptador compartido de las puertas del revisor.
 *
 * Dueño ÚNICO de: normalizar el payload del host (`write`/`edit`), ejecutar
 * `owner-gate` antes de un `write`, ejecutar `revisor-prehook` antes de un
 * `write`/`edit` y convertir un bloqueo (exit != 0) en el error que cancela la
 * herramienta. Los plugins de Kilo y de opencode solo traducen su evento a
 * `aplicarPuertasRevisor`; no reimplementan las puertas ni su normalización.
 *
 * No usa shell (`sh`): lanza Node directamente con el script y el payload por
 * stdin. Así funciona igual en Windows, donde `sh` no está en PATH.
 *
 * Usa `node` del PATH (o `FLU_NODE`), NO `process.execPath`: los plugins de
 * Kilo y opencode corren sobre Bun, donde `process.execPath` es el binario del
 * host (kilo.exe/opencode.exe), no un intérprete de Node.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OWNER_GATE = path.join(ROOT, 'scripts', 'owner-gate.mjs')
const PREHOOK = path.join(ROOT, 'scripts', 'revisor-prehook.mjs')
const NODE = process.env.FLU_NODE || 'node'

/**
 * Convierte los argumentos del host al payload que leen las puertas.
 * @param {string} tool Nombre del tool ya normalizado a minúsculas.
 * @param {object} args Argumentos del tool (`filePath`/`file_path`, ...).
 * @returns {{tool_name: string, tool_input: object}} Payload normalizado.
 */
export function normalizarEntrada(tool, args) {
  const entrada = args ?? {}
  return {
    tool_name: tool === 'edit' ? 'Edit' : 'Write',
    tool_input: {
      file_path: entrada.file_path ?? entrada.filePath ?? entrada.path ?? entrada.absolutePath,
      content: entrada.content,
      old_string: entrada.old_string ?? entrada.oldString,
      new_string: entrada.new_string ?? entrada.newString,
      replace_all: entrada.replace_all ?? entrada.replaceAll ?? false,
    },
  }
}

/**
 * Corre una puerta con el payload por stdin.
 * @param {string} script Ruta absoluta del script.
 * @param {object} payload Payload normalizado.
 * @returns {string|null} stderr si bloqueó; null si permitió.
 */
function correrPuerta(script, payload) {
  const resultado = spawnSync(NODE, [script], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: ROOT,
    timeout: 30_000,
  })
  if (resultado.status === 0) return null
  // Falla cerrada: timeout, error de spawn o exit != 0 bloquean.
  return (resultado.stderr || `${path.basename(script)}: bloqueado`).trim()
}

/**
 * Aplica las puertas del revisor a una escritura o edición.
 * @param {string} tool Nombre del tool del host (`write`/`edit`).
 * @param {object} args Argumentos del tool.
 * @returns {void}
 * @throws {Error} Si una puerta bloquea; el host cancela la herramienta.
 */
export function aplicarPuertasRevisor(tool, args) {
  const nombre = String(tool ?? '').toLowerCase()
  if (nombre !== 'write' && nombre !== 'edit') return
  const payload = normalizarEntrada(nombre, args)

  if (nombre === 'write') {
    const bloqueo = correrPuerta(OWNER_GATE, payload)
    if (bloqueo) throw new Error(bloqueo)
  }

  const bloqueo = correrPuerta(PREHOOK, payload)
  if (bloqueo) throw new Error(bloqueo)
}
