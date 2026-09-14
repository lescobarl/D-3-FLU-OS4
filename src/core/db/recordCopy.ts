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
