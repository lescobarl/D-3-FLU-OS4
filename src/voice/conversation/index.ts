/**
 * API pública del módulo CONVERSACIÓN (costura de arranque).
 *
 * La fachada de voz re-exporta este archivo para que el módulo sea alcanzable
 * desde un entrypoint (`orphanModulesGuard`). Cuando `frontera`/`revision`/
 * `fila` estén, este archivo expone las 7 llamadas del plan y el seed de
 * `domain/locucion` se retira.
 *
 * Los adaptadores se re-exportan aquí mientras se construye el motor: son la
 * única puerta externa y el orquestador (paso 5) los consume desde este módulo.
 */
export { crearEstado as crearEstadoDeLocucion } from './domain/locucion.ts'
export { decidirRevision } from './revision.ts'
export type { DecisionRevision, TramoAbierto } from './revision.ts'
export { decidirFrontera } from './frontera.ts'
export type {
  CausaFrontera,
  DecisionFrontera,
  EntradaFrontera,
  UmbralesFrontera,
} from './frontera.ts'
export { CONVERSACION_CONFIG, motorConversacionActivo } from './ports.ts'
export {
  crearAlmacenMemoria,
  crearConfigFlu,
  crearIdUuid,
  crearPartidorWake,
  crearRegistroCaughtError,
  crearRelojSistema,
} from './adapters.ts'
