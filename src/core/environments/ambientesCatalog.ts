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
import { createCatalogDb, createCatalogMutations, createCatalogRegistry, catalogRecordFromRow as toCatalogRecord, type CatalogRecord } from '../catalogs/catalogRegistry';
import { ambienteSchema } from '../catalogs/catalogSchema';
import { mergeCatalog } from '../catalogs/mergeCatalog';

const toAmbienteRecord = (record: CatalogRecord<EnvironmentDefinition>): AmbienteCatalogRecord => ({
    id: record.id,
    nombre: record.data.nombre,
    data: record.data,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sync: record.sync,
});

/** Adaptador de la tabla Dexie `ambientes` al contrato genérico CatalogDb. */
const ambientesDb = createCatalogDb<EnvironmentDefinition, AmbienteCatalogRecord>(fluDb.ambientes, toAmbienteRecord, toCatalogRecord);

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

const registerAmbienteMutations = createCatalogMutations(registry, hydrateAmbientes);

/** Registra y rehidrata la cache (dueño: createCatalogMutations). */
export const registerAmbiente = registerAmbienteMutations.register;
/** Actualiza y rehidrata la cache (dueño: createCatalogMutations). */
export const updateAmbiente = registerAmbienteMutations.update;
/** Borra y rehidrata la cache (dueño: createCatalogMutations). */
export const removeAmbiente = registerAmbienteMutations.remove;

/** Lista solo los ambientes dinámicos persistidos (sin built-ins). */
export async function listDynamicAmbientes(): Promise<EnvironmentDefinition[]> {
    return registry.list();
}

/** Obtiene un ambiente dinámico persistido por su id canónico (slug). */
export async function getDynamicAmbiente(id: string): Promise<EnvironmentDefinition | undefined> {
    return registry.get(id);
}
