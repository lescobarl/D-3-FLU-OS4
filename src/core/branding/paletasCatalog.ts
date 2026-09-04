// ============================================================
// Paletas Catalog — Catálogo dinámico de paletas (1B)
// ------------------------------------------------------------
// Conecta la tabla `paletas` (PaletaCatalogRecord) con el
// registry genérico y la caché fusionada de seasonalPalettes:
//   - adaptador Dexie → CatalogDb<PaletteDefinition>
//   - CRUD que re-hidrata la caché tras cada mutación
//   - hydratePalettes() al arranque (B2)
// ============================================================

import { fluDb, type PaletaCatalogRecord } from '../db/fluDatabase';
import {
    builtinPaletteEntries,
    resetMergedPalettes,
    setMergedPalettes,
    type PaletteDefinition,
} from './seasonalPalettes';
import { createCatalogRegistry, type CatalogDb, type CatalogRecord } from '../catalogs/catalogRegistry';
import { paletaSchema } from '../catalogs/catalogSchema';
import { mergeCatalog } from '../catalogs/mergeCatalog';

const toCatalogRecord = (row: PaletaCatalogRecord): CatalogRecord<PaletteDefinition> => ({
    id: row.id,
    data: row.data,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sync: row.sync,
});

const toPaletaRecord = (record: CatalogRecord<PaletteDefinition>): PaletaCatalogRecord => ({
    id: record.id,
    name: record.data.name,
    data: record.data,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sync: record.sync,
});

/** Adaptador de la tabla Dexie `paletas` al contrato genérico CatalogDb. */
const paletasDb: CatalogDb<PaletteDefinition> = {
    async add(record) {
        await fluDb.paletas.add(toPaletaRecord(record));
    },
    async put(record) {
        await fluDb.paletas.put(toPaletaRecord(record));
    },
    async delete(id) {
        await fluDb.paletas.delete(id);
    },
    async get(id) {
        const row = await fluDb.paletas.get(id);
        return row ? toCatalogRecord(row) : undefined;
    },
    async toArray() {
        const rows = await fluDb.paletas.toArray();
        return rows.map(toCatalogRecord);
    },
};

const registry = createCatalogRegistry<PaletteDefinition>({
    db: paletasDb,
    schema: paletaSchema,
    entity: 'paleta',
});

/** Hidrata la caché fusionada desde la tabla (al arranque y tras cada CRUD). */
export async function hydratePalettes(): Promise<void> {
    const dynamic = await registry.list();
    setMergedPalettes(mergeCatalog(builtinPaletteEntries(), dynamic));
}

/** Restaura la caché fusionada al catálogo built-in (reset/limpieza). */
export function resetPaletasCache(): void {
    resetMergedPalettes();
}

export async function registerPaleta(data: PaletteDefinition) {
    const result = await registry.register(data);
    await hydratePalettes();
    return result;
}

export async function updatePaleta(id: string, data: PaletteDefinition) {
    const result = await registry.update(id, data);
    await hydratePalettes();
    return result;
}

export async function removePaleta(id: string): Promise<boolean> {
    const removed = await registry.remove(id);
    await hydratePalettes();
    return removed;
}

/** Lista solo las paletas dinámicas persistidas (sin built-ins). */
export async function listDynamicPaletas(): Promise<PaletteDefinition[]> {
    return registry.list();
}

/** Obtiene una paleta dinámica persistida por su id canónico (slug). */
export async function getDynamicPaleta(id: string): Promise<PaletteDefinition | undefined> {
    return registry.get(id);
}
