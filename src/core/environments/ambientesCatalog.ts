// ============================================================
// Ambientes Catalog — Catálogo dinámico de ambientes (1A)
// ------------------------------------------------------------
// Conecta la tabla `ambientes` (AmbienteCatalogRecord) con el
// registry genérico y la caché fusionada de environmentRegistry:
//   - adaptador Dexie → CatalogDb<EnvironmentDefinition>
//   - CRUD que re-hidrata la caché tras cada mutación
//   - hydrateAmbientes() al arranque (A2)
// ============================================================

import { fluDb, type AmbienteCatalogRecord } from '../db/fluDatabase';
import {
    ENVIRONMENTS,
    resetMergedAmbientes,
    setMergedAmbientes,
    type EnvironmentDefinition,
} from './environmentRegistry';
import { createCatalogRegistry, type CatalogDb, type CatalogRecord } from '../catalogs/catalogRegistry';
import { ambienteSchema } from '../catalogs/catalogSchema';
import { mergeCatalog } from '../catalogs/mergeCatalog';

const toCatalogRecord = (row: AmbienteCatalogRecord): CatalogRecord<EnvironmentDefinition> => ({
    id: row.id,
    data: row.data,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sync: row.sync,
});

const toAmbienteRecord = (record: CatalogRecord<EnvironmentDefinition>): AmbienteCatalogRecord => ({
    id: record.id,
    nombre: record.data.nombre,
    data: record.data,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sync: record.sync,
});

/** Adaptador de la tabla Dexie `ambientes` al contrato genérico CatalogDb. */
const ambientesDb: CatalogDb<EnvironmentDefinition> = {
    async add(record) {
        await fluDb.ambientes.add(toAmbienteRecord(record));
    },
    async put(record) {
        await fluDb.ambientes.put(toAmbienteRecord(record));
    },
    async get(id) {
        const row = await fluDb.ambientes.get(id);
        return row ? toCatalogRecord(row) : undefined;
    },
    async toArray() {
        const rows = await fluDb.ambientes.toArray();
        return rows.map(toCatalogRecord);
    },
};

const registry = createCatalogRegistry<EnvironmentDefinition>({
    db: ambientesDb,
    schema: ambienteSchema,
    entity: 'ambiente',
});

/** Hidrata la caché fusionada desde la tabla (al arranque y tras cada CRUD). */
export async function hydrateAmbientes(): Promise<void> {
    const dynamic = await registry.list();
    setMergedAmbientes(mergeCatalog(ENVIRONMENTS, dynamic));
}

/** Restaura la caché fusionada al catálogo built-in (reset/limpieza). */
export function resetAmbientesCache(): void {
    resetMergedAmbientes();
}

export async function registerAmbiente(data: EnvironmentDefinition) {
    const result = await registry.register(data);
    await hydrateAmbientes();
    return result;
}

export async function updateAmbiente(id: string, data: EnvironmentDefinition) {
    const result = await registry.update(id, data);
    await hydrateAmbientes();
    return result;
}

export async function removeAmbiente(id: string): Promise<boolean> {
    const removed = await registry.remove(id);
    await hydrateAmbientes();
    return removed;
}

/** Lista solo los ambientes dinámicos persistidos (sin built-ins). */
export async function listDynamicAmbientes(): Promise<EnvironmentDefinition[]> {
    return registry.list();
}

/** Obtiene un ambiente dinámico persistido por su id canónico (slug). */
export async function getDynamicAmbiente(id: string): Promise<EnvironmentDefinition | undefined> {
    return registry.get(id);
}
