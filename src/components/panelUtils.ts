// ============================================================
// panelUtils — Helpers compartidos por los paneles de módulos
// ============================================================
// Utilidades sin estado compartidas por los paneles. El estado "busy" de una
// acción asíncrona vive en `src/hooks/useAsyncAction.ts` (un solo dueño).
// ============================================================

import { dayKey } from '../lib/dateKey'

/**
 * Fecha local de hoy en formato 'YYYY-MM-DD'.
 * @returns La fecha del sistema en hora local, sin desfase de zona.
 */
export function todayLocalDate(): string {
    return dayKey();
}

/**
 * Clona la entrada built-in de un catalogo: 'template' (el built-in) + 'seed' (sus
 * campos editables, con el nombre sufijado). DUENO UNICO (P9.31): AmbientesPanel y
 * PaletasPanel tenian el mismo startClone cambiando solo el tipo y la clave del nombre.
 */
export function cloneSeedEntry<T extends object, S extends object>(
    builtin: T,
    editable: (value: T) => S,
    nameKey: keyof S,
    name: string,
    suffix: string | undefined,
): { template: T; seed: S } {
    const seed = editable(builtin);
    seed[nameKey] = `${name}${suffix || ' (copia)'}` as S[keyof S];
    return { template: builtin, seed };
}
