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
import { createCatalogDb, createCatalogMutations, createCatalogRegistry, catalogRecordFromRow as toCatalogRecord, type CatalogRecord } from '../catalogs/catalogRegistry';
import { paletaSchema } from '../catalogs/catalogSchema';
import { mergeCatalog } from '../catalogs/mergeCatalog';

const toPaletaRecord = (record: CatalogRecord<PaletteDefinition>): PaletaCatalogRecord => ({
    id: record.id,
    name: record.data.name,
    data: record.data,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sync: record.sync,
});

/** Adaptador de la tabla Dexie `paletas` al contrato genérico CatalogDb. */
const paletasDb = createCatalogDb<PaletteDefinition, PaletaCatalogRecord>(fluDb.paletas, toPaletaRecord, toCatalogRecord);

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

const registerPaletaMutations = createCatalogMutations(registry, hydratePalettes);

/** Registra y rehidrata la cache (dueño: createCatalogMutations). */
export const registerPaleta = registerPaletaMutations.register;
/** Actualiza y rehidrata la cache (dueño: createCatalogMutations). */
export const updatePaleta = registerPaletaMutations.update;
/** Borra y rehidrata la cache (dueño: createCatalogMutations). */
export const removePaleta = registerPaletaMutations.remove;

/** Lista solo las paletas dinámicas persistidas (sin built-ins). */
export async function listDynamicPaletas(): Promise<PaletteDefinition[]> {
    return registry.list();
}

/** Obtiene una paleta dinámica persistida por su id canónico (slug). */
export async function getDynamicPaleta(id: string): Promise<PaletteDefinition | undefined> {
    return registry.get(id);
}
