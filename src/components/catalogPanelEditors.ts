/**
 * catalogPanelEditors.ts — DUENO UNICO de los handlers que AmbientesPanel y
 * PaletasPanel tenian escritos dos veces (P9.31): el mapa de motivo de error, abrir el
 * editor en modo crear/editar y el envio del formulario. Lo unico propio de cada panel es
 * el DATO (textos, built-ins y tipos).
 */
import { saveCatalogEntry, type CatalogSaveArgs } from '../core/catalogs/catalogEditorSave';
import type { RegisterResult, UpdateResult } from '../core/catalogs/catalogRegistry';

/** Textos de error del catalogos (los del panel, con default de sistema). */
export interface CatalogReasonTexts {
    duplicate: string;
    notFound: string;
}

/** UI de errores del panel (FLU_CONFIG.ui.<catalogo>). */
export interface CatalogReasonUi {
    duplicateError?: string;
    reservedError?: string;
    notFoundError?: string;
    invalidError?: string;
}

/** Motivo de error del registry -> texto de UI. Un solo dueno del switch. */
export function mapCatalogReason(
    reason: string,
    ui: CatalogReasonUi,
    texts: CatalogReasonTexts,
): string {
    switch (reason) {
        case 'duplicate':
            return ui.duplicateError || texts.duplicate;
        case 'reserved':
            return ui.reservedError || 'Ese identificador está reservado por el sistema.';
        case 'not-found':
            return ui.notFoundError || texts.notFound;
        default:
            return ui.invalidError || 'El formulario contiene datos inválidos.';
    }
}

/** Estado del editor de catalogo: modo crear o modo editar (union discriminada). */
export type CatalogEditorState<T, S> =
    | { mode: 'create'; template: T; seed: S }
    | { mode: 'edit'; id: string; template: T; seed: S };

/** Valor del editor en modo editar para una entrada existente. */
export function catalogEditValue<T extends { id: string }, S>(
    entry: T,
    editable: (entry: T) => S,
): CatalogEditorState<T, S> {
    return { mode: 'edit', id: entry.id, template: entry, seed: editable(entry) };
}

/** Valor del editor en modo crear a partir de una plantilla (built-in clonada). */
export function catalogCreateValue<T, S>(
    template: T,
    empty: (template: T) => S,
): CatalogEditorState<T, S> {
    return { mode: 'create', template, seed: empty(template) };
}

/** Tipos de resultado del registry que mapea el panel. */
export type CatalogReason<T> =
    | Extract<RegisterResult<T>, { ok: false }>['reason']
    | Extract<UpdateResult<T>, { ok: false }>['reason'];

/**
 * Envia el editor de un panel: guarda con `saveCatalogEntry` y CIERRA el editor si no hubo
 * error. Un solo dueno del envoltorio (P9.31): los dos paneles lo tenian copiado entero.
 */
export async function submitCatalogPanel<T>(
    args: CatalogSaveArgs<T> & { close: () => void },
): Promise<string | null> {
    const error = await saveCatalogEntry(args);
    if (error) return error;
    args.close();
    return null;
}
