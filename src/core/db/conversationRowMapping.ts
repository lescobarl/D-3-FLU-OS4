/**
 * MAPEO ÚNICO entre la fila del motor de conversación y los metadatos
 * persistidos en `fluDb.conversations.meta`.
 *
 * Una sola función, `mapearMetaConversacion`, se usa en los DOS sentidos:
 *   - escritura: `Fila`/registro → `meta.conversacion` (vía
 *     `metaDeFilaConversacion`, que además declara el origen y la sesión);
 *   - lectura: `meta.conversacion` → campos planos del registro (vía
 *     `registroDesdeFilaConversacion`).
 *
 * Es idempotente: `mapear(mapear(x))` devuelve lo mismo. No importa el módulo
 * de conversación para no invertir la frontera: acepta la forma estructural que
 * comparten `Fila` y `MetaConversacionPersistida`.
 */
import type { ConversationEntry, ConversationMetaFila } from '../../types/bridge.ts'

/** Metadatos canónicos tal como quedan persistidos. */
export type MetaConversacionPersistida = ConversationMetaFila

/** Metadatos completos de la entrada (origen + sesión + campos del motor). */
export type MetaConversacionEntrada = NonNullable<ConversationEntry['meta']>

/**
 * Forma estructural común: `Fila` trae `tramo.sampleRate`; los metadatos
 * persistidos traen `sampleRate` en la raíz. Ambas se normalizan igual.
 */
export type OrigenMetaConversacion = Readonly<{
  /** Tramo de la locución; `sampleRate` puede venir aquí o en la raíz. */
  tramo: Readonly<{ inicio: number; fin: number; sampleRate?: number }>
  /** Frecuencia en la raíz (forma persistida); si falta, se usa la del tramo. */
  sampleRate?: number
  /** Turno que agrupó la locución. */
  turnId: string
  /** Etiqueta afirmada de la voz. */
  etiqueta: string
  /** Evidencia de la etiqueta (el módulo ya la tipa; aquí se conserva). */
  evidencia: string
  /** Idioma de la locución. */
  idioma: string
  /** ¿Hubo solape de voces? */
  overlap: boolean
  /** Cierre provisional o definitivo. */
  provisional: boolean
  /** Motivo declarado del cierre. */
  reason: string
}>

/**
 * Normaliza los campos de una fila de conversación a los metadatos persistidos.
 * Único mapeo del dominio: la escritura y la lectura pasan por aquí.
 * @param origen Fila del módulo o metadatos ya persistidos.
 * @returns Metadatos con `tramo` y `sampleRate` separados y campos tipados.
 */
export function mapearMetaConversacion(origen: OrigenMetaConversacion): MetaConversacionPersistida {
  return {
    tramo: { inicio: origen.tramo.inicio, fin: origen.tramo.fin },
    sampleRate: Number(origen.sampleRate ?? origen.tramo.sampleRate),
    turnId: String(origen.turnId),
    etiqueta: String(origen.etiqueta),
    evidencia: origen.evidencia as MetaConversacionPersistida['evidencia'],
    idioma: origen.idioma as MetaConversacionPersistida['idioma'],
    overlap: Boolean(origen.overlap),
    provisional: Boolean(origen.provisional),
    reason: origen.reason as MetaConversacionPersistida['reason'],
  }
}

/**
 * Metadatos completos que se guardan en `meta`: declara la ruta de escritura,
 * la sesión y los campos canónicos. Escritor y hook llaman a esta MISMA función,
 * así la comparación de "fila ya persistida" no depende de copias divergentes.
 * @param origen Fila del módulo (o metadatos persistidos).
 * @param sessionId Sesión que produjo la fila.
 * @returns Metadatos listos para `ConversationEntry.meta`.
 */
export function metaDeFilaConversacion(
  origen: OrigenMetaConversacion,
  sessionId: string,
): MetaConversacionEntrada {
  return {
    origin: 'conversation-module',
    sessionId: String(sessionId),
    conversacion: mapearMetaConversacion(origen),
  }
}
