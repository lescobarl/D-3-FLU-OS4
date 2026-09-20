// ============================================================
// shoppingService — persistencia y auditoría (B10) — Fase 2
// ------------------------------------------------------------
// Cubre el servicio de lista de compras con una base en memoria
// (misma interfaz ShoppingDb), reloj y newId inyectables.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAuditLog, type ShoppingItemRecord } from '../src/core/db/fluDatabase';
import { createShoppingService, type ShoppingDb } from '../src/core/reminders/shoppingService';

// IndexedDB no está disponible en vitest → se mockea el log de auditoría.
vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
  return { ...actual, addAuditLog: vi.fn(async () => undefined as never) };
});

// Referencia de reloj fija: jueves 15 de enero de 2026, 10:00 local.
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const now = (): number => NOW;

let idCounter = 0;

function createMapDb(initial: ShoppingItemRecord[] = []): ShoppingDb {
  const map = new Map<string, ShoppingItemRecord>();
  for (const r of initial) map.set(r.id, { ...r, sync: { ...r.sync } });
  return {
    async add(record: ShoppingItemRecord): Promise<unknown> {
      map.set(record.id, { ...record, sync: { ...record.sync } });
      return undefined;
    },
    async put(record: ShoppingItemRecord): Promise<unknown> {
      map.set(record.id, { ...record, sync: { ...record.sync } });
      return undefined;
    },
    async delete(id: string): Promise<void> {
      map.delete(id);
    },
    async get(id: string): Promise<ShoppingItemRecord | undefined> {
      const row = map.get(id);
      return row ? { ...row, sync: { ...row.sync } } : undefined;
    },
    async toArray(): Promise<ShoppingItemRecord[]> {
      return Array.from(map.values()).map((r) => ({ ...r, sync: { ...r.sync } }));
    },
  };
}

function createService(db: ShoppingDb) {
  return createShoppingService({ db, now, newId: () => `item-${++idCounter}` });
}

function makeItem(overrides: Partial<ShoppingItemRecord> = {}): ShoppingItemRecord {
  return {
    id: 'item-1',
    label: 'leche',
    checked: false,
    createdAt: NOW,
    updatedAt: NOW,
    sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
    ...overrides,
  };
}

let db: ShoppingDb;

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  db = createMapDb();
});

describe('shoppingService — creación', () => {
  it('add crea el ítem, lo persiste y audita', async () => {
    const service = createService(db);
    const result = await service.add({ label: '  leche  ' });

    expect(result.ok).toBe(true);
    const record = result.record!;
    expect(record.id).toBe('item-1');
    expect(record.label).toBe('leche'); // trim
    expect(record.checked).toBe(false);
    expect(record.createdAt).toBe(NOW);
    expect(record.updatedAt).toBe(NOW);
    expect(record.sync).toEqual({ revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false });
    expect(record.personId).toBeUndefined();
    expect(record.personName).toBeUndefined();

    expect((await db.get('item-1'))?.label).toBe('leche');

    expect(vi.mocked(addAuditLog)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'shopping.add', 'shoppingItem', 'item-1', null, { label: 'leche' }, 'shoppingService',
    );
  });

  it('add conserva personId y personName', async () => {
    const service = createService(db);
    const result = await service.add({ label: 'pan', personId: 'p1', personName: 'Ana' });
    expect(result.record?.personId).toBe('p1');
    expect(result.record?.personName).toBe('Ana');
  });

  it('rechaza etiqueta vacía como invalid-input sin auditar', async () => {
    const service = createService(db);
    expect(await service.add({ label: '   ' })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
    expect(idCounter).toBe(0);
  });
});

describe('shoppingService — toggle y rename', () => {
  it('toggle invierte checked y sube la revisión de sync', async () => {
    const service = createService(db);
    const added = (await service.add({ label: 'leche' })).record!;

    const toggled = await service.toggle(added.id);
    expect(toggled?.checked).toBe(true);
    expect(toggled?.sync.revision).toBe(2);
    expect(toggled?.updatedAt).toBe(NOW);
    expect((await db.get(added.id))?.checked).toBe(true);

    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'shopping.toggle', 'shoppingItem', added.id, false, true, 'shoppingService',
    );
  });

  it('toggle de un id inexistente devuelve null sin auditar', async () => {
    const service = createService(db);
    expect(await service.toggle('no-existe')).toBeNull();
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
  });

  it('rename actualiza la etiqueta y audita con el valor previo', async () => {
    const service = createService(db);
    const added = (await service.add({ label: 'leche' })).record!;

    const renamed = await service.rename(added.id, '  leche entera  ');
    expect(renamed?.label).toBe('leche entera');
    expect(renamed?.sync.revision).toBe(2);

    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'shopping.rename', 'shoppingItem', added.id, 'leche', 'leche entera', 'shoppingService',
    );
  });

  it('rename con etiqueta vacía o id inexistente devuelve null sin auditar', async () => {
    const service = createService(db);
    const added = (await service.add({ label: 'leche' })).record!;
    // El add ya audita (shopping.add); limpiamos para medir solo el rename.
    vi.clearAllMocks();
    expect(await service.rename(added.id, '   ')).toBeNull();
    expect(await service.rename('no-existe', 'pan')).toBeNull();
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
  });
});

describe('shoppingService — borrado y limpieza', () => {
  it('remove borra, devuelve true y audita con el registro previo', async () => {
    const service = createService(db);
    const added = (await service.add({ label: 'leche' })).record!;

    const removed = await service.remove(added.id);
    expect(removed).toBe(true);
    const row = await db.get(added.id);
    expect(row?.sync.deleted).toBe(true);
    expect(await service.get(added.id)).toBeUndefined();
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'shopping.remove', 'shoppingItem', added.id, added,
      expect.objectContaining({ sync: expect.objectContaining({ deleted: true }) }),
      'shoppingService',
    );
  });

  it('remove de un id inexistente devuelve false sin auditar', async () => {
    const service = createService(db);
    expect(await service.remove('no-existe')).toBe(false);
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
  });

  it('uncheckAll desmarca los comprados y audita una sola vez', async () => {
    await db.add(makeItem({ id: 'i1', checked: true }));
    await db.add(makeItem({ id: 'i2', checked: true, label: 'pan' }));
    await db.add(makeItem({ id: 'i3', checked: false, label: 'huevos' }));
    const service = createService(db);

    const n = await service.uncheckAll();
    expect(n).toBe(2);

    const all = await service.list();
    const i1 = all.find((i) => i.id === 'i1')!;
    const i3 = all.find((i) => i.id === 'i3')!;
    expect(i1.checked).toBe(false);
    expect(i1.sync.revision).toBe(2);
    expect(i3.checked).toBe(false);
    expect(i3.sync.revision).toBe(1); // no pendiente no se reescribe

    expect(vi.mocked(addAuditLog)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'shopping.uncheckAll', 'shoppingItem', '', 2, 0, 'shoppingService',
    );
  });

  it('uncheckAll sin ítems comprados devuelve 0 y no audita', async () => {
    await db.add(makeItem({ id: 'i1', checked: false }));
    const service = createService(db);
    expect(await service.uncheckAll()).toBe(0);
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
  });

  it('clearChecked elimina los comprados y audita con el conteo', async () => {
    await db.add(makeItem({ id: 'i1', checked: true }));
    await db.add(makeItem({ id: 'i2', checked: true, label: 'pan' }));
    await db.add(makeItem({ id: 'i3', checked: false, label: 'huevos' }));
    const service = createService(db);

    const n = await service.clearChecked();
    expect(n).toBe(2);

    const ids = (await service.list()).map((i) => i.id);
    expect(ids).toEqual(['i3']);

    expect(vi.mocked(addAuditLog)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'shopping.clearChecked', 'shoppingItem', '', 2, 0, 'shoppingService',
    );
  });

  it('clearChecked sin ítems comprados devuelve 0 y no audita', async () => {
    const service = createService(db);
    expect(await service.clearChecked()).toBe(0);
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
  });
});

describe('shoppingService — consultas', () => {
  it('remaining cuenta los ítems sin marcar', async () => {
    await db.add(makeItem({ id: 'i1', checked: false }));
    await db.add(makeItem({ id: 'i2', checked: true, label: 'pan' }));
    const service = createService(db);
    expect(await service.remaining()).toBe(1);
  });

  it('listFiltered filtra por all / pending / checked', async () => {
    await db.add(makeItem({ id: 'i1', checked: false }));
    await db.add(makeItem({ id: 'i2', checked: true, label: 'pan' }));
    const service = createService(db);

    expect((await service.listFiltered('all')).map((i) => i.id)).toEqual(['i1', 'i2']);
    expect((await service.listFiltered('pending')).map((i) => i.id)).toEqual(['i1']);
    expect((await service.listFiltered('checked')).map((i) => i.id)).toEqual(['i2']);
    expect((await service.listFiltered()).map((i) => i.id)).toEqual(['i1', 'i2']); // default all
  });

  it('get devuelve una copia y undefined para ids inexistentes o vacíos', async () => {
    const service = createService(db);
    const added = (await service.add({ label: 'leche' })).record!;

    const got = await service.get(added.id);
    got!.label = 'mutado';
    expect((await db.get(added.id))!.label).toBe('leche');

    expect(await service.get('no-existe')).toBeUndefined();
    expect(await service.get('')).toBeUndefined();
  });
});
