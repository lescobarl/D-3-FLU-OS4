// ============================================================
// Search Catalog — Catálogo dinámico de sitios de búsqueda (F2)
// ------------------------------------------------------------
// Conecta la tabla `searchSites` (SearchSiteRecord) con el
// registry genérico y la caché fusionada de searchSiteTypes:
//   - adaptador Dexie → CatalogDb<SearchSite>
//   - CRUD que re-hidrata la caché tras cada mutación
//   - hydrateSearchSites() al arranque (F2)
// La allowlist y los tiles se derivan del catálogo (deriveAllowlist
// / deriveTiles): agregar un sitio al catálogo = aparece en voz,
// barra, tiles y resultados sin tocar código.
// ============================================================

import { fluDb, type SearchSiteRecord } from '../db/fluDatabase';
import { createCatalogRegistry, type CatalogDb, type CatalogRecord } from '../catalogs/catalogRegistry';
import { searchSiteSchema } from '../catalogs/catalogSchema';
import { mergeCatalog } from '../catalogs/mergeCatalog';
import {
    BUILTIN_SEARCH_SITES,
    type SearchSite,
    type SearchSiteTile,
} from './searchSiteTypes';

const toCatalogRecord = (row: SearchSiteRecord): CatalogRecord<SearchSite> => ({
    id: row.id,
    data: row.data,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sync: row.sync,
});

const toSearchSiteRecord = (record: CatalogRecord<SearchSite>): SearchSiteRecord => ({
    id: record.id,
    dominio: record.data.dominio,
    data: record.data,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sync: record.sync,
});

/** Adaptador de la tabla Dexie `searchSites` al contrato genérico CatalogDb. */
const searchSitesDb: CatalogDb<SearchSite> = {
    async add(record) {
        await fluDb.searchSites.add(toSearchSiteRecord(record));
    },
    async put(record) {
        await fluDb.searchSites.put(toSearchSiteRecord(record));
    },
    async delete(id) {
        await fluDb.searchSites.delete(id);
    },
    async get(id) {
        const row = await fluDb.searchSites.get(id);
        return row ? toCatalogRecord(row) : undefined;
    },
    async toArray() {
        const rows = await fluDb.searchSites.toArray();
        return rows.map(toCatalogRecord);
    },
};

const registry = createCatalogRegistry<SearchSite>({
    db: searchSitesDb,
    schema: searchSiteSchema,
    entity: 'searchSite',
});

/** Caché fusionada: built-ins primero + dinámicos, keyed por dominio. */
let mergedCache: readonly SearchSite[] = BUILTIN_SEARCH_SITES;

/** Hidrata la caché fusionada desde la tabla (al arranque y tras cada CRUD). */
export async function hydrateSearchSites(): Promise<void> {
    const dynamic = await registry.list();
    mergedCache = mergeCatalog(BUILTIN_SEARCH_SITES, dynamic, (site) => site.dominio);
}

/** Restaura la caché fusionada al catálogo built-in (reset/limpieza). */
export function resetSearchSitesCache(): void {
    mergedCache = BUILTIN_SEARCH_SITES;
}

/** Catálogo fusionado vigente (built-ins + dinámicos) para el runtime. */
export function getSearchSites(): readonly SearchSite[] {
    return mergedCache;
}

export async function registerSearchSite(data: SearchSite) {
    const result = await registry.register(data);
    await hydrateSearchSites();
    return result;
}

export async function updateSearchSite(id: string, data: SearchSite) {
    const result = await registry.update(id, data);
    await hydrateSearchSites();
    return result;
}

export async function removeSearchSite(id: string): Promise<boolean> {
    const removed = await registry.remove(id);
    await hydrateSearchSites();
    return removed;
}

/** Lista solo los sitios dinámicos persistidos (sin built-ins). */
export async function listDynamicSearchSites(): Promise<SearchSite[]> {
    return registry.list();
}

/** Obtiene un sitio dinámico persistido por su id canónico (dominio). */
export async function getDynamicSearchSite(id: string): Promise<SearchSite | undefined> {
    return registry.get(id);
}

// Re-export de las funciones puras derivadas (permite usarlas desde la
// capa de UI/hooks sin importar directamente searchSiteTypes).
export { deriveAllowlist, deriveTiles } from './searchSiteTypes';
export type { SearchSiteTile } from './searchSiteTypes';
