// ============================================================
// notesService — persistencia y auditoría (Pizarrón consolidado)
// ------------------------------------------------------------
// Cubre el servicio de listado de notas con una base en memoria
// (misma interfaz NotesDb), reloj y newId inyectables.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAuditLog, type NoteRecord } from '../src/core/db/fluDatabase';
import { createNotesService, type NotesDb } from '../src/core/notes/notesService';

// IndexedDB no está disponible en vitest → se mockea el log de auditoría.
vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
  return { ...actual, addAuditLog: vi.fn(async () => undefined as never) };
});

// Referencia de reloj fija: jueves 15 de enero de 2026, 10:00 local.
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const now = (): number => NOW;

let idCounter = 0;

function createMapDb(initial: NoteRecord[] = []): NotesDb {
  const map = new Map<string, NoteRecord>();
  for (const r of initial) map.set(r.id, { ...r, sync: { ...r.sync } });
  return {
    async add(record: NoteRecord): Promise<unknown> {
      map.set(record.id, { ...record, sync: { ...record.sync } });
      return undefined;
    },
    async put(record: NoteRecord): Promise<unknown> {
      map.set(record.id, { ...record, sync: { ...record.sync } });
      return undefined;
    },
    async delete(id: string): Promise<void> {
      map.delete(id);
    },
    async get(id: string): Promise<NoteRecord | undefined> {
      const row = map.get(id);
      return row ? { ...row, sync: { ...row.sync } } : undefined;
    },
    async toArray(): Promise<NoteRecord[]> {
      return Array.from(map.values()).map((r) => ({ ...r, sync: { ...r.sync } }));
    },
  };
}

function createService(db: NotesDb) {
  return createNotesService({ db, now, newId: () => `note-${++idCounter}` });
}

function makeNote(overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: 'note-1',
    label: 'comprar leche',
    done: false,
    createdAt: NOW,
    updatedAt: NOW,
    sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
    ...overrides,
  };
}

let db: NotesDb;

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  db = createMapDb();
});

describe('notesService — creación', () => {
  it('add crea la nota, la persiste y audita', async () => {
    const service = createService(db);
    const result = await service.add({ label: '  comprar leche  ' });

    expect(result.ok).toBe(true);
    const record = result.record!;
    expect(record.id).toBe('note-1');
    expect(record.label).toBe('comprar leche'); // trim
    expect(record.done).toBe(false);
    expect(record.createdAt).toBe(NOW);
    expect(record.updatedAt).toBe(NOW);
    expect(record.sync).toEqual({ revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false });
    expect(record.personId).toBeUndefined();
    expect(record.personName).toBeUndefined();

    expect((await db.get('note-1'))?.label).toBe('comprar leche');

    expect(vi.mocked(addAuditLog)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'notes.add', 'note', 'note-1', null, { label: 'comprar leche' }, 'notesService',
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

describe('notesService — toggle y rename', () => {
  it('toggle invierte done y sube la revisión de sync', async () => {
    const service = createService(db);
    const added = (await service.add({ label: 'comprar leche' })).record!;

    const toggled = await service.toggle(added.id);
    expect(toggled?.done).toBe(true);
    expect(toggled?.sync.revision).toBe(2);
    expect(toggled?.updatedAt).toBe(NOW);
    expect((await db.get(added.id))?.done).toBe(true);

    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'notes.toggle', 'note', added.id, false, true, 'notesService',
    );
  });

  it('toggle de un id inexistente devuelve null sin auditar', async () => {
    const service = createService(db);
    expect(await service.toggle('no-existe')).toBeNull();
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
  });

  it('rename actualiza la etiqueta y audita con el valor previo', async () => {
    const service = createService(db);
    const added = (await service.add({ label: 'comprar leche' })).record!;

    const renamed = await service.rename(added.id, '  comprar leche entera  ');
    expect(renamed?.label).toBe('comprar leche entera');
    expect(renamed?.sync.revision).toBe(2);

    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'notes.rename', 'note', added.id, 'comprar leche', 'comprar leche entera', 'notesService',
    );
  });

  it('rename con etiqueta vacía o id inexistente devuelve null sin auditar', async () => {
    const service = createService(db);
    const added = (await service.add({ label: 'comprar leche' })).record!;
    // El add ya audita (notes.add); limpiamos para medir solo el rename.
    vi.clearAllMocks();
    expect(await service.rename(added.id, '   ')).toBeNull();
    expect(await service.rename('no-existe', 'pan')).toBeNull();
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
  });
});

describe('notesService — borrado y limpieza', () => {
  it('remove borra, devuelve true y audita con el registro previo', async () => {
    const service = createService(db);
    const added = (await service.add({ label: 'comprar leche' })).record!;

    const removed = await service.remove(added.id);
    expect(removed).toBe(true);
    expect(await db.get(added.id)).toBeUndefined();
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'notes.remove', 'note', added.id, added, null, 'notesService',
    );
  });

  it('remove de un id inexistente devuelve false sin auditar', async () => {
    const service = createService(db);
    expect(await service.remove('no-existe')).toBe(false);
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
  });

  it('uncheckAll desmarca las hechas y audita una sola vez', async () => {
    await db.add(makeNote({ id: 'n1', done: true }));
    await db.add(makeNote({ id: 'n2', done: true, label: 'pan' }));
    await db.add(makeNote({ id: 'n3', done: false, label: 'huevos' }));
    const service = createService(db);

    const n = await service.uncheckAll();
    expect(n).toBe(2);

    const all = await service.list();
    const n1 = all.find((i) => i.id === 'n1')!;
    const n3 = all.find((i) => i.id === 'n3')!;
    expect(n1.done).toBe(false);
    expect(n1.sync.revision).toBe(2);
    expect(n3.done).toBe(false);
    expect(n3.sync.revision).toBe(1); // no hecha no se reescribe

    expect(vi.mocked(addAuditLog)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'notes.uncheckAll', 'note', '', 2, 0, 'notesService',
    );
  });

  it('uncheckAll sin notas hechas devuelve 0 y no audita', async () => {
    await db.add(makeNote({ id: 'n1', done: false }));
    const service = createService(db);
    expect(await service.uncheckAll()).toBe(0);
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
  });

  it('clearDone elimina las hechas y audita con el conteo', async () => {
    await db.add(makeNote({ id: 'n1', done: true }));
    await db.add(makeNote({ id: 'n2', done: true, label: 'pan' }));
    await db.add(makeNote({ id: 'n3', done: false, label: 'huevos' }));
    const service = createService(db);

    const n = await service.clearDone();
    expect(n).toBe(2);

    const ids = (await service.list()).map((i) => i.id);
    expect(ids).toEqual(['n3']);

    expect(vi.mocked(addAuditLog)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'notes.clearDone', 'note', '', 2, 0, 'notesService',
    );
  });

  it('clearDone sin notas hechas devuelve 0 y no audita', async () => {
    const service = createService(db);
    expect(await service.clearDone()).toBe(0);
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
  });
});

describe('notesService — consultas', () => {
  it('remaining cuenta las notas sin marcar', async () => {
    await db.add(makeNote({ id: 'n1', done: false }));
    await db.add(makeNote({ id: 'n2', done: true, label: 'pan' }));
    const service = createService(db);
    expect(await service.remaining()).toBe(1);
  });

  it('listFiltered filtra por all / pending / done', async () => {
    await db.add(makeNote({ id: 'n1', done: false }));
    await db.add(makeNote({ id: 'n2', done: true, label: 'pan' }));
    const service = createService(db);

    expect((await service.listFiltered('all')).map((i) => i.id)).toEqual(['n1', 'n2']);
    expect((await service.listFiltered('pending')).map((i) => i.id)).toEqual(['n1']);
    expect((await service.listFiltered('done')).map((i) => i.id)).toEqual(['n2']);
    expect((await service.listFiltered()).map((i) => i.id)).toEqual(['n1', 'n2']); // default all
  });

  it('get devuelve una copia y undefined para ids inexistentes o vacíos', async () => {
    const service = createService(db);
    const added = (await service.add({ label: 'comprar leche' })).record!;

    const got = await service.get(added.id);
    got!.label = 'mutado';
    expect((await db.get(added.id))!.label).toBe('comprar leche');

    expect(await service.get('no-existe')).toBeUndefined();
    expect(await service.get('')).toBeUndefined();
  });
});
