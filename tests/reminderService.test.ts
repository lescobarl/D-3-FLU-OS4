// ============================================================
// reminderService — persistencia y auditoría (B1/B4) — Fase 2
// ------------------------------------------------------------
// Cubre el servicio de recordatorios con una base en memoria
// (misma interfaz RemindersDb), reloj y newId inyectables.
// Regla #1: sin hardcode; límites y categoría desde config.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAuditLog, type ReminderRecord } from '../src/core/db/fluDatabase';
import { createReminderService, type RemindersDb } from '../src/core/reminders/reminderService';

// IndexedDB no está disponible en vitest → se mockea el log de auditoría
// (fluDatabase no abre la conexión hasta la primera operación real).
vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
  return { ...actual, addAuditLog: vi.fn(async () => undefined as never) };
});

// Referencia de reloj fija: jueves 15 de enero de 2026, 10:00 local.
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const now = (): number => NOW;
const DAY_MS = 24 * 60 * 60 * 1000;

const CONFIG = { maxPerDay: 3, defaultCategory: 'general' };

let idCounter = 0;

function createMapDb(initial: ReminderRecord[] = []): RemindersDb {
  const map = new Map<string, ReminderRecord>();
  for (const r of initial) map.set(r.id, { ...r, sync: { ...r.sync } });
  return {
    async add(record: ReminderRecord): Promise<unknown> {
      map.set(record.id, { ...record, sync: { ...record.sync } });
      return undefined;
    },
    async put(record: ReminderRecord): Promise<unknown> {
      map.set(record.id, { ...record, sync: { ...record.sync } });
      return undefined;
    },
    async delete(id: string): Promise<void> {
      map.delete(id);
    },
    async get(id: string): Promise<ReminderRecord | undefined> {
      const row = map.get(id);
      return row ? { ...row, sync: { ...row.sync } } : undefined;
    },
    async toArray(): Promise<ReminderRecord[]> {
      return Array.from(map.values()).map((r) => ({ ...r, sync: { ...r.sync } }));
    },
  };
}

function createService(db: RemindersDb) {
  return createReminderService({
    db,
    config: CONFIG,
    now,
    newId: () => `rem-${++idCounter}`,
  });
}

let db: RemindersDb;

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  db = createMapDb();
});

describe('reminderService — creación de recordatorios', () => {
  it('add crea un registro completo, lo persiste y audita', async () => {
    const service = createService(db);
    const result = await service.add({ text: '  comprar leche  ', dueAt: NOW });

    expect(result.ok).toBe(true);
    const record = result.record!;
    expect(record.id).toBe('rem-1');
    expect(record.text).toBe('comprar leche'); // trim
    expect(record.dueAt).toBe(NOW);
    expect(record.category).toBe('general'); // default del config
    expect(record.status).toBe('pending');
    expect(record.createdAt).toBe(NOW);
    expect(record.updatedAt).toBe(NOW);
    expect(record.sync).toEqual({ revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false });
    expect(record.personId).toBeUndefined();
    expect(record.personName).toBeUndefined();

    // persistido en la base
    const stored = await db.get('rem-1');
    expect(stored?.text).toBe('comprar leche');

    // auditoría (Obligación #5)
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'reminder.create', 'reminder', 'rem-1', null, { text: 'comprar leche', dueAt: NOW }, 'reminderService',
    );
  });

  it('add respeta category, personId y personName explícitos', async () => {
    const service = createService(db);
    const result = await service.add({
      text: 'reunión con cliente',
      dueAt: NOW,
      category: 'trabajo',
      personId: 'p1',
      personName: 'Ana',
    });

    expect(result.record?.category).toBe('trabajo');
    expect(result.record?.personId).toBe('p1');
    expect(result.record?.personName).toBe('Ana');
  });

  it('rechaza texto vacío o vencimiento inválido como invalid-input sin auditar', async () => {
    const service = createService(db);
    const r1 = await service.add({ text: '   ', dueAt: NOW });
    expect(r1).toEqual({ ok: false, reason: 'invalid-input' });

    const r2 = await service.add({ text: 'hola', dueAt: Number.NaN });
    expect(r2).toEqual({ ok: false, reason: 'invalid-input' });

    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
    expect(idCounter).toBe(0); // no se generó id
  });

  it('no supera el tope diario (maxPerDay)', async () => {
    const service = createService(db);
    for (let i = 0; i < CONFIG.maxPerDay; i += 1) {
      const res = await service.add({ text: `tarea ${i}`, dueAt: NOW + i });
      expect(res.ok).toBe(true);
    }

    const overflow = await service.add({ text: 'tarea extra', dueAt: NOW });
    expect(overflow.ok).toBe(false);
    expect(overflow.reason).toBe('max-per-day');

    // solo se auditaron las creaciones aceptadas
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledTimes(CONFIG.maxPerDay);
  });
});

describe('reminderService — consultas', () => {
  it('get devuelve una copia y undefined para ids inexistentes o vacíos', async () => {
    const service = createService(db);
    const added = (await service.add({ text: 'a', dueAt: NOW })).record!;

    const got = await service.get(added.id);
    got!.text = 'mutado';
    expect((await db.get(added.id))!.text).toBe('a'); // la base no se muta

    expect(await service.get('inexistente')).toBeUndefined();
    expect(await service.get('')).toBeUndefined();
  });

  it('list y listPending filtran por estado', async () => {
    const service = createService(db);
    await service.add({ text: 'a', dueAt: NOW });
    await service.add({ text: 'b', dueAt: NOW + 1000 });

    await service.complete((await service.listPending())[0].id);

    expect(await service.list()).toHaveLength(2);
    const pending = await service.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].text).toBe('b');
  });

  it('listDue respeta el límite de vencimiento (boundary)', async () => {
    const service = createService(db);
    const a = (await service.add({ text: 'a', dueAt: NOW })).record!;
    const b = (await service.add({ text: 'b', dueAt: NOW + 5000 })).record!;

    expect((await service.listDue()).map((r) => r.id)).toEqual([a.id]);
    expect((await service.listDue(NOW)).map((r) => r.id)).toEqual([a.id]);
    expect((await service.listDue(NOW - 1))).toHaveLength(0);
    expect((await service.listDue(NOW + 5000)).map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('countCreatedToday cuenta solo los creados en el día de referencia', async () => {
    const service = createService(db);
    expect(await service.countCreatedToday()).toBe(0);
    await service.add({ text: 'a', dueAt: NOW });
    await service.add({ text: 'b', dueAt: NOW + DAY_MS - 1 }); // mismo día
    await service.add({ text: 'c', dueAt: NOW + DAY_MS }); // otro día (mismo reloj fijo)
    expect(await service.countCreatedToday()).toBe(3);
  });
});

describe('reminderService — transiciones y borrado', () => {
  it('complete cambia a done y sube la revisión de sync', async () => {
    const service = createService(db);
    const added = (await service.add({ text: 'llamar', dueAt: NOW })).record!;

    const done = await service.complete(added.id);
    expect(done?.status).toBe('done');
    expect(done?.sync.revision).toBe(2);
    expect(done?.updatedAt).toBe(NOW);
    expect((await db.get(added.id))?.status).toBe('done');

    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'reminder.complete', 'reminder', added.id, 'pending', 'done', 'reminderService',
    );
  });

  it('complete sobre un estado ya done no vuelve a auditar', async () => {
    const service = createService(db);
    const added = (await service.add({ text: 'llamar', dueAt: NOW })).record!;
    // El add ya audita (reminder.add); limpiamos para medir solo el complete.
    vi.clearAllMocks();

    await service.complete(added.id);
    const again = await service.complete(added.id);
    expect(again?.status).toBe('done');
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledTimes(1);
  });

  it('dismiss cambia a dismissed y audita', async () => {
    const service = createService(db);
    const added = (await service.add({ text: 'posponer', dueAt: NOW })).record!;

    const dismissed = await service.dismiss(added.id);
    expect(dismissed?.status).toBe('dismissed');
    expect(dismissed?.sync.revision).toBe(2);
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'reminder.dismiss', 'reminder', added.id, 'pending', 'dismissed', 'reminderService',
    );
  });

  it('complete de un id inexistente devuelve null sin auditar', async () => {
    const service = createService(db);
    expect(await service.complete('no-existe')).toBeNull();
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
  });

  it('remove borra, devuelve true y audita con el registro previo', async () => {
    const service = createService(db);
    const added = (await service.add({ text: 'borrar', dueAt: NOW })).record!;

    const removed = await service.remove(added.id);
    expect(removed).toBe(true);
    expect(await db.get(added.id)).toBeUndefined();
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'reminder.remove', 'reminder', added.id, added, null, 'reminderService',
    );
  });

  it('remove de un id inexistente devuelve false sin auditar', async () => {
    const service = createService(db);
    expect(await service.remove('no-existe')).toBe(false);
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
  });
});

describe('reminderService — filtro por autor (B11)', () => {
  it('listByAuthor filtra por personName sin distinguir mayúsculas ni espacios', async () => {
    const service = createService(db);
    await service.add({ text: 'Ana', dueAt: NOW, personName: 'Ana' });
    await service.add({ text: 'ana trim', dueAt: NOW, personName: '  ana  ' });
    await service.add({ text: 'Luis', dueAt: NOW, personName: 'Luis' });
    await service.add({ text: 'sin autor', dueAt: NOW });
    const deAna = await service.listByAuthor('ana');
    expect(deAna.map((r) => r.text).sort()).toEqual(['Ana', 'ana trim']);
    const deLuis = await service.listByAuthor('LUIS');
    expect(deLuis.map((r) => r.text)).toEqual(['Luis']);
    expect(await service.listByAuthor('')).toHaveLength(0);
  });
  it('listByAuthor filtra por personId o por personName (AuthorFilter)', async () => {
    const service = createService(db);
    await service.add({ text: 'por id', dueAt: NOW, personId: 'p1', personName: 'Ana' });
    await service.add({ text: 'por nombre', dueAt: NOW, personId: 'p2', personName: 'Ana' });
    await service.add({ text: 'de otro', dueAt: NOW, personId: 'p3', personName: 'Luis' });
    const porId = await service.listByAuthor({ personId: 'p1' });
    expect(porId.map((r) => r.text)).toEqual(['por id']);
    const porNombre = await service.listByAuthor({ personName: ' ana ' });
    expect(porNombre.map((r) => r.text).sort()).toEqual(['por id', 'por nombre']);
  });
  it('listPendingByAuthor solo devuelve pendientes y rechaza autor vacío', async () => {
    const service = createService(db);
    const hecho = (await service.add({ text: 'tarea Ana A', dueAt: NOW, personName: 'Ana' })).record!;
    await service.add({ text: 'tarea Ana B', dueAt: NOW, personName: 'Ana' });
    await service.add({ text: 'tarea Luis', dueAt: NOW, personName: 'Luis' });
    await service.complete(hecho.id);
    const pendientes = await service.listPendingByAuthor('ana');
    expect(pendientes.map((r) => r.text)).toEqual(['tarea Ana B']);
    const todos = await service.listByAuthor('ana');
    expect(todos.map((r) => r.text).sort()).toEqual(['tarea Ana A', 'tarea Ana B']);
    expect(await service.listPendingByAuthor('')).toHaveLength(0);
  });
});
