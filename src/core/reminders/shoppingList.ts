// ============================================================
// Shopping List — Lista de compras (B10)
// ------------------------------------------------------------
// Motor puro e inmutable de la lista de compras.
// Regla #1: sin hardcode; aquí solo reglas deterministas.
// Cada operación devuelve un arreglo nuevo (sin mutación).
// Los ítems pueden asociarse a una persona (B4/B10 multi-usuario).
// ============================================================

export interface ShoppingItem {
  id: string;
  label: string;
  checked: boolean;
  /** Persona que registró el ítem (opcional). */
  personId?: string;
  personName?: string;
  createdAt: number;
  updatedAt: number;
}

export interface NewShoppingItemInput {
  label: string;
  personId?: string;
  personName?: string;
}

export type ShoppingListFilter = 'all' | 'pending' | 'checked';

/** Agrega un ítem al final de la lista. */
export function addItem(items: readonly ShoppingItem[], input: NewShoppingItemInput): ShoppingItem[] {
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  if (!label) return items.slice();
  const now = Date.now();
  const item: ShoppingItem = {
    id: input.personId ? `${input.personId}-${now}` : `item-${now}`,
    label,
    checked: false,
    personId: input.personId,
    personName: input.personName,
    createdAt: now,
    updatedAt: now,
  };
  return [...items, item];
}

/** Alterna el estado checked de un ítem. */
export function toggleItem(items: readonly ShoppingItem[], id: string): ShoppingItem[] {
  return items.map((item) =>
    item.id === id ? { ...item, checked: !item.checked, updatedAt: Date.now() } : item,
  );
}

/** Elimina un ítem por id. */
export function removeItem(items: readonly ShoppingItem[], id: string): ShoppingItem[] {
  return items.filter((item) => item.id !== id);
}

/** Marca todos los ítems como no comprados (pendientes). */
export function uncheckAll(items: readonly ShoppingItem[]): ShoppingItem[] {
  const now = Date.now();
  return items.map((item) => (item.checked ? { ...item, checked: false, updatedAt: now } : item));
}

/** Elimina todos los ítems marcados. */
export function clearChecked(items: readonly ShoppingItem[]): ShoppingItem[] {
  return items.filter((item) => !item.checked);
}

/** Renombra un ítem. */
export function renameItem(items: readonly ShoppingItem[], id: string, label: string): ShoppingItem[] {
  const clean = typeof label === 'string' ? label.trim() : '';
  if (!clean) return items.slice();
  return items.map((item) => (item.id === id ? { ...item, label: clean, updatedAt: Date.now() } : item));
}

/** Cuenta ítems pendientes. */
export function itemsRemaining(items: readonly ShoppingItem[]): number {
  return items.filter((item) => !item.checked).length;
}

/** Filtra ítems por estado (genérico: sirve para ShoppingItem y variantes persistentes). */
export function filterItems<T extends { checked: boolean }>(
  items: readonly T[],
  filter: ShoppingListFilter,
): T[] {
  switch (filter) {
    case 'pending':
      return items.filter((item) => !item.checked);
    case 'checked':
      return items.filter((item) => item.checked);
    default:
      return items.slice();
  }
}

/** Ítems asociados a una persona (o todos si personId es undefined). */
export function itemsForPerson(items: readonly ShoppingItem[], personId?: string): ShoppingItem[] {
  if (!personId) return items.slice();
  return items.filter((item) => item.personId === personId);
}
