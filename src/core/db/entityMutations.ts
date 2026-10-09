/**
 * entityMutations.ts — DUENO UNICO de las mutaciones de fila que los servicios de
 * dominio tenian copiadas con OTRO nombre: alternar un flag (toggle), renombrar
 * (label) y vaciar los marcados (borrado logico en lote).
 *
 * POR QUE EXISTE (P9.30, corregido 2026-10-08): la barrera estructural daba 0 grupos
 * porque no escaneaba flechas ANOTADAS (`const f = (id: string): Promise<T|null> => {`).
 * Al cubrirlas (P9.36) aparecieron los cuerpos IDENTICOS: notes/shopping (toggle,
 * rename, clearDone/clearChecked), contact/diary (get, remove). No era "la misma
 * forma sobre entidades distintas": era el mismo cuerpo.
 */
import { buildSyncTuple } from './syncTuple';
import { addAuditLog } from './fluDatabase';
import type { SyncTuple } from './fluDatabase';

/** Fila con tupla de sincronizacion (todas las entidades del proyecto). */
export interface SyncRow {
    id: string;
    updatedAt: number;
    sync: SyncTuple;
}

/** Lo que la mutacion necesita de la tabla y del servicio. */
export interface RowMutationSpec<T extends SyncRow> {
    table: {
        get(id: string): Promise<T | undefined>;
        put(row: T): Promise<unknown>;
        toArray(): Promise<T[]>;
        bulkPut?(rows: T[]): Promise<unknown>;
    };
    /** Reloj de la tupla (makeTupleTimestamp). */
    now: () => number;
    /** Copia defensiva antes de devolver (copyRecord). */
    copy: (row: T) => T;
    audit: { action: string; entity: string; source: string };
}

/** Alterna un flag booleano de la fila y audita el cambio. */
export function createToggle<T extends SyncRow>(
    spec: RowMutationSpec<T> & {
        /** Cambia el flag sobre la fila, sellando updatedAt y sync. */
        setFlag: (row: T, at: number) => T;
        /** Valor del flag (antes y despues del cambio). */
        flagOf: (row: T) => unknown;
    },
): (id: string) => Promise<T | null> {
    return async (id: string) => {
        const row = await spec.table.get(id);
        if (!row) return null;
        const updated = spec.setFlag(row, spec.now());
        await spec.table.put(updated);
        await addAuditLog(spec.audit.action, spec.audit.entity, id, spec.flagOf(row), spec.flagOf(updated), spec.audit.source);
        return spec.copy(updated);
    };
}

/** Renombra la fila (campo `label`) y audita el cambio. */
export function createRename<T extends SyncRow & { label: string }>(
    spec: RowMutationSpec<T>,
): (id: string, label: string) => Promise<T | null> {
    return async (id: string, label: string) => {
        const clean = typeof label === 'string' ? label.trim() : '';
        if (!clean) return null;
        const row = await spec.table.get(id);
        if (!row) return null;
        const at = spec.now();
        const updated: T = { ...row, label: clean, updatedAt: at, sync: buildSyncTuple(row.sync, at) };
        await spec.table.put(updated);
        await addAuditLog(spec.audit.action, spec.audit.entity, id, row.label, clean, spec.audit.source);
        return spec.copy(updated);
    };
}

/** Lee una fila por id y la copia (get). Un solo dueno. */
export function createGetRow<T extends SyncRow>(spec: {
    table: { get(id: string): Promise<T | undefined> };
    copy: (row: T) => T;
    /** Si es true, una fila borrada logicamente cuenta como ausente. */
    excludeDeleted?: boolean;
}): (id: string) => Promise<T | undefined> {
    return async (id: string) => {
        if (!id) return undefined;
        const row = await spec.table.get(id);
        if (!row) return undefined;
        if (spec.excludeDeleted && row.sync?.deleted) return undefined;
        return spec.copy(row);
    };
}

/**
 * Borrado LOGICO (marca `deleted` en la tupla) con el resultado como DATO: boolean
 * (shopping/browser) o `{ ok }` (contactos/diario). Un solo dueno.
 */
export function createSoftDelete<T extends SyncRow, R>(spec: RowMutationSpec<T> & {
    onInvalid: () => R;
    onMissing: () => R;
    onDone: () => R;
    /** Valores auditados antes/despues (por defecto, las filas). */
    auditValues?: (before: T, after: T) => { before: unknown; after: unknown };
}): (id: string) => Promise<R> {
    return async (id: string) => {
        if (!id) return spec.onInvalid();
        const row = await spec.table.get(id);
        if (!row) return spec.onMissing();
        const at = spec.now();
        const updated: T = { ...row, updatedAt: at, sync: { ...buildSyncTuple(row.sync, at), deleted: true } };
        await spec.table.put(updated);
        const values = spec.auditValues ? spec.auditValues(row, updated) : { before: row, after: updated };
        await addAuditLog(spec.audit.action, spec.audit.entity, id, values.before, values.after, spec.audit.source);
        return spec.onDone();
    };
}

/** Marca como borradas (borrado logico, en lote) las filas con el flag puesto. */
export function createClearFlagged<T extends SyncRow>(
    spec: RowMutationSpec<T> & {
        /** Fila "hecha": candidata a vaciarse. */
        isFlagged: (row: T) => boolean;
    },
): () => Promise<number> {
    return async () => {
        const all = await spec.table.toArray();
        const flagged = all.filter((row) => spec.isFlagged(row) && !row.sync?.deleted);
        const at = spec.now();
        const marked = flagged.map((row) => ({
            ...row,
            updatedAt: at,
            sync: { ...buildSyncTuple(row.sync, at), deleted: true },
        }));
        if (marked.length > 0 && spec.table.bulkPut) await spec.table.bulkPut(marked);
        if (flagged.length > 0) {
            await addAuditLog(spec.audit.action, spec.audit.entity, '', flagged.length, 0, spec.audit.source);
        }
        return flagged.length;
    };
}
/**
 * Filas VIVAS (sin borrado logico) ordenadas por nombre, con copia defensiva.
 * DUENO UNICO (P9.45): el idioma `.filter(!deleted).slice().sort(nombre).map(copy)` estaba
 * copiado en contactService.listContacts y participantRegistry.list (el `.slice()` sobraba:
 * `filter` ya devuelve un array nuevo).
 * @param rows filas de la tabla (tal cual salen de Dexie)
 * @param copy copia defensiva (convencion del proyecto: `copyRecord`)
 */
export function listAliveByName<T extends SyncRow & { name: string }>(rows: readonly T[], copy: (row: T) => T): T[] {
    return rows
        .filter((row) => !row.sync?.deleted)
        .sort((a, b) => a.name.localeCompare(b.name, 'es'))
        .map(copy);
}
