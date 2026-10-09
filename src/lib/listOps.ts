/**
 * listOps.ts — DUENO UNICO de las operaciones triviales sobre listas puras que
 * notesList y shoppingList tenian copiadas cambiando solo el nombre del flag (P9.38).
 */

/** Marca el flag booleano de TODOS los items a `false`, sellando `updatedAt`. */
export function uncheckAllFlagged<T extends { updatedAt: number }, K extends keyof T>(
    items: readonly T[],
    flag: K,
): T[] {
    const now = Date.now();
    return items.map((item) => (item[flag] ? { ...item, [flag]: false as T[K], updatedAt: now } : item));
}
