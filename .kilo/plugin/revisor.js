/**
 * Puerta del revisor para Kilo Code: antes de que un `write` o `edit` toque
 * `src/`, corre `scripts/revisor-prehook.mjs` (la MISMA puerta que usan Claude
 * Code y opencode-claude-hooks) con el payload normalizado. Si la puerta
 * bloquea (exit 2), el tool se cancela lanzando el informe del revisor.
 *
 * Forma del plugin (Kilo): los archivos `.ts`/`.js` de `.kilo/plugin/` se
 * auto-registran al arrancar (Kilo crea el package.json y corre bun install);
 * el default export es `{ id, server }` y `server` es la función del plugin.
 * El hook `tool.execute.before` recibe `(input, output)`: el nombre del tool
 * viene en `input.tool` y los argumentos MUTABLES en `output.args`; lanzar un
 * error cancela el tool.
 *
 * OJO: si la forma de la entrada de Kilo cambiara y la ruta no se pudiera
 * leer, la puerta permite (el git + la CI del PR siguen cubriendo el cambio).
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PREHOOK = path.join(ROOT, 'scripts', 'revisor-prehook.mjs')
const OWNER_GATE = path.join(ROOT, 'scripts', 'owner-gate.mjs')

/**
 * Corre una puerta de scripts/ y devuelve su salida de error, o null si pasó.
 * @param {string} script Ruta del script.
 * @param {object} payload JSON que recibe la puerta por stdin.
 * @returns {string|null} stderr si la puerta bloqueó (exit != 0), null si pasó.
 */
function correrPuerta(script, payload) {
  const resultado = spawnSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: ROOT,
    timeout: 30_000,
  })
  return resultado.status === 0 ? null : (resultado.stderr || `${script}: bloqueado`).trim()
}

/** Payload con la forma que espera la puerta, sin importar la que use Kilo. */
function normalizar(input, output) {
  const args = output?.args ?? output?.input ?? input?.args ?? input?.input ?? {}
  return {
    tool_name: String(input?.tool ?? '').toLowerCase() === 'edit' ? 'Edit' : 'Write',
    tool_input: {
      file_path: args?.file_path ?? args?.filePath ?? args?.path ?? args?.absolutePath,
      content: args?.content,
      old_string: args?.old_string ?? args?.oldString,
      new_string: args?.new_string ?? args?.newString,
      replace_all: args?.replace_all ?? args?.replaceAll ?? false,
    },
  }
}

const servidor = async () => ({
  'tool.execute.before': async (input, output) => {
    const tool = String(input?.tool ?? '').toLowerCase()
    if (tool !== 'write' && tool !== 'edit') return
    const payload = normalizar(input, output)
    // Misma dupla que Claude/opencode: dueño del archivo nuevo, luego revisor.
    if (tool === 'write') {
      const dueño = correrPuerta(OWNER_GATE, payload)
      if (dueño) throw new Error(dueño)
    }
    const bloqueo = correrPuerta(PREHOOK, payload)
    if (bloqueo) throw new Error(bloqueo)
  },
})

export default { id: 'revisor-funciones', server: servidor }
