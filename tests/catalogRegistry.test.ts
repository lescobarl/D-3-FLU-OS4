// ============================================================
// catalogRegistry — núcleo genérico de catálogos dinámicos (1A)
// ------------------------------------------------------------
// Cubre el registro genérico con una base en memoria (misma
// interfaz CatalogDb), reloj y newId inyectables. El esquema de
// prueba emula el contrato real (idOf = id canónico, reservedIds).
// Regla #1: sin hardcode; validación por esquema inyectado.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAuditLog } from '../src/core/db/fluDatabase';
import {
  createCatalogRegistry,
  type CatalogDb,
  type CatalogRecord,
  type CatalogSchema,
} from '../src/core/catalogs/catalogRegistry';

// IndexedDB no está disponible en vitest → se mockea el log de auditoría
// (fluDatabase no abre la conexión hasta la primera operación real).
vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
  return { ...actual, addAuditLog: vi.fn(async () => undefined as never) };
});

// Referencia de reloj fija: jueves 15 de enero de 2026, 10:00 local.
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const now = (): number => NOW;

interface Item {
  id: string; // id canónico (slug)
  label: string;
}

const RESERVED = new Set(['fijo-a', 'fijo-b']);

const schema: CatalogSchema<Item> = {
  idOf: (data) => data.id,
  reservedIds: RESERVED,
  validate: (data) => {
    if (!data || typeof data !== 'object') return 'payload inválido';
    if (!data.id || !/^[a-z0-9-]+$/.test(data.id)) return 'id debe ser un slug';
    if (!data.label || !data.label.trim()) return 'label es obligatorio';
    return null;
  },
};

let idCounter = 0;

function createMapDb(initial: CatalogRecord<Item>[] = []): CatalogDb<Item> {
  const map = new Map<string, CatalogRecord<Item>>();
  for (const r of initial) map.set(r.id, { ...r, data: structuredClone(r.data), sync: { ...r.sync } });
  return {
    async add(record) {
      map.set(record.id, { ...record, data: structuredClone(record.data), sync: { ...record.sync } });
      return undefined;
    },
    async put(record) {
      map.set(record.id, { ...record, data: structuredClone(record.data), sync: { ...record.sync } });
      return undefined;
    },
    async delete(id) {
      map.delete(id);
    },
    async get(id) {
      const row = map.get(id);
      return row ? { ...row, data: structuredClone(row.data), sync: { ...row.sync } } : undefined;
    },
    async toArray() {
      return Array.from(map.values()).map((r) => ({ ...r, data: structuredClone(r.data), sync: { ...r.sync } }));
    },
  };
}

function createService(db: CatalogDb<Item>) {
  return createCatalogRegistry<Item>({
    db,
    schema,
    entity: 'item',
    now,
    newId: () => `rec-${++idCounter}`,
  });
}

let db: CatalogDb<Item>;

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  db = createMapDb();
});

describe('catalogRegistry — registro (register)', () => {
  it('register crea un registro completo, lo persiste y audita', async () => {
    const service = createService(db);
    const result = await service.register({ id: 'selva', label: 'Selva' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // id del registro (UUID inyectado) ≠ id canónico (slug del payload)
    expect(result.record.id).toBe('rec-1');
    expect(result.record.data.id).toBe('selva');
    expect(result.record.createdAt).toBe(NOW);
    expect(result.record.updatedAt).toBe(NOW);
    expect(result.record.sync).toEqual({
      revision: 1,
      updated_at: new Date(NOW).toISOString(),
      deleted: false,
    });

    const rows = await db.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].data).toEqual({ id: 'selva', label: 'Selva' });

    expect(addAuditLog).toHaveBeenCalledTimes(1);
    expect(addAuditLog).toHaveBeenCalledWith(
      'item.register',
      'item',
      'selva',
      null,
      { data: { id: 'selva', label: 'Selva' } },
      'catalogRegistry',
    );
  });

  it('register rechaza payloads inválidos sin persistir ni auditar', async () => {
    const service = createService(db);
    const result = await service.register({ id: 'X', label: '' });
    expect(result).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await db.toArray()).toHaveLength(0);
    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it('register rechaza ids reservados', async () => {
    const service = createService(db);
    const result = await service.register({ id: 'fijo-a', label: 'Intruso' });
    expect(result).toEqual({ ok: false, reason: 'reserved' });
    expect(await db.toArray()).toHaveLength(0);
  });

  it('register rechaza duplicados por id canónico', async () => {
    const service = createService(db);
    await service.register({ id: 'selva', label: 'Selva' });
    const result = await service.register({ id: 'selva', label: 'Selva 2' });
    expect(result).toEqual({ ok: false, reason: 'duplicate' });
    expect(await db.toArray()).toHaveLength(1);
  });
});

describe('catalogRegistry — consultas (get/list)', () => {
  it('get devuelve una copia de los datos por id canónico', async () => {
    const service = createService(db);
    await service.register({ id: 'selva', label: 'Selva' });
    const data = await service.get('selva');
    expect(data).toEqual({ id: 'selva', label: 'Selva' });
    // copia: mutar el resultado no afecta a la base
    if (data) data.label = 'Mutado';
    expect(await service.get('selva')).toEqual({ id: 'selva', label: 'Selva' });
  });

  it('get devuelve undefined para ids vacíos o inexistentes', async () => {
    const service = createService(db);
    expect(await service.get('')).toBeUndefined();
    expect(await service.get('inexistente')).toBeUndefined();
  });

  it('list devuelve los datos de todos los registros', async () => {
    const service = createService(db);
    await service.register({ id: 'selva', label: 'Selva' });
    await service.register({ id: 'oceano', label: 'Océano' });
    expect(await service.list()).toEqual([
      { id: 'selva', label: 'Selva' },
      { id: 'oceano', label: 'Océano' },
    ]);
  });
});

describe('catalogRegistry — actualización (update)', () => {
  it('update conserva el registro, incrementa revisión y audita con el previo', async () => {
    const service = createService(db);
    await service.register({ id: 'selva', label: 'Selva' });
    const result = await service.update('selva', { id: 'selva', label: 'Selva Profunda' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.id).toBe('rec-1'); // no cambia el id del registro
    expect(result.record.data.label).toBe('Selva Profunda');
    expect(result.record.updatedAt).toBe(NOW);
    expect(result.record.sync.revision).toBe(2);
    expect(result.record.sync.updated_at).toBe(new Date(NOW).toISOString());

    expect(addAuditLog).toHaveBeenCalledWith(
      'item.update',
      'item',
      'selva',
      { id: 'selva', label: 'Selva' },
      { data: { id: 'selva', label: 'Selva Profunda' } },
      'catalogRegistry',
    );
  });

  it('update permite renombrar el id canónico sin colisión', async () => {
    const service = createService(db);
    await service.register({ id: 'selva', label: 'Selva' });
    const result = await service.update('selva', { id: 'selva-profunda', label: 'Selva Profunda' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.data.id).toBe('selva-profunda');
    expect(await service.get('selva')).toBeUndefined();
    expect(await service.get('selva-profunda')).toEqual({ id: 'selva-profunda', label: 'Selva Profunda' });
  });

  it('update rechaza colisión con otro registro', async () => {
    const service = createService(db);
    await service.register({ id: 'selva', label: 'Selva' });
    await service.register({ id: 'oceano', label: 'Océano' });
    const result = await service.update('oceano', { id: 'selva', label: 'Océano' });
    expect(result).toEqual({ ok: false, reason: 'duplicate' });
    expect((await service.get('oceano'))?.label).toBe('Océano');
  });

  it('update devuelve not-found para un id canónico inexistente', async () => {
    const service = createService(db);
    const result = await service.update('fantasma', { id: 'fantasma', label: 'Fantasma' });
    expect(result).toEqual({ ok: false, reason: 'not-found' });
    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it('update rechaza ids reservados y payloads inválidos', async () => {
    const service = createService(db);
    expect(await service.update('fijo-a', { id: 'fijo-a', label: 'X' })).toEqual({ ok: false, reason: 'reserved' });
    expect(await service.update('', { id: 'x', label: 'X' })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await service.update('selva', { id: 'selva', label: '' })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(addAuditLog).not.toHaveBeenCalled();
  });
});

describe('catalogRegistry — borrado (remove)', () => {
  it('remove borra el registro, devuelve true y audita con el previo', async () => {
    const service = createService(db);
    await service.register({ id: 'selva', label: 'Selva' });
    const removed = await service.remove('selva');
    expect(removed).toBe(true);
    expect(await db.toArray()).toHaveLength(0);
    expect(addAuditLog).toHaveBeenCalledWith(
      'item.remove',
      'item',
      'selva',
      { id: 'selva', label: 'Selva' },
      null,
      'catalogRegistry',
    );
  });

  it('remove devuelve false sin auditar para inexistente, reservado o vacío', async () => {
    const service = createService(db);
    expect(await service.remove('fantasma')).toBe(false);
    expect(await service.remove('fijo-a')).toBe(false);
    expect(await service.remove('')).toBe(false);
    expect(addAuditLog).not.toHaveBeenCalled();
  });
});
