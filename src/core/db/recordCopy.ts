// ============================================================
// recordCopy — Copia superficial de una fila persistida (V14)
// ------------------------------------------------------------
// Los servicios core entregan copias de las filas que devuelve Dexie
// para no mutar el objeto original. La misma lambda estaba copiada en
// 12 servicios; aquí vive en un único punto compartido.
// ============================================================

/**
 * Copia superficial (nivel 1) de una fila persistida.
 * @param row Fila tal como la entrega la capa de persistencia.
 * @returns Fila nueva con las mismas claves y valores.
 */
export function copyRecord<T extends object>(row: T): T {
  return { ...row };
}

/**
 * ¿La fila está viva (no marcada como borrada lógica)?
 * Dueño único del predicado de borrado lógico: lo consumen los lectores de
 * listas y `getAliveRecord`; ningún módulo repite `sync.deleted`.
 * @param row Fila con tupla de sincronización, o null/undefined.
 * @returns true si existe y no está borrada.
 */
export function isLiveRecord(
  row: { sync?: { deleted?: boolean } } | null | undefined,
): boolean {
  return row != null && !row.sync?.deleted;
}

/**
 * Lee las filas VIVAS de una tabla de lista.
 * Dueño único del patrón "toArray + descartar borradas" de los lectores.
 * @param table Tabla con `toArray`.
 * @returns Filas vivas.
 */
export async function listAliveRecords<T extends { sync?: { deleted?: boolean } }>(
  table: { toArray(): Promise<T[]> },
): Promise<T[]> {
  return (await table.toArray()).filter(isLiveRecord);
}

/**
 * Crea el lector filtrado de una lista viva.
 * Dueño único del "listAliveRecords + filtro + copia" que repetían los servicios.
 * @param table Tabla con `toArray`.
 * @param copy Copia de fila.
 * @param filter Filtro puro de la lista.
 * @returns Función `(filtro) => filas`.
 */
export function createFilteredAliveList<
  T extends { sync?: { deleted?: boolean } },
  F,
>(
  table: { toArray(): Promise<T[]> },
  copy: (row: T) => T,
  filter: (rows: T[], value: F) => T[],
  fallback: F,
): (value?: F) => Promise<T[]> {
  return async (value: F = fallback) => {
    const rows = await listAliveRecords(table);
    return filter(rows, value).map(copy);
  };
}

/**
 * Lee una fila VIVA (no borrada lógicamente) y la entrega copiada.
 * Dueño único del patrón "get + descartar deleted + copiar" que repetían los
 * servicios.
 * @param table Tabla con `get` por id.
 * @param id Id de la fila.
 * @returns Copia de la fila viva, o `undefined` si no existe o está borrada.
 */
export async function getAliveRecord<T extends { sync?: { deleted?: boolean } }>(
  table: { get(id: string): Promise<T | undefined> },
  id: string,
): Promise<T | undefined> {
  if (!id) return undefined;
  const row = await table.get(id);
  return isLiveRecord(row) ? copyRecord(row as T) : undefined;
}
