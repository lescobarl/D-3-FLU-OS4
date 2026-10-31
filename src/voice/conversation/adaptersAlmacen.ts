/**
 * ADAPTADOR DE ALMACÉN Dexie del módulo CONVERSACIÓN.
 *
 * Implementa `AlmacenPort` sobre un `DbLike` INYECTADO: este archivo no importa
 * `core/db` (la única puerta externa es `adapters.ts`, que construye el `DbLike`
 * con `FluDatabase` y le pasa el dueño único de la tupla, `buildSyncTuple`).
 *
 * Upsert idempotente por `locutionId`: repetir la misma locución NO crea una
 * segunda fila; incrementa `revision` y actualiza `updated_at` en UTC. El
 * borrado es lógico (`deleted`), nunca físico.
 */
import type {
  AlmacenPort,
  CambiosFila,
  EvidenciaEtiqueta,
  Fila,
  FilaNueva,
  MotivoCierre,
  RelojPort,
} from './ports.ts'

/** Tupla de sincronización canónica (misma forma que `SyncTuple` de core/db). */
export type TuplaSync = Readonly<{
  revision: number
  updated_at: string
  deleted: boolean
}>

/** Registro persistido de una fila de conversación. */
export type RegistroFila = Readonly<{
  locutionId: string
  sessionId: string
  turnId: string
  texto: string
  inicioMs: number
  finMs: number
  sampleRate: number
  etiqueta: string
  evidencia: string
  /** TIMBRE medido de la voz (null si no hubo medida): evidencia inmutable. */
  firma: readonly number[] | null
  idioma: string
  overlap: boolean
  provisional: boolean
  reason: string
  sync: TuplaSync
}>

/** Acceso mínimo a la tabla; lo implementa `adapters.ts` con `FluDatabase`. */
export type DbLike = Readonly<{
  /** Lee una fila por `locutionId`. */
  leer(locutionId: string): Promise<RegistroFila | undefined>
  /** Escribe (inserta o reemplaza) una fila y espera la confirmación. */
  escribir(registro: RegistroFila): Promise<void>
  /** Ejecuta las operaciones como una transacción de escritura. */
  transaccion<T>(operacion: () => Promise<T>): Promise<T>
}>

/** Dueño único de la tupla (inyectado desde `adapters.ts`). */
export type Sincronizar = (previo: TuplaSync | undefined, ahora: number) => TuplaSync

/** Proyecta la fila de dominio al registro persistente. */
function aRegistro(fila: FilaNueva, sync: TuplaSync): RegistroFila {
  return {
    locutionId: fila.locutionId,
    sessionId: fila.sessionId,
    turnId: fila.turnId,
    texto: fila.texto,
    inicioMs: fila.tramo.inicio,
    finMs: fila.tramo.fin,
    sampleRate: fila.tramo.sampleRate,
    etiqueta: fila.etiqueta,
    evidencia: fila.evidencia,
    firma: fila.firma ?? null,
    idioma: fila.idioma,
    overlap: fila.overlap,
    provisional: fila.provisional,
    reason: fila.reason,
    sync,
  }
}

/**
 * Proyecta el registro al contrato del módulo.
 * Los campos cerrados se escribieron desde este módulo con sus uniones; el
 * registro los guarda como texto y aquí recuperan su tipo declarado.
 */
function aFila(registro: RegistroFila): Fila {
  return {
    locutionId: registro.locutionId,
    sessionId: registro.sessionId,
    turnId: registro.turnId,
    texto: registro.texto,
    tramo: {
      inicio: registro.inicioMs,
      fin: registro.finMs,
      sampleRate: registro.sampleRate,
    },
    etiqueta: registro.etiqueta,
    evidencia: registro.evidencia as EvidenciaEtiqueta,
    firma: registro.firma ?? null,
    idioma: registro.idioma as Fila['idioma'],
    overlap: registro.overlap,
    provisional: registro.provisional,
    reason: registro.reason as MotivoCierre,
    revision: registro.sync.revision,
    updated_at: Date.parse(registro.sync.updated_at),
    deleted: registro.sync.deleted,
  }
}

/**
 * Crea el almacén Dexie sobre la tabla inyectada.
 * @param opciones `db`, reloj inyectado y dueño único de la tupla.
 * @returns Un `AlmacenPort` con upsert idempotente y borrado lógico.
 */
export function crearAlmacenDexie({
  db,
  reloj,
  sincronizar,
}: {
  db: DbLike
  reloj: RelojPort
  sincronizar: Sincronizar
}): AlmacenPort {
  return {
    guardar: async (fila: FilaNueva): Promise<Fila> =>
      db.transaccion(async () => {
        const previo = await db.leer(fila.locutionId)
        const registro = aRegistro(fila, sincronizar(previo?.sync, reloj.ahora()))
        await db.escribir(registro)
        return aFila(registro)
      }),

    actualizar: async (locutionId: string, cambios: CambiosFila): Promise<Fila | null> =>
      db.transaccion(async () => {
        const previo = await db.leer(locutionId)
        if (!previo) return null
        const anterior = aFila(previo)
        const sincronizada = sincronizar(previo.sync, reloj.ahora())
        const registro = aRegistro(
          {
            ...anterior,
            texto: cambios.texto ?? anterior.texto,
            provisional: cambios.provisional ?? anterior.provisional,
            reason: cambios.reason ?? anterior.reason,
            tramo: cambios.tramo ?? anterior.tramo,
          },
          cambios.deleted === undefined ? sincronizada : { ...sincronizada, deleted: cambios.deleted },
        )
        await db.escribir(registro)
        return aFila(registro)
      }),
  }
}
