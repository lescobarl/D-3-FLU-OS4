/**
 * Puerta del revisor para Kilo Code: antes de que un `write` o `edit` toque
 * `src/`, delega en el adaptador compartido (`scripts/revisor-plugin-adapter.mjs`),
 * que corre `owner-gate` en `write` y `revisor-prehook` en `write`/`edit`.
 *
 * Forma del plugin (Kilo): los archivos `.ts`/`.js` de `.kilo/plugin/` se
 * auto-registran al arrancar; el default export es `{ id, server }` y `server`
 * es la función del plugin. El hook `tool.execute.before` recibe `(input, output)`:
 * el nombre del tool viene en `input.tool` y los argumentos MUTABLES en
 * `output.args`; lanzar un error cancela el tool.
 *
 * OJO: si la forma de la entrada de Kilo cambiara y la ruta no se pudiera
 * leer, la puerta permite (el git + la CI del PR siguen cubriendo el cambio).
 */
import { aplicarPuertasRevisor } from '../../scripts/revisor-plugin-adapter.mjs'

const servidor = async () => ({
  'tool.execute.before': async (input, output) => {
    const args = output?.args ?? output?.input ?? input?.args ?? input?.input
    aplicarPuertasRevisor(input?.tool, args)
  },
})

export default { id: 'revisor-funciones', server: servidor }
