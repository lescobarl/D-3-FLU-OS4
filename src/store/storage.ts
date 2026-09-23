import { localStorePort, type LocalStorePort } from '../core/storage/localStore';

// ============================================================
// storage.ts — Almacenamiento de Zustand por la puerta unica
// ============================================================
// La resolucion del almacenamiento (localStorage en el navegador;
// memoria fuera de el) vive ahora en src/core/storage/localStore.ts.
// Este modulo se queda como la factory que espera
// `createJSONStorage(resolveSafeStorage)`; antes tenia su PROPIA copia
// del fallback en memoria, que ademas no compartia con el resto de la
// app (dos universos de memoria distintos en el mismo proceso).
// ============================================================

/**
 * Devuelve la puerta unica: el mismo almacenamiento (y el mismo
 * respaldo en memoria) que usa el resto de la app. Pensada como
 * factory para `createJSONStorage(resolveSafeStorage)` de Zustand.
 */
export function resolveSafeStorage(): LocalStorePort {
    return localStorePort();
}
