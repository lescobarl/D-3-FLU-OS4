// ============================================================
// Flujo de guardado de un panel de catalogo (DUENO UNICO, P7.82)
// ============================================================
import type { RegisterResult, UpdateResult } from './catalogRegistry';

/** Texto unico de "no hay contexto de edicion" (antes copiado en 3 paneles y
 * enmascarado por `invalidError` del config). */
export const NO_CONTEXT_ERROR = 'No se puede guardar sin contexto.';

/** Motivo de fallo comun a alta y edicion en cualquier registro de catalogo. */
export type CatalogSaveFailure<T> =
    | Extract<RegisterResult<T>, { ok: false }>['reason']
    | Extract<UpdateResult<T>, { ok: false }>['reason'];

/** Lo unico que el flujo necesita saber del estado del editor. */
export type CatalogEditorRef =
    | { mode: 'create' }
    | { mode: 'edit'; id: string };

export interface CatalogSaveArgs<TPayload> {
    editor: CatalogEditorRef | null;
    payload: TPayload;
    /** Texto para "no hay contexto de edicion" (por defecto, el comun). */
    invalidError?: string;
    register: (payload: TPayload) => Promise<RegisterResult<TPayload>>;
    update: (id: string, payload: TPayload) => Promise<UpdateResult<TPayload>>;
    mapReason: (reason: CatalogSaveFailure<TPayload>) => string;
}

/**
 * Guardado unico de los paneles de catalogo (ambientes, paletas, sitios).
 *
 * FUENTE UNICA de P7.82: los tres paneles tenian el MISMO bloque copiado
 * (comprobar contexto, alta -> register / edicion -> update, exito -> cerrar,
 * fallo -> traducir el motivo). La politica vive aqui; el panel solo aporta sus
 * funciones y su traduccion de motivos. Devuelve `null` si hay que cerrar el
 * editor, o el mensaje de error si no.
 */
export async function saveCatalogEntry<TPayload>(
    args: CatalogSaveArgs<TPayload>,
): Promise<string | null> {
    const { editor } = args;
    if (!editor) return args.invalidError ?? NO_CONTEXT_ERROR;

    if (editor.mode === 'create') {
        const result = await args.register(args.payload);
        return result.ok ? null : args.mapReason(result.reason);
    }

    const result = await args.update(editor.id, args.payload);
    return result.ok ? null : args.mapReason(result.reason);
}
