// ============================================================
// Shopping Service — Lista de compras (B10)
// ------------------------------------------------------------
// Persistencia de la lista de compras sobre Dexie con:
//   - Obligación #6: UUIDv4 (id) — real, no placeholder
//   - Obligación #7: tupla Sync [revision, updated_at, deleted]
//   - Obligación #5: log de auditoría en cada mutación
//   - Regla #1: sin hardcode; inyección de dependencias { db, now, newId }
// El motor puro (shoppingList.ts) define las reglas de filtrado y
// conteo; esta capa aporta persistencia, ids y marcas de tiempo reales.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { addAuditLog, type ShoppingItemRecord } from '../db/fluDatabase';
import { shoppingItemsTable } from '../notes/notesService';
import { buildSyncTuple, makeTupleTimestamp } from '../db/syncTuple';
import { copyRecord } from '../db/recordCopy';
import { filterItems, itemsRemaining, type ShoppingListFilter } from './shoppingList';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

// El registro persistente proviene de la capa de base de datos
// (fuente única de verdad — Regla de oro) y se re-exporta aquí.
export type { ShoppingItemRecord } from '../db/fluDatabase';

export interface NewShoppingItemInput {
  label: string;
  personId?: string;
  personName?: string;
}

export interface ShoppingDb {
  add(record: ShoppingItemRecord): Promise<unknown>;
  put(record: ShoppingItemRecord): Promise<unknown>;
  delete(id: string): Promise<void>;
  get(id: string): Promise<ShoppingItemRecord | undefined>;
  toArray(): Promise<ShoppingItemRecord[]>;
}

export interface ShoppingServiceOptions {
  /** Tabla de lista de compras. Por defecto: la resuelve fluDatabase (C11). */
  db?: ShoppingDb;
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
  /** Generador de id (por defecto: uuid v4). */
  newId?: () => string;
}

export interface AddShoppingItemResult {
  ok: boolean;
  record?: ShoppingItemRecord;
  reason?: 'invalid-input';
}

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export function createShoppingService({
  db = shoppingItemsTable(),
  now = () => Date.now(),
  newId = uuidv4,
}: ShoppingServiceOptions = {}) {
  const timestamp = makeTupleTimestamp(now);

  const add = async (input: NewShoppingItemInput): Promise<AddShoppingItemResult> => {
    const label = typeof input.label === 'string' ? input.label.trim() : '';
    if (!label) return { ok: false, reason: 'invalid-input' };
    const t = timestamp();
    const record: ShoppingItemRecord = {
      id: newId(),
      label,
      checked: false,
      personId: input.personId,
      personName: input.personName,
      createdAt: t,
      updatedAt: t,
      sync: buildSyncTuple(undefined, timestamp()),
    };
    await db.add(record);
    await addAuditLog('shopping.add', 'shoppingItem', record.id, null, { label: record.label }, 'shoppingService');
    return { ok: true, record };
  };

  const get = async (id: string): Promise<ShoppingItemRecord | undefined> => {
    if (!id) return undefined;
    const row = await db.get(id);
    return row && !row.sync?.deleted ? copyRecord(row) : undefined;
  };

  const list = async (): Promise<ShoppingItemRecord[]> => {
    const all = await db.toArray();
    return all.filter((row) => !row.sync?.deleted).map(copyRecord);
  };

  const listFiltered = async (filter: ShoppingListFilter = 'all'): Promise<ShoppingItemRecord[]> => {
    const all = (await db.toArray()).filter((row) => !row.sync?.deleted);
    return filterItems(all, filter).map(copyRecord);
  };

  const toggle = async (id: string): Promise<ShoppingItemRecord | null> => {
    const row = await db.get(id);
    if (!row) return null;
    const updated: ShoppingItemRecord = {
      ...row,
      checked: !row.checked,
      updatedAt: timestamp(),
      sync: buildSyncTuple(row.sync, timestamp()),
    };
    await db.put(updated);
    await addAuditLog('shopping.toggle', 'shoppingItem', id, row.checked, updated.checked, 'shoppingService');
    return copyRecord(updated);
  };

  const rename = async (id: string, label: string): Promise<ShoppingItemRecord | null> => {
    const clean = typeof label === 'string' ? label.trim() : '';
    if (!clean) return null;
    const row = await db.get(id);
    if (!row) return null;
    const updated: ShoppingItemRecord = {
      ...row,
      label: clean,
      updatedAt: timestamp(),
      sync: buildSyncTuple(row.sync, timestamp()),
    };
    await db.put(updated);
    await addAuditLog('shopping.rename', 'shoppingItem', id, row.label, clean, 'shoppingService');
    return copyRecord(updated);
  };

  const remove = async (id: string): Promise<boolean> => {
    const row = await db.get(id);
    if (!row) return false;
    const updated: ShoppingItemRecord = {
      ...row,
      updatedAt: timestamp(),
      sync: { ...buildSyncTuple(row.sync, timestamp()), deleted: true },
    };
    await db.put(updated);
    await addAuditLog('shopping.remove', 'shoppingItem', id, row, updated, 'shoppingService');
    return true;
  };

  /** Marca todos los ítems como no comprados (pendientes). */
  const uncheckAll = async (): Promise<number> => {
    const all = await db.toArray();
    const pending = all.filter((item) => item.checked);
    const t = timestamp();
    for (const item of pending) {
      const updated: ShoppingItemRecord = {
        ...item,
        checked: false,
        updatedAt: t,
        sync: buildSyncTuple(item.sync, timestamp()),
      };
      await db.put(updated);
    }
    if (pending.length > 0) {
      await addAuditLog('shopping.uncheckAll', 'shoppingItem', '', pending.length, 0, 'shoppingService');
    }
    return pending.length;
  };

  /** Elimina todos los ítems marcados; devuelve cuántos se quitaron. */
  const clearChecked = async (): Promise<number> => {
    const all = await db.toArray();
    const checked = all.filter((item) => item.checked && !item.sync?.deleted);
    const t = timestamp();
    for (const item of checked) {
      await db.put({
        ...item,
        updatedAt: t,
        sync: { ...buildSyncTuple(item.sync, t), deleted: true },
      });
    }
    if (checked.length > 0) {
      await addAuditLog('shopping.clearChecked', 'shoppingItem', '', checked.length, 0, 'shoppingService');
    }
    return checked.length;
  };

  const remaining = async (): Promise<number> => {
    const all = (await db.toArray()).filter((row) => !row.sync?.deleted);
    return itemsRemaining(all);
  };

  return {
    add,
    get,
    list,
    listFiltered,
    toggle,
    rename,
    remove,
    uncheckAll,
    clearChecked,
    remaining,
  };
}

export type ShoppingService = ReturnType<typeof createShoppingService>;
