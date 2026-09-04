// ============================================================
// useShoppingList — Lista de la compra (Fase 2, B7)
// ------------------------------------------------------------
// Hook que gestiona la lista de la compra sobre Dexie
// (fluDb.shoppingItems) vía shoppingService. Es un hook de
// estado + acciones: no lleva scheduler ni notificaciones
// (la lista no vence), sólo persistencia y UI en vivo.
//
// Cumple:
//   - Rule #1: NO HARDCODE — texto/etiquetas vienen de
//     FLU_CONFIG.shopping.ui (lo consume el panel, no el hook)
//   - Obligación #5: auditoría (la hace shoppingService)
//   - Obligación #6/#7: UUIDv4 + SyncTuple (los hace
//     shoppingService)
//   - DI: `now` inyectable para pruebas deterministas
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { fluDb, type ShoppingItemRecord } from '../core/db/fluDatabase';
import {
  createShoppingService,
  type AddShoppingItemResult,
  type NewShoppingItemInput,
  type ShoppingService,
} from '../core/reminders/shoppingService';
import { itemsRemaining } from '../core/reminders/shoppingList';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export interface UseShoppingListOptions {
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
}

export interface ShoppingListState {
  items: ShoppingItemRecord[];
  loading: boolean;
  remainingCount: number;
}

export interface ShoppingListActions {
  refresh: () => Promise<void>;
  add: (input: NewShoppingItemInput) => Promise<AddShoppingItemResult>;
  /** Agrega varias etiquetas de una vez (multi-add del parser de intención). */
  addMany: (labels: string[]) => Promise<AddShoppingItemResult[]>;
  toggle: (id: string) => Promise<ShoppingItemRecord | null>;
  rename: (id: string, label: string) => Promise<ShoppingItemRecord | null>;
  remove: (id: string) => Promise<boolean>;
  uncheckAll: () => Promise<number>;
  clearChecked: () => Promise<number>;
}

export interface UseShoppingListResult extends ShoppingListState, ShoppingListActions {
  service: ShoppingService;
}

// ------------------------------------------------------------
// Hook
// ------------------------------------------------------------

export function useShoppingList({
  now,
}: UseShoppingListOptions = {}): UseShoppingListResult {
  // Crear el servicio ANTES de cualquier useState: el inicializador de
  // estado o los callbacks referencian `service`, y una referencia en
  // la zona muerta temporal (TDZ) rompería el arranque con
  // "Cannot access 'service' before initialization".
  const serviceRef = useRef<ShoppingService | null>(null);
  if (!serviceRef.current) {
    serviceRef.current = createShoppingService({
      db: fluDb.shoppingItems,
      now: now || (() => Date.now()),
    });
  }
  const service = serviceRef.current;

  const [items, setItems] = useState<ShoppingItemRecord[]>([]);
  const [remainingCount, setRemainingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  /** Recarga la lista desde IndexedDB (cronológica, pendientes primero). */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const all = await service.list();
      const sorted = all.slice().sort((a, b) => {
        if (a.checked !== b.checked) return a.checked ? 1 : -1;
        return (a.createdAt ?? 0) - (b.createdAt ?? 0);
      });
      setItems(sorted);
      setRemainingCount(itemsRemaining(sorted));
    } catch (err) {
      console.error('[useShoppingList] refresh error:', err);
    } finally {
      setLoading(false);
    }
  }, [service]);

  // Carga inicial.
  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  /** Agrega un ítem y refresca la lista. */
  const add = useCallback(
    async (input: NewShoppingItemInput): Promise<AddShoppingItemResult> => {
      const result = await service.add(input);
      if (result.ok) await refresh();
      return result;
    },
    [service, refresh],
  );

  /** Agrega varias etiquetas de una vez (multi-add del parser de intención). */
  const addMany = useCallback(
    async (labels: string[]): Promise<AddShoppingItemResult[]> => {
      const clean = (labels || []).map((l) => l.trim()).filter(Boolean);
      if (clean.length === 0) return [];
      const results: AddShoppingItemResult[] = [];
      for (const label of clean) {
        const result = await service.add({ label });
        results.push(result);
      }
      if (results.some((r) => r.ok)) await refresh();
      return results;
    },
    [service, refresh],
  );

  /** Alterna el estado marcado/desmarcado y refresca. */
  const toggle = useCallback(
    async (id: string): Promise<ShoppingItemRecord | null> => {
      const updated = await service.toggle(id);
      if (updated) await refresh();
      return updated;
    },
    [service, refresh],
  );

  /** Renombra un ítem y refresca. */
  const rename = useCallback(
    async (id: string, label: string): Promise<ShoppingItemRecord | null> => {
      const updated = await service.rename(id, label);
      if (updated) await refresh();
      return updated;
    },
    [service, refresh],
  );

  /** Elimina un ítem y refresca. */
  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const removed = await service.remove(id);
      if (removed) await refresh();
      return removed;
    },
    [service, refresh],
  );

  /** Desmarca todos los pendientes y refresca. */
  const uncheckAll = useCallback(async (): Promise<number> => {
    const count = await service.uncheckAll();
    if (count > 0) await refresh();
    return count;
  }, [service, refresh]);

  /** Limpia los ítems marcados y refresca. */
  const clearChecked = useCallback(async (): Promise<number> => {
    const count = await service.clearChecked();
    if (count > 0) await refresh();
    return count;
  }, [service, refresh]);

  return {
    service,
    items,
    loading,
    remainingCount,
    refresh,
    add,
    addMany,
    toggle,
    rename,
    remove,
    uncheckAll,
    clearChecked,
  };
}
