/**
 * Borrado + refresco de lista. Dueño único del patrón "si borró, recarga".
 *
 * Lo usan los hooks de listas (notas, compras): la llamada al servicio y la
 * recarga condicionada viven aquí, no copiadas en cada hook.
 * @param remove Operación de borrado del servicio.
 * @param refresh Recarga de la lista tras un borrado efectivo.
 * @param id Identificador a borrar.
 * @returns true si el servicio confirmó el borrado.
 */
export async function removeAndRefresh(
    remove: (id: string) => Promise<boolean>,
    refresh: () => Promise<void>,
    id: string,
): Promise<boolean> {
    const removed = await remove(id);
    if (removed) await refresh();
    return removed;
}
