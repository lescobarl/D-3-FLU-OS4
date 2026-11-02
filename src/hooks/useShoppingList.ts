// ============================================================
// useShoppingList — Lista de la compra (Fase 2, B7)
// ------------------------------------------------------------
// Hook que gestiona la lista de la compra sobre Dexie
// (vía shoppingService). Es un hook de estado + acciones:
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
import { useCallback } from 'react';
import { refreshOnOk } from './refreshOnOk';
import { useServiceRef } from './useServiceRef';
import { usePendingList, useCountedMutation, addSequentially, cleanLabels, useRefreshAction } from './pendingListKit';
import { removeAndRefresh } from '../lib/removeAndRefresh';
import { type ShoppingItemRecord } from '../core/db/fluDatabase';
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

/** Predicados estables: el núcleo de lista no debe recrear su refresco por render. */
const ITEM_CHECKED = (item: ShoppingItemRecord): boolean => item.checked === true;
const ITEM_CREATED = (item: ShoppingItemRecord): number => item.createdAt ?? 0;

export function useShoppingList({
  now,
}: UseShoppingListOptions = {}): UseShoppingListResult {
  // Crear el servicio ANTES de cualquier useState: el inicializador de
  // estado o los callbacks referencian `service`, y una referencia en
  // la zona muerta temporal (TDZ) rompería el arranque con
  // "Cannot access 'service' before initialization".
  const service = useServiceRef<ShoppingService>(() => createShoppingService({ now: now || (() => Date.now()), }));

  const load = useCallback(() => service.list(), [service]);

  const { rows: items, loading, remainingCount, refresh } = usePendingList<ShoppingItemRecord>({
    load,
    isDone: ITEM_CHECKED,
    createdAt: ITEM_CREATED,
    remaining: itemsRemaining,
    errorContext: '[useShoppingList] refresh error',
  });
  const runCounted = useCountedMutation(refresh);

  /** Agrega un ítem y refresca la lista. */
  const add = useCallback(
    async (input: NewShoppingItemInput): Promise<AddShoppingItemResult> => {
      return refreshOnOk(() => service.add(input), refresh);
    },
    [service, refresh],
  );

  /** Agrega varias etiquetas de una vez (multi-add del parser de intención). */
  const addMany = useCallback(
    async (labels: string[]): Promise<AddShoppingItemResult[]> => {
      const clean = cleanLabels(labels);
      if (clean.length === 0) return [];
      const results = await addSequentially(clean, (label) => service.add({ label }));
      if (results.some((r) => r.ok)) await refresh();
      return results;
    },
    [service, refresh],
  );

  /** Alterna el estado marcado/desmarcado y refresca. */
  const toggle = useRefreshAction(service.toggle, refresh);

  /** Renombra un ítem y refresca. */
  const rename = useRefreshAction(service.rename, refresh);

  /** Elimina un ítem y refresca. */
  const remove = useCallback(
    async (id: string): Promise<boolean> => removeAndRefresh((rowId) => service.remove(rowId), refresh, id),
    [service, refresh],
  );

  /** Desmarca todos los pendientes y refresca. */
  const uncheckAll = useCallback(
    async (): Promise<number> => runCounted(() => service.uncheckAll()),
    [service, runCounted],
  );

  /** Limpia los ítems marcados y refresca. */
  const clearChecked = useCallback(
    async (): Promise<number> => runCounted(() => service.clearChecked()),
    [service, runCounted],
  );

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
