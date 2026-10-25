/**
 * API pública del módulo CONVERSACIÓN (costura de arranque).
 *
 * La fachada de voz re-exporta este archivo para que el módulo sea alcanzable
 * desde un entrypoint (`orphanModulesGuard`). Cuando `ports`/`adapters`/
 * `frontera`/`fila` estén, este archivo expone las 7 llamadas del plan y el
 * seed de `domain/locucion` se retira.
 */
export { crearEstado as crearEstadoDeLocucion } from './domain/locucion.ts'
