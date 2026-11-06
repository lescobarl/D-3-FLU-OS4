/**
 * Puerta del revisor para opencode: antes de que un `write` o `edit` toque
 * `src/`, delega en el adaptador compartido (`scripts/revisor-plugin-adapter.mjs`),
 * que corre `owner-gate` en `write` y `revisor-prehook` en `write`/`edit`.
 *
 * Se registra como plugin nativo de opencode (`.opencode/plugins/`), sin pasar
 * por `opencode-claude-hooks` ni por `sh -c`. Así funciona en Windows, donde
 * `sh` no está en PATH y el hook de comandos se quedaba sin ejecutar.
 *
 * El hook `tool.execute.before` recibe `(input, output)`: el nombre del tool
 * viene en `input.tool` y los argumentos MUTABLES en `output.args`; lanzar un
 * error cancela el tool.
 */
import { aplicarPuertasRevisor } from '../../scripts/revisor-plugin-adapter.mjs'

export const RevisorFuncionesPlugin = async () => ({
  'tool.execute.before': async (input, output) => {
    aplicarPuertasRevisor(input?.tool, output?.args)
  },
})
