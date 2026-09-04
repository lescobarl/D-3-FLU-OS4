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
    delete(id: string): Promise<void>;
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
    | { ok: false; reason: 'invalid-input' | 'duplicate' | 'reserved' };

export type UpdateResult<T> =
    | { ok: true; record: CatalogRecord<T> }
    | { ok: false; reason: 'invalid-input' | 'not-found' | 'duplicate' | 'reserved' };

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
    const timestamp = (): number => now();

    const cloneData = (data: T): T => structuredClone(data);

    const buildSync = (previous?: SyncTuple): SyncTuple => {
        if (!previous) {
            return { revision: 1, updated_at: new Date(timestamp()).toISOString(), deleted: false };
        }
        return {
            revision: previous.revision + 1,
            updated_at: new Date(timestamp()).toISOString(),
            deleted: previous.deleted,
        };
    };

    const toRecord = (row: CatalogRecord<T>): CatalogRecord<T> => ({
        ...row,
        data: cloneData(row.data),
    });

    const isReserved = (id: string): boolean => schema.reservedIds.has(id);

    const register = async (data: T): Promise<RegisterResult<T>> => {
        if (!data) return { ok: false, reason: 'invalid-input' };
        const error = schema.validate(data);
        if (error) return { ok: false, reason: 'invalid-input' };

        const canonicalId = schema.idOf(data);
        if (!canonicalId) return { ok: false, reason: 'invalid-input' };
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
            sync: buildSync(),
        };
        await db.add(record);
        await addAuditLog(`${entity}.register`, entity, canonicalId, null, { data: record.data }, 'catalogRegistry');
        return { ok: true, record: toRecord(record) };
    };

    const update = async (canonicalId: string, data: T): Promise<UpdateResult<T>> => {
        if (!canonicalId || !data) return { ok: false, reason: 'invalid-input' };
        if (isReserved(canonicalId)) return { ok: false, reason: 'reserved' };

        const error = schema.validate(data);
        if (error) return { ok: false, reason: 'invalid-input' };

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
            sync: buildSync(existing.sync),
        };
        await db.put(updated);
        await addAuditLog(`${entity}.update`, entity, targetId, previous.data, { data: updated.data }, 'catalogRegistry');
        return { ok: true, record: toRecord(updated) };
    };

    const get = async (canonicalId: string): Promise<T | undefined> => {
        if (!canonicalId) return undefined;
        const all = await db.toArray();
        const found = all.find((r) => schema.idOf(r.data) === canonicalId);
        return found ? toRecord(found).data : undefined;
    };

    const list = async (): Promise<T[]> => {
        const all = await db.toArray();
        return all.map((r) => toRecord(r).data);
    };

    const remove = async (canonicalId: string): Promise<boolean> => {
        if (!canonicalId) return false;
        if (isReserved(canonicalId)) return false;
        const all = await db.toArray();
        const found = all.find((r) => schema.idOf(r.data) === canonicalId);
        if (!found) return false;
        await db.delete(found.id);
        await addAuditLog(`${entity}.remove`, entity, canonicalId, toRecord(found).data, null, 'catalogRegistry');
        return true;
    };

    return { register, update, get, list, remove };
}

export type CatalogRegistry<T> = ReturnType<typeof createCatalogRegistry<T>>;
