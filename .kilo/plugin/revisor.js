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
    const resultado = spawnSync(process.execPath, [PREHOOK], {
      input: JSON.stringify(normalizar(input, output)),
      encoding: 'utf8',
      cwd: ROOT,
      timeout: 30_000,
    })
    if (resultado.status === 2) {
      throw new Error((resultado.stderr || 'revisor: función duplicada').trim())
    }
  },
})

export default { id: 'revisor-funciones', server: servidor }
