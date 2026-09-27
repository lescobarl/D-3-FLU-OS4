/**
 * Destino de nota "Super" (la lista del súper).
 *
 * FORMA CANÓNICA (una sola): la nota se llama 'Super' y los ÍTEMS viven en el
 * `body`, uno por línea — la misma forma que la nota de demo (demoSeed).
 *
 * Defecto medido: las rutas de append del parser emitían el ítem DENTRO de la
 * etiqueta ("Super: el cloro"), así que el nombre de la nota se comía la lista
 * y el body quedaba sin ella: el usuario veía "Super: el cloro" como TÍTULO en
 * vez de "el cloro" como un ítem más de la lista.
 *
 * Aquí vive la ÚNICA definición del destino: predicado, ítems embebidos en
 * etiquetas heredadas (`Super: {ítems}` de versiones anteriores), troceado del
 * body, unión de ítems y plan de escritura. Los consumidores (parser de notas,
 * handler de App, contexto del modelo) no reimplementan este criterio.
 */

import { stripDiacriticsLower } from '../../lib/textUtils';

/** Nombre canónico del destino. */
export const SUPER_TARGET_LABEL = 'Super';

/** Prefijo del destino. `\b` evita capturar "supermercado". */
const SUPER_PREFIX = /^super\b\s*:?\s*/i;

/** Un ítem por línea, o varios separados por coma / punto y coma. */
const ITEM_SEPARATOR = /[\n,;]+/;

/** Artículo inicial que no cuenta al decidir si un ítem ya está en la lista. */
const LEADING_ARTICLE = /^(?:el|la|los|las|un|una|unos|unas)\s+/i;

/** Clave de comparación de ítems: sin acentos, sin mayúsculas, sin artículo. */
export function superItemKey(item: unknown): string {
    return stripDiacriticsLower(String(item ?? '').trim())
        .replace(LEADING_ARTICLE, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** ¿La etiqueta pertenece al destino "Super"? Cubre `Super` y `Super: {ítems}`. */
export function isSuperNoteLabel(label: unknown): boolean {
    return SUPER_PREFIX.test(String(label ?? '').trim());
}

/** Ítems embebidos en una etiqueta heredada `Super: {ítems}` ('' si no hay). */
export function superNoteLabelItems(label: unknown): string {
    const text = String(label ?? '').trim();
    return isSuperNoteLabel(text) ? text.replace(SUPER_PREFIX, '').trim() : '';
}

/** Ítems de un contenido: uno por línea o separados por coma / punto y coma. */
export function superNoteItems(body: unknown): string[] {
    return String(body ?? '')
        .split(ITEM_SEPARATOR)
        .map((item) => item.trim())
        .filter(Boolean);
}

/** Une ítems en el contenido canónico (uno por línea, sin repetir ítem). */
export function appendSuperNoteItems(existing: unknown, incoming: readonly unknown[]): string {
    const items = superNoteItems(existing);
    const seen = new Set(items.map(superItemKey));
    for (const raw of incoming) {
        for (const item of superNoteItems(raw)) {
            const key = superItemKey(item);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            items.push(item);
        }
    }
    return items.join('\n');
}

/**
 * Quita ítems del contenido: devuelve el body sin las líneas cuyo ítem coincide
 * (comparación por `superItemKey`: sin acentos, sin mayúsculas, sin artículo).
 * Capacidad que faltaba: "borra el cloro de la nota del súper" quitaba la nota
 * ENTERA o no hacía nada, porque solo existían alta y borrado de nota completa.
 */
export function removeSuperNoteItems(existing: unknown, removals: readonly unknown[]): string {
    const keys = new Set(removals.map(superItemKey).filter(Boolean));
    if (keys.size === 0) return superNoteItems(existing).join('\n');
    return superNoteItems(existing)
        .filter((item) => !keys.has(superItemKey(item)))
        .join('\n');
}

/** Fila del destino que el plan necesita para decidir. */
export interface SuperNoteRow {
    id?: string;
    label: string;
    body?: string;
    done?: boolean;
    createdAt?: number;
}

export interface SuperNoteWrite<T extends SuperNoteRow> {
    /** Fila viva a actualizar (null si el destino aún no existe). */
    target: T | null;
    /** Contenido canónico resultante, con los ítems heredados ya absorbidos. */
    body: string;
    /** Filas duplicadas del mismo destino: su contenido va al `target` y se retiran. */
    absorbed: T[];
}

/**
 * Decide la ÚNICA fila viva del destino y su contenido.
 *
 * Las etiquetas heredadas `Super: {ítems}` dejan de ser un destino aparte: sus
 * ítems pasan al body y el nombre vuelve a 'Super'. Los duplicados del mismo
 * destino (el defecto creaba una fila por ítem) se absorben en la fila más
 * antigua, así que la lista es una sola y ningún ítem se pierde.
 */
export function planSuperNoteWrite<T extends SuperNoteRow>(
    rows: readonly T[],
    incoming: readonly unknown[] = [],
): SuperNoteWrite<T> {
    const live = rows
        .filter((row) => !row.done && isSuperNoteLabel(row.label))
        .slice()
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    const target = live[0] ?? null;
    const absorbed = live.slice(1);
    const body = appendSuperNoteItems('', [
        target ? superNoteLabelItems(target.label) : '',
        target ? target.body : '',
        ...absorbed.flatMap((row) => [superNoteLabelItems(row.label), row.body]),
        ...incoming,
    ]);
    return { target, body, absorbed };
}
