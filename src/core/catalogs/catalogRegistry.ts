// ============================================================
// Catalog Registry — Núcleo genérico de catálogos dinámicos
// ------------------------------------------------------------
// Patrón único para convertir catálogos estáticos en dinámicos:
//   - Obligación #6: UUIDv4 (id del registro)
//   - Obligación #7: tupla Sync [revision, updated_at, deleted]
//   - Obligación #5: log de auditoría en cada mutación
//   - Regla #1: sin hardcode; validación por esquema inyectado
// Inyección de dependencias: { db, schema, entity, now, newId }.
// El id canónico del catálogo lo extrae el esquema (idOf); el id
// del registro persistente es siempre UUIDv4 (contrato de datos).
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { addAuditLog, type SyncTuple } from '../db/fluDatabase';
import { buildSyncTuple, makeTupleTimestamp } from '../db/syncTuple';
import { INVALID_INPUT } from '../../lib/resultReasons';
import type { InvalidInput } from '../../lib/resultReasons';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export interface CatalogRecord<T> {
    id: string; // UUIDv4
    data: T;
    createdAt: number;
    updatedAt: number;
    sync: SyncTuple;
}

/** Contrato mínimo de persistencia (compatible con una EntityTable de Dexie). */
export interface CatalogDb<T> {
    add(record: CatalogRecord<T>): Promise<unknown>;
    put(record: CatalogRecord<T>): Promise<unknown>;
    get(id: string): Promise<CatalogRecord<T> | undefined>;
    toArray(): Promise<CatalogRecord<T>[]>;
}

export interface CatalogSchema<T> {
    /** Valida un payload; retorna mensaje de error o null si es válido. */
    validate(data: T): string | null;
    /** Extrae el id canónico del payload (para ambientes es data.id = slug). */
    idOf(data: T): string;
    /** Ids reservados por los built-ins (no editables/borrables). */
    reservedIds: ReadonlySet<string>;
}

export interface CatalogRegistryOptions<T> {
    db: CatalogDb<T>;
    schema: CatalogSchema<T>;
    /** Etiqueta del catálogo para auditoría (ej. 'ambiente'). */
    entity: string;
    /** Referencia de reloj (por defecto: Date.now()). */
    now?: () => number;
    /** Generador de id del registro (por defecto: uuid v4). */
    newId?: () => string;
}

export type RegisterResult<T> =
    | { ok: true; record: CatalogRecord<T> }
    | { ok: false; reason: InvalidInput | 'duplicate' | 'reserved' };

export type UpdateResult<T> =
    | { ok: true; record: CatalogRecord<T> }
    | { ok: false; reason: InvalidInput | 'not-found' | 'duplicate' | 'reserved' };

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export function createCatalogRegistry<T>({
    db,
    schema,
    entity,
    now = () => Date.now(),
    newId = uuidv4,
}: CatalogRegistryOptions<T>) {
    const timestamp = makeTupleTimestamp(now);

    const cloneData = (data: T): T => structuredClone(data);

    const toRecord = (row: CatalogRecord<T>): CatalogRecord<T> => ({
        ...row,
        data: cloneData(row.data),
    });

    const isReserved = (id: string): boolean => schema.reservedIds.has(id);

    const register = async (data: T): Promise<RegisterResult<T>> => {
        if (!data) return { ok: false, reason: INVALID_INPUT };
        const error = schema.validate(data);
        if (error) return { ok: false, reason: INVALID_INPUT };

        const canonicalId = schema.idOf(data);
        if (!canonicalId) return { ok: false, reason: INVALID_INPUT };
        if (isReserved(canonicalId)) return { ok: false, reason: 'reserved' };

        const all = await db.toArray();
        const duplicate = all.some((r) => schema.idOf(r.data) === canonicalId);
        if (duplicate) return { ok: false, reason: 'duplicate' };

        const id = newId();
        const t = timestamp();
        const record: CatalogRecord<T> = {
            id,
            data: cloneData(data),
            createdAt: t,
            updatedAt: t,
            sync: buildSyncTuple(undefined, timestamp()),
        };
        await db.add(record);
        await addAuditLog(`${entity}.register`, entity, canonicalId, null, { data: record.data }, 'catalogRegistry');
        return { ok: true, record: toRecord(record) };
    };

    const update = async (canonicalId: string, data: T): Promise<UpdateResult<T>> => {
        if (!canonicalId || !data) return { ok: false, reason: INVALID_INPUT };
        if (isReserved(canonicalId)) return { ok: false, reason: 'reserved' };

        const error = schema.validate(data);
        if (error) return { ok: false, reason: INVALID_INPUT };

        const targetId = schema.idOf(data);
        if (!targetId || isReserved(targetId)) return { ok: false, reason: 'reserved' };

        const all = await db.toArray();
        const existing = all.find((r) => schema.idOf(r.data) === canonicalId);
        if (!existing) return { ok: false, reason: 'not-found' };

        const collision = all.some((r) => r.id !== existing.id && schema.idOf(r.data) === targetId);
        if (collision) return { ok: false, reason: 'duplicate' };

        const previous = toRecord(existing);
        const updated: CatalogRecord<T> = {
            ...existing,
            data: cloneData(data),
            updatedAt: timestamp(),
            sync: buildSyncTuple(existing.sync, timestamp()),
        };
        await db.put(updated);
        await addAuditLog(`${entity}.update`, entity, targetId, previous.data, { data: updated.data }, 'catalogRegistry');
        return { ok: true, record: toRecord(updated) };
    };

    const get = async (canonicalId: string): Promise<T | undefined> => {
        if (!canonicalId) return undefined;
        const all = await db.toArray();
        const found = all.find((r) => !r.sync?.deleted && schema.idOf(r.data) === canonicalId);
        return found ? toRecord(found).data : undefined;
    };

    const list = async (): Promise<T[]> => {
        const all = await db.toArray();
        return all.filter((r) => !r.sync?.deleted).map((r) => toRecord(r).data);
    };

    const remove = async (canonicalId: string): Promise<boolean> => {
        if (!canonicalId) return false;
        if (isReserved(canonicalId)) return false;
        const all = await db.toArray();
        const found = all.find((r) => !r.sync?.deleted && schema.idOf(r.data) === canonicalId);
        if (!found) return false;
        const updated: CatalogRecord<T> = {
            ...found,
            updatedAt: timestamp(),
            sync: { ...buildSyncTuple(found.sync, timestamp()), deleted: true },
        };
        await db.put(updated);
        await addAuditLog(`${entity}.remove`, entity, canonicalId, toRecord(found).data, null, 'catalogRegistry');
        return true;
    };

    return { register, update, get, list, remove };
}

/**
 * Adaptador Dexie -> CatalogDb. DUENO UNICO (P9.29): los 3 catalogos (paletas,
 * ambientes, searchSites) repetian `{ add, put, get, toArray }` cambiando solo la
 * tabla y el mapeo fila <-> registro.
 */
export function createCatalogDb<T, Row>(
    table: {
        add(record: Row): Promise<unknown>;
        put(record: Row): Promise<unknown>;
        get(id: string): Promise<Row | undefined>;
        toArray(): Promise<Row[]>;
    },
    toRow: (record: CatalogRecord<T>) => Row,
    toRecord: (row: Row) => CatalogRecord<T>,
): CatalogDb<T> {
    return {
        async add(record) {
            await table.add(toRow(record));
        },
        async put(record) {
            await table.put(toRow(record));
        },
        async get(id) {
            const row = await table.get(id);
            return row ? toRecord(row) : undefined;
        },
        async toArray() {
            const rows = await table.toArray();
            return rows.map(toRecord);
        },
    };
}

/**
 * Mutaciones de un catalogo + rehidratacion de la cache tras cada una. DUENO UNICO (P9.29):
 * los 3 catalogos repetian registrar/actualizar/borrar + hydrate.
 */
export function createCatalogMutations<T>(
    registry: {
        register(data: T): Promise<RegisterResult<T>>;
        update(id: string, data: T): Promise<UpdateResult<T>>;
        remove(id: string): Promise<boolean>;
    },
    hydrate: () => Promise<void>,
): {
    register(data: T): Promise<RegisterResult<T>>;
    update(id: string, data: T): Promise<UpdateResult<T>>;
    remove(id: string): Promise<boolean>;
} {
    return {
        async register(data) {
            const result = await registry.register(data);
            await hydrate();
            return result;
        },
        async update(id, data) {
            const result = await registry.update(id, data);
            await hydrate();
            return result;
        },
        async remove(id) {
            const removed = await registry.remove(id);
            await hydrate();
            return removed;
        },
    };
}
