// ============================================================
// syncTuple — Única fuente de la tupla de sincronización (§3.7)
// ------------------------------------------------------------
// `buildSyncTuple` es la lógica canónica de `revision`/`updated_at`/`deleted`.
// Los servicios core la usan en vez de redefinirla localmente.
// El tipo `SyncTuple` vive en fluDatabase.ts y se re-exporta aquí para que
// este módulo sea el punto único de la tupla sin duplicar la interfaz.
// ============================================================
import type { SyncTuple } from './fluDatabase';

export type { SyncTuple };

/**
 * Construye la tupla de sincronización a partir de la anterior.
 * - Sin anterior: nace en revisión 1, timestamp `now`, no borrado.
 * - Con anterior: incrementa revisión, actualiza timestamp, conserva borrado.
 * @param previous Tupla previa (o `undefined` en la creación).
 * @param now Milisegundos del reloj inyectado por el servicio.
 */
export function buildSyncTuple(previous: SyncTuple | undefined, now: number): SyncTuple {
  if (!previous) return { revision: 1, updated_at: new Date(now).toISOString(), deleted: false };
  return {
    revision: previous.revision + 1,
    updated_at: new Date(now).toISOString(),
    deleted: previous.deleted,
  };
}
