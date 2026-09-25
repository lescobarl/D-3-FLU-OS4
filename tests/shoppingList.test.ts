// ============================================================
// Fase 2 — Lista de compras (B10): motor puro e inmutable
// addItem / toggleItem / removeItem / uncheckAll / clearChecked /
// renameItem / itemsRemaining / filterItems / itemsForPerson
// ============================================================
import { describe, expect, it } from 'vitest';

import {
  addItem,
  clearChecked,
  filterItems,
  itemsForPerson,
  itemsRemaining,
  removeItem,
  renameItem,
  toggleItem,
  uncheckAll,
  type ShoppingItem,
} from '../src/core/reminders/shoppingList';

let seq = 0;

/** Crea un ítem base con ids secuenciales deterministas. */
function makeItem(overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  seq += 1;
  return {
    id: `item-${seq}`,
    label: 'leche',
    checked: false,
    createdAt: seq,
    updatedAt: seq,
    ...overrides,
  };
}

describe('shoppingList — addItem', () => {
  it('agrega un ítem sin persona con id "item-<timestamp>"', () => {
    const result = addItem([], { label: 'pan' });
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('pan');
    expect(result[0].checked).toBe(false);
    expect(result[0].id).toMatch(/^item-\d+$/);
  });

  it('recorta espacios en el texto', () => {
    const result = addItem([], { label: '  pan  ' });
    expect(result[0].label).toBe('pan');
  });

  it('devuelve [] (slice) si el texto está vacío', () => {
    const result = addItem([], { label: '   ' });
    expect(result).toHaveLength(0);
    expect(Array.isArray(result)).toBe(true);
  });

  it('agrega un ítem con persona usando id "<personId>-<timestamp>"', () => {
    const result = addItem([], { label: 'leche', personId: 'p1', personName: 'María' });
    expect(result[0].personId).toBe('p1');
    expect(result[0].personName).toBe('María');
    expect(result[0].id).toMatch(/^p1-\d+$/);
  });

  it('no muta el arreglo original', () => {
    const base = [makeItem({ label: 'agua' })];
    const result = addItem(base, { label: 'pan' });
    expect(base).toHaveLength(1);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(base[0]);
  });
});

describe('shoppingList — toggleItem', () => {
  it('alterna el estado checked sin mutar el original', () => {
    const item = makeItem();
    const result = toggleItem([item], item.id);
    expect(result[0].checked).toBe(true);
    expect(item.checked).toBe(false);
    expect(result[0]).not.toBe(item);
  });

  it('un id inexistente devuelve copia sin cambios (mismas referencias)', () => {
    const base = [makeItem()];
    const result = toggleItem(base, 'no-existe');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(base[0]);
  });
});

describe('shoppingList — removeItem', () => {
  it('elimina el ítem que coincide con el id', () => {
    const base = [makeItem({ id: 'item-1', label: 'leche' }), makeItem({ id: 'item-2', label: 'pan' })];
    const result = removeItem(base, 'item-1');
    expect(result.map((i) => i.label)).toEqual(['pan']);
    expect(base).toHaveLength(2);
  });

  it('un id inexistente no elimina nada', () => {
    const base = [makeItem()];
    expect(removeItem(base, 'no-existe')).toHaveLength(1);
  });
});

describe('shoppingList — uncheckAll', () => {
  it('desmarca solo los marcados y conserva la referencia de los pendientes', () => {
    const pending = makeItem({ label: 'leche' });
    const checked = makeItem({ label: 'pan', checked: true });
    const base = [pending, checked];
    const result = uncheckAll(base);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(pending);
    expect(result[0].checked).toBe(false);
    expect(result[1].checked).toBe(false);
    expect(result[1]).not.toBe(checked);
    expect(checked.checked).toBe(true);
  });
});

describe('shoppingList — clearChecked', () => {
  it('elimina solo los marcados y conserva los pendientes', () => {
    const pending = makeItem({ label: 'leche' });
    const checked = makeItem({ label: 'pan', checked: true });
    const base = [pending, checked];
    const result = clearChecked(base);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(pending);
    expect(base).toHaveLength(2);
  });
});

describe('shoppingList — renameItem', () => {
  it('renombra el ítem coincidente sin mutar el original', () => {
    const item = makeItem({ label: 'leche' });
    const result = renameItem([item], item.id, 'leche deslactosada');
    expect(result[0].label).toBe('leche deslactosada');
    expect(item.label).toBe('leche');
    expect(result[0]).not.toBe(item);
  });

  it('un nombre vacío devuelve slice sin cambios', () => {
    const item = makeItem();
    const result = renameItem([item], item.id, '   ');
    expect(result[0].label).toBe(item.label);
  });
});

describe('shoppingList — itemsRemaining', () => {
  it('cuenta solo los ítems no marcados', () => {
    const base = [makeItem(), makeItem({ checked: true }), makeItem()];
    expect(itemsRemaining(base)).toBe(2);
  });
});

describe('shoppingList — filterItems', () => {
  it('filtra por all / pending / checked', () => {
    const base = [makeItem({ label: 'leche' }), makeItem({ label: 'pan', checked: true })];
    expect(filterItems(base, 'all').map((i) => i.label)).toEqual(['leche', 'pan']);
    expect(filterItems(base, 'pending').map((i) => i.label)).toEqual(['leche']);
    expect(filterItems(base, 'checked').map((i) => i.label)).toEqual(['pan']);
  });
});

describe('shoppingList — itemsForPerson', () => {
  it('sin personId devuelve todos los ítems', () => {
    const base = [makeItem(), makeItem({ personId: 'p1' })];
    expect(itemsForPerson(base)).toHaveLength(2);
    expect(itemsForPerson(base, undefined)).toHaveLength(2);
  });

  it('con personId devuelve solo los de esa persona', () => {
    const base = [makeItem({ label: 'leche' }), makeItem({ label: 'pan', personId: 'p1' })];
    const result = itemsForPerson(base, 'p1');
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('pan');
  });
});
