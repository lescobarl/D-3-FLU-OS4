/**
 * ESCRITOR ÚNICO de `fluDb.conversations`.
 *
 * Toda escritura de la tabla (fila del motor de conversación, consolidación del
 * historial, borrado lógico y redirección de la tubería legacy) pasa por este
 * archivo. `conversacionEscritorUnicoGuard` exige N=1 y apunta aquí.
 *
 * El mapeo a `meta.conversacion` NO se reimplementa: usa el dueño único
 * `mapearMetaConversacion`/`metaDeFilaConversacion` de
 * `conversationRowMapping.ts`, en los dos sentidos.
 */
import { fluDb, type ConversationRow, type SyncTuple } from './fluDatabase.ts'
import { buildSyncTuple } from './syncTuple.ts'
import { mapearMetaConversacion, metaDeFilaConversacion } from './conversationRowMapping.ts'

/** Registro plano de una locución, tal como lo entrega el almacén del módulo. */
export type RegistroConversacion = Readonly<{
  /** Id de la locución (= `tramoId`); es la clave de la fila. */
  locutionId: string
  /** Sesión que produjo la locución. */
  sessionId: string
  /** Turno que agrupó la locución. */
  turnId: string
  /** Texto commiteado. */
  texto: string
  /** Muestra inicial del tramo. */
  inicioMs: number
  /** Muestra final (exclusiva) del tramo. */
  finMs: number
  /** Frecuencia de captura del tramo. */
  sampleRate: number
  /** Etiqueta afirmada de la voz. */
  etiqueta: string
  /** Evidencia de la etiqueta. */
  evidencia: string
  /** TIMBRE medido de la voz (null si no hubo medida): se persiste como `signature`. */
  firma: readonly number[] | null
  /** Idioma de la locución. */
  idioma: string
  /** ¿Hubo solape de voces? */
  overlap: boolean
  /** Cierre provisional o definitivo. */
  provisional: boolean
  /** Motivo declarado del cierre. */
  reason: string
  /** Tupla de sincronización ya calculada por el almacén. */
  sync: SyncTuple
}>

/** Contexto de propiedad de la fila (usuario y voz), inyectado por el adaptador. */
export type ContextoRegistroConversacion = Readonly<{
  /** Participante dueño de la fila (aislamiento multiusuario). */
  participantId?: string
  /** Clave de la VOZ de la fila (nunca un nombre propio). */
  speakerId?: string
  /** Nombre/etiqueta visible de la voz. */
  speakerName?: string
}>

/** Clave legacy de una fila de usuario sin voz identificada. */
const SPEAKER_ID_POR_DEFECTO = 'usuario'

/**
 * Proyecta una fila persistida al registro plano del módulo.
 * La lectura de los campos del motor usa el MISMO mapeo que la escritura.
 * @param fila Fila de `conversations`.
 * @returns Registro plano, o `undefined` si la fila no nació del motor.
 */
export function registroDesdeFilaConversacion(
  fila: ConversationRow,
): RegistroConversacion | undefined {
  const meta = fila.meta?.conversacion
  if (!meta) return undefined
  const canonica = mapearMetaConversacion(meta)
  return {
    locutionId: fila.id,
    sessionId: fila.sessionId || fila.meta?.sessionId || '',
    turnId: canonica.turnId,
    texto: fila.text,
    inicioMs: canonica.tramo.inicio,
    finMs: canonica.tramo.fin,
    sampleRate: canonica.sampleRate,
    etiqueta: canonica.etiqueta,
    evidencia: canonica.evidencia,
    firma: fila.signature ?? null,
    idioma: canonica.idioma,
    overlap: canonica.overlap,
    provisional: canonica.provisional,
    reason: canonica.reason,
    sync: fila.sync,
  }
}

/**
 * Escribe una locución del motor como fila de `conversations`.
 * El `sync` llega ya calculado por el almacén: aquí no se incrementa dos veces.
 * @param registro Registro plano de la locución.
 * @param contexto Usuario y voz dueños de la fila.
 * @returns La fila persistida.
 */
export async function escribirRegistroConversacion(
  registro: RegistroConversacion,
  contexto: ContextoRegistroConversacion = {},
): Promise<ConversationRow> {
  const meta = metaDeFilaConversacion(
    {
      tramo: {
        inicio: registro.inicioMs,
        fin: registro.finMs,
        sampleRate: registro.sampleRate,
      },
      turnId: registro.turnId,
      etiqueta: registro.etiqueta,
      evidencia: registro.evidencia,
      idioma: registro.idioma,
      overlap: registro.overlap,
      provisional: registro.provisional,
      reason: registro.reason,
    },
    registro.sessionId,
  )
  const marca = Date.parse(registro.sync.updated_at)
  const fila: ConversationRow = {
    id: registro.locutionId,
    role: 'user',
    text: registro.texto,
    speakerId: String(contexto.speakerId || SPEAKER_ID_POR_DEFECTO),
    speakerName: String(contexto.speakerName ?? registro.etiqueta),
    // TIMBRE medido de la fila (mandato 2026-10-11/13): persiste como `signature`
    // para que la restauración conserve el vínculo fila↔voz por timbre.
    signature: registro.firma ? [...registro.firma] : null,
    timestamp: Number.isFinite(marca) ? marca : Date.now(),
    sessionId: registro.sessionId,
    participantId: contexto.participantId,
    meta,
    sync: registro.sync,
  }
  await fluDb.conversations.put(fila)
  return fila
}

/**
 * Lee el registro plano de una locución por su id.
 * @param locutionId Id de la locución.
 * @returns Registro plano, o `undefined` si no existe o no es del motor.
 */
export async function leerRegistroConversacion(
  locutionId: string,
): Promise<RegistroConversacion | undefined> {
  const fila = await fluDb.conversations.get(locutionId)
  return fila ? registroDesdeFilaConversacion(fila) : undefined
}



/**
 * Lee TODAS las filas de conversación. Única puerta de lectura masiva.
 * @returns Filas de `conversations`.
 */
export async function listarConversaciones(): Promise<ConversationRow[]> {
  return fluDb.conversations.toArray()
}

/**
 * Lee un lote de filas por id por la puerta única.
 * @param ids Ids de las filas.
 * @returns Filas existentes (misma posición; `undefined` si falta).
 */
export async function leerConversacionesPorIds(
  ids: readonly string[],
): Promise<(ConversationRow | undefined)[]> {
  return fluDb.conversations.bulkGet([...ids])
}

/**
 * Consolida un lote de filas ya construidas (historial del store).
 * @param rows Filas a insertar o reemplazar.
 */
export async function bulkPutConversationRecords(
  rows: readonly ConversationRow[],
): Promise<void> {
  if (!rows.length) return
  await fluDb.conversations.bulkPut([...rows])
}

/**
 * Marca las filas indicadas como borradas lógicamente (`sync.deleted`).
 * @param ids Ids de las filas.
 * @returns Número de filas modificadas.
 */
export async function softDeleteConversationRows(ids: readonly string[]): Promise<number> {
  if (!ids.length) return 0
  return fluDb.conversations.where('id').anyOf([...ids]).modify((row) => {
    row.sync = { ...buildSyncTuple(row.sync, Date.now()), deleted: true }
  })
}

/**
 * Ejecuta operaciones sobre `conversations` en una transacción de escritura.
 * @param operacion Operación que lee y escribe dentro de la misma transacción.
 * @returns El resultado de la operación.
 */
export function transaccionConversaciones<T>(operacion: () => Promise<T>): Promise<T> {
  return fluDb.transaction('rw', fluDb.conversations, operacion)
}
