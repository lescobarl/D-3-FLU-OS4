/**
 * API pública del módulo CONVERSACIÓN — solo compone y re-exporta.
 *
 * 7 llamadas: `start`, `stop`, `ingestAudio`, `ingestAsr`, `snapshot`,
 * `subscribe`, `registerName`. 6 eventos: `locution.closed`, `row.committed`,
 * `speaker.labeled`, `box.updated`, `asr.status`, `barge.in`.
 *
 * Dueños únicos dentro del módulo:
 *  - `motor`   orquesta las llamadas y la cola serializada;
 *  - `sesion`  estado, caja, voz, cierre de fila;
 *  - `ingesta` audio, ASR, frontera y pendientes;
 *  - `cola`    serialización, tramos huérfanos y pendientes;
 *  - `revision`, `frontera`, `fila`  reglas 2–5 (puros);
 *  - `eco`     eco/barge-in contra `ultimoTextoDicho()`;
 *  - `ports` / `adapters`  contrato e implementaciones del producto.
 *
 * Sin `Date.now()` ni imports fuera del módulo (salvo adapters, declarado).
 */
export { crearConversacion } from './motor.ts'
export { esEcoDeTts } from './eco.ts'
export type {
  AsrIngestado,
  BloqueAudio,
  CausaCierre,
  ConversacionApi,
  DatosNombre,
  DependenciasConversacion,
  DescarteConversacion,
  EventoConversacion,
  EvidenciaVoz,
  InstantaneaConversacion,
  MotivoDescarteConversacion,
  OpcionesInicio,
} from './tipos.ts'

export { decidirRevision } from './revision.ts'
export type { DecisionRevision, TramoAbierto } from './revision.ts'
export { decidirFrontera } from './frontera.ts'
export type {
  CausaFrontera,
  DecisionFrontera,
  EntradaFrontera,
  UmbralesFrontera,
} from './frontera.ts'
export { construirFila, promoverFila } from './fila.ts'
export { resolverEtiqueta } from './fila.ts'
export type {
  CierreLocucion,
  EntradaEtiqueta,
  EtiquetaResuelta,
  MotivoDescarte,
  ResultadoFila,
  VozEtiqueta,
} from './fila.ts'
export { CONVERSACION_CONFIG } from './ports.ts'
export {
  crearAlmacenDexieProducto,
  crearAlmacenMemoria,
  crearConfigFlu,
  crearIdUuid,
  crearPartidorWake,
  crearRegistroCaughtError,
  crearRelojSistema,
} from './adapters.ts'
export { crearMotorConversacionProducto } from './producto.ts'
export type { EventoProducto, MotorConversacionProducto } from './producto.ts'
