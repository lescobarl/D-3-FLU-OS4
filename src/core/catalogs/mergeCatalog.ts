// ============================================================
// Merge Catalog — Fusión built-ins + dinámicos
// ------------------------------------------------------------
// Devuelve una NUEVA lista (nunca muta los built-ins) con:
//   - built-ins primero, en su orden canónico
//   - dinámicos a continuación, sin duplicados de id
// También expone el clonado de built-ins (copia editable con id nuevo).
// ============================================================

/** Indica si un id pertenece a los built-ins (reservado: no editable/borrable). */
export function isReservedId<T>(
    id: string,
    builtins: readonly T[],
    keyOf: (item: T) => string = (item) => (item as { id: string }).id,
): boolean {
    return builtins.some((builtin) => keyOf(builtin) === id);
}

/**
 * Fusiona built-ins + dinámicos en una lista nueva.
 * Nunca muta `builtins`; los dinámicos con id reservado o duplicado se omiten.
 * `keyOf` permite definir el id canónico de cada item (por defecto `item.id`,
 * como ambientes/paletas; los sitios de búsqueda usan `dominio`).
 */
export function mergeCatalog<T>(
    builtins: readonly T[],
    dynamic: readonly T[],
    keyOf: (item: T) => string = (item) => (item as { id: string }).id,
): T[] {
    const merged: T[] = [...builtins];
    const seen = new Set<string>(merged.map((item) => keyOf(item)));
    for (const item of dynamic) {
        if (!item) continue;
        const key = keyOf(item);
        if (isReservedId(key, builtins, keyOf)) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
    }
    return merged;
}

/** Clona un built-in con un id nuevo (slug editable para ambientes). */
export function cloneBuiltin<T extends { id: string }>(builtin: T, newId: string): T {
    const copy = structuredClone(builtin);
    copy.id = newId;
    return copy;
}
