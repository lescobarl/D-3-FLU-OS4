// ============================================================
// temporalService — motor temporal genérico (alarmas + temporizadores)
// ------------------------------------------------------------
// Cubre el servicio con una base en memoria (misma interfaz
// TemporalDb), reloj y newId inyectables (mismo patrón que
// reminderService.test.ts). Regla #1: sin hardcode; el tope
// maxActive viene de config, la recurrencia por defecto es once.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAuditLog, type SyncTuple } from '../src/core/db/fluDatabase';
import {
  createTemporalService,
  type TemporalDb,
  type TemporalItemRecord,
} from '../src/core/temporal/temporalService';
import { dailyRecurrence, intervalRecurrence, onceRecurrence } from '../src/core/temporal/temporalTypes';

// IndexedDB no está disponible en vitest → se mockea el log de auditoría
// (fluDatabase no abre la conexión hasta la primera operación real).
vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
  return { ...actual, addAuditLog: vi.fn(async () => undefined as never) };
});

// Referencia de reloj fija: jueves 15 de enero de 2026, 10:00 local.
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const now = (): number => NOW;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY_MS = 24 * HOUR;

// Fecha local (meses 1-based) para evitar dependencia de zona horaria.
const at = (y: number, mo: number, d: number, h = 0, mi = 0): number =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

const CONFIG = { maxActive: 3 };

let idCounter = 0;

function createMapDb(initial: TemporalItemRecord[] = []): TemporalDb {
  const map = new Map<string, TemporalItemRecord>();
  for (const r of initial) map.set(r.id, { ...r, sync: { ...r.sync } });
  return {
    async add(record: TemporalItemRecord): Promise<unknown> {
      map.set(record.id, { ...record, sync: { ...record.sync } });
      return undefined;
    },
    async put(record: TemporalItemRecord): Promise<unknown> {
      map.set(record.id, { ...record, sync: { ...record.sync } });
      return undefined;
    },
    async delete(id: string): Promise<void> {
      map.delete(id);
    },
    async get(id: string): Promise<TemporalItemRecord | undefined> {
      const row = map.get(id);
      return row ? { ...row, sync: { ...row.sync } } : undefined;
    },
    async toArray(): Promise<TemporalItemRecord[]> {
      return Array.from(map.values()).map((r) => ({ ...r, sync: { ...r.sync } }));
    },
  };
}

function createService(db: TemporalDb) {
  return createTemporalService({
    db,
    config: CONFIG,
    now,
    newId: () => `temp-${++idCounter}`,
  });
}

let db: TemporalDb;

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  db = createMapDb();
});

describe('temporalService — creación de ítems', () => {
  it('add crea un temporizador countdown: nextAt = at + durationMs, persiste y audita', async () => {
    const service = createService(db);
    const result = await service.add({
      kind: 'timer',
      label: '  pasta  ',
      trigger: { kind: 'countdown', at: NOW, durationMs: 5 * MINUTE },
    });

    expect(result.ok).toBe(true);
    const record = result.record!;
    expect(record.id).toBe('temp-1');
    expect(record.kind).toBe('timer');
    expect(record.label).toBe('pasta'); // trim
    expect(record.trigger).toEqual({ kind: 'countdown', at: NOW, durationMs: 5 * MINUTE });
    expect(record.recurrence.kind).toBe('once'); // recurrencia por defecto
    expect(record.nextAt).toBe(NOW + 5 * MINUTE);
    expect(record.status).toBe('pending');
    expect(record.sync).toMatchObject({ revision: 1, deleted: false });

    const persisted = await db.get('temp-1');
    expect(persisted).toBeDefined();
    expect(persisted!.nextAt).toBe(NOW + 5 * MINUTE);

    expect(addAuditLog).toHaveBeenCalledWith(
      'temporalItem.create',
      'temporalItem',
      'temp-1',
      null,
      { kind: 'timer', label: 'pasta', nextAt: NOW + 5 * MINUTE },
      'temporalService',
    );
  });

  it('add de un disparo absoluto una sola vez usa el timestamp indicado', async () => {
    const service = createService(db);
    const when = at(2026, 1, 20, 18, 30);
    const result = await service.add({
      kind: 'alarm',
      label: 'Cena',
      trigger: { kind: 'absolute', at: when },
      recurrence: onceRecurrence(),
    });

    expect(result.ok).toBe(true);
    expect(result.record!.nextAt).toBe(when);
  });

  it('add crea una alarma diaria: nextAt = próxima vez de la hora del día', async () => {
    const service = createService(db);
    const result = await service.add({
      kind: 'alarm',
      label: 'Despertador',
      trigger: { kind: 'daily', timeOfDay: '07:00' },
      recurrence: dailyRecurrence(),
    });

    // NOW = jueves 15 ene 10:00 → la primera vez es el viernes 16 ene 07:00.
    expect(result.ok).toBe(true);
    expect(result.record!.nextAt).toBe(at(2026, 1, 16, 7, 0));
  });

  it('rechaza entradas inválidas sin persistir ni auditar', async () => {
    const service = createService(db);
    const invalids: Parameters<typeof service.add>[0][] = [
      // etiqueta vacía o solo espacios
      { kind: 'alarm', label: '', trigger: { kind: 'daily', timeOfDay: '07:00' } },
      { kind: 'alarm', label: '   ', trigger: { kind: 'daily', timeOfDay: '07:00' } },
      // kind no válido
      { kind: 'bogus' as never, label: 'X', trigger: { kind: 'daily', timeOfDay: '07:00' } },
      // disparador absoluto con at no finito
      { kind: 'alarm', label: 'X', trigger: { kind: 'absolute', at: Number.NaN } },
      // disparador daily con hora inválida
      { kind: 'alarm', label: 'X', trigger: { kind: 'daily', timeOfDay: '25:99' } },
      // recurrencia interval con everyMs no positivo
      {
        kind: 'timer',
        label: 'X',
        trigger: { kind: 'countdown', at: NOW, durationMs: 1000 },
        recurrence: intervalRecurrence(0),
      },
    ];

    for (const input of invalids) {
      const result = await service.add(input);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('invalid-input');
      expect(result.record).toBeUndefined();
    }

    expect((await db.toArray()).length).toBe(0);
    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it('rechaza un disparo absoluto ya agotado (en el pasado)', async () => {
    const service = createService(db);
    const result = await service.add({
      kind: 'alarm',
      label: 'Ayer',
      trigger: { kind: 'absolute', at: NOW - DAY_MS },
      recurrence: onceRecurrence(),
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid-input');
    expect((await db.toArray()).length).toBe(0);
  });

  it('no supera el tope de activos (maxActive)', async () => {
    const service = createService(db);
    for (let i = 1; i <= CONFIG.maxActive; i += 1) {
      const ok = await service.add({
        kind: 'timer',
        label: `T${i}`,
        trigger: { kind: 'countdown', at: NOW, durationMs: i * MINUTE },
      });
      expect(ok.ok).toBe(true);
    }

    const overflow = await service.add({
      kind: 'timer',
      label: 'T4',
      trigger: { kind: 'countdown', at: NOW, durationMs: 4 * MINUTE },
    });
    expect(overflow.ok).toBe(false);
    expect(overflow.reason).toBe('max-active');
    expect((await db.toArray()).length).toBe(CONFIG.maxActive);
  });
});

describe('temporalService — consultas', () => {
  it('get devuelve una copia y undefined para ids inexistentes o vacíos', async () => {
    const service = createService(db);
    expect(await service.get('')).toBeUndefined();
    expect(await service.get('nope')).toBeUndefined();

    await service.add({ kind: 'timer', label: 'A', trigger: { kind: 'countdown', at: NOW, durationMs: 1000 } });
    const record = await service.get('temp-1');
    expect(record).toBeDefined();

    // La copia devuelta no muta lo persistido.
    record!.label = 'mutado';
    const again = await service.get('temp-1');
    expect(again!.label).toBe('A');
  });

  it('list y listActive filtran por estado', async () => {
    const service = createService(db);
    await service.add({ kind: 'timer', label: 'A', trigger: { kind: 'countdown', at: NOW, durationMs: 1000 } });
    await service.add({ kind: 'timer', label: 'B', trigger: { kind: 'countdown', at: NOW, durationMs: 2000 } });

    expect((await service.list()).length).toBe(2);
    expect((await service.listActive()).length).toBe(2);

    await service.complete('temp-1');
    expect((await service.list()).length).toBe(2);
    expect((await service.listActive()).length).toBe(1);
    expect((await service.listActive())[0].id).toBe('temp-2');
  });

  it('listByKind separa alarmas y temporizadores', async () => {
    const service = createService(db);
    await service.add({ kind: 'timer', label: 'A', trigger: { kind: 'countdown', at: NOW, durationMs: 1000 } });
    await service.add({ kind: 'alarm', label: 'B', trigger: { kind: 'daily', timeOfDay: '07:00' } });

    const timers = await service.listByKind('timer');
    const alarms = await service.listByKind('alarm');
    expect(timers.map((r) => r.id)).toEqual(['temp-1']);
    expect(alarms.map((r) => r.id)).toEqual(['temp-2']);
  });

  it('listDue devuelve solo pendientes con nextAt <= referencia', async () => {
    const service = createService(db);
    await service.add({ kind: 'timer', label: 'A', trigger: { kind: 'countdown', at: NOW, durationMs: 10 * MINUTE } });

    expect(await service.listDue(NOW)).toEqual([]);
    const due = await service.listDue(NOW + 10 * MINUTE);
    expect(due.map((r) => r.id)).toEqual(['temp-1']);

    await service.complete('temp-1');
    expect(await service.listDue(NOW + 10 * MINUTE)).toEqual([]);
  });

  it('countActive cuenta solo pendientes', async () => {
    const service = createService(db);
    await service.add({ kind: 'timer', label: 'A', trigger: { kind: 'countdown', at: NOW, durationMs: 1000 } });
    await service.add({ kind: 'timer', label: 'B', trigger: { kind: 'countdown', at: NOW, durationMs: 2000 } });
    expect(await service.countActive()).toBe(2);

    await service.cancel('temp-1');
    expect(await service.countActive()).toBe(1);
  });
});

describe('temporalService — transiciones, rearm y borrado', () => {
  it('complete cambia a done, sube la revisión de sync y audita', async () => {
    const service = createService(db);
    await service.add({ kind: 'timer', label: 'A', trigger: { kind: 'countdown', at: NOW, durationMs: 1000 } });

    const done = await service.complete('temp-1');
    expect(done!.status).toBe('done');
    expect(done!.sync.revision).toBe(2);
    expect(done!.updatedAt).toBe(NOW);

    expect(addAuditLog).toHaveBeenCalledWith(
      'temporalItem.complete',
      'temporalItem',
      'temp-1',
      'pending',
      'done',
      'temporalService',
    );
  });

  it('complete sobre un estado ya done no vuelve a auditar', async () => {
    const service = createService(db);
    await service.add({ kind: 'timer', label: 'A', trigger: { kind: 'countdown', at: NOW, durationMs: 1000 } });
    await service.complete('temp-1');

    vi.mocked(addAuditLog).mockClear();
    const again = await service.complete('temp-1');
    expect(again!.status).toBe('done');
    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it('cancel cambia a cancelled y audita', async () => {
    const service = createService(db);
    await service.add({ kind: 'alarm', label: 'B', trigger: { kind: 'daily', timeOfDay: '07:00' } });

    const cancelled = await service.cancel('temp-1');
    expect(cancelled!.status).toBe('cancelled');
    expect(addAuditLog).toHaveBeenCalledWith(
      'temporalItem.cancel',
      'temporalItem',
      'temp-1',
      'pending',
      'cancelled',
      'temporalService',
    );
  });

  it('complete de un id inexistente devuelve null sin auditar', async () => {
    const service = createService(db);
    const result = await service.complete('nope');
    expect(result).toBeNull();
    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it('rearm de una alarma diaria mueve nextAt al siguiente disparo', async () => {
    const service = createService(db);
    const added = await service.add({
      kind: 'alarm',
      label: 'Despertador',
      trigger: { kind: 'daily', timeOfDay: '07:00' },
      recurrence: dailyRecurrence(),
    });
    const first = added.record!.nextAt;
    expect(first).toBe(at(2026, 1, 16, 7, 0));

    const rearMed = await service.rearm('temp-1', first);
    expect(rearMed).not.toBeNull();
    expect(rearMed!.nextAt).toBe(at(2026, 1, 17, 7, 0));
    expect(rearMed!.sync.revision).toBe(2);

    expect(addAuditLog).toHaveBeenCalledWith(
      'temporalItem.rearm',
      'temporalItem',
      'temp-1',
      first,
      at(2026, 1, 17, 7, 0),
      'temporalService',
    );
  });

  it('rearm de un temporizador (countdown) devuelve null: recurrencia agotada', async () => {
    const service = createService(db);
    await service.add({ kind: 'timer', label: 'A', trigger: { kind: 'countdown', at: NOW, durationMs: 1000 } });

    const rearMed = await service.rearm('temp-1', NOW + 1000);
    expect(rearMed).toBeNull();

    // El ítem sigue pending y sin rearmar (no muta, no audita).
    const row = await service.get('temp-1');
    expect(row!.status).toBe('pending');
    expect(row!.nextAt).toBe(NOW + 1000);
    expect(addAuditLog).not.toHaveBeenCalledWith('temporalItem.rearm', expect.anything(), 'temp-1', expect.anything(), expect.anything(), 'temporalService');
  });

  it('rearm de un id inexistente devuelve null', async () => {
    const service = createService(db);
    expect(await service.rearm('nope')).toBeNull();
  });

  it('remove borra, devuelve true y audita con el registro previo', async () => {
    const service = createService(db);
    await service.add({ kind: 'timer', label: 'A', trigger: { kind: 'countdown', at: NOW, durationMs: 1000 } });
    const before = await db.get('temp-1');

    const removed = await service.remove('temp-1');
    expect(removed).toBe(true);
    expect(await db.get('temp-1')).toBeUndefined();

    expect(addAuditLog).toHaveBeenCalledWith('temporalItem.remove', 'temporalItem', 'temp-1', before, null, 'temporalService');
  });

  it('remove de un id inexistente devuelve false sin auditar', async () => {
    const service = createService(db);
    expect(await service.remove('nope')).toBe(false);
    expect(addAuditLog).not.toHaveBeenCalled();
  });
});

describe('temporalService — update (editar etiqueta)', () => {
  it('edita la etiqueta e incrementa la revisión', async () => {
    const service = createService(createMapDb());
    const created = (
      await service.add({ kind: 'alarm', label: 'Despertar', trigger: { kind: 'countdown', at: NOW, durationMs: 1000 } })
    ).record!;
    const updated = await service.update(created.id, { label: 'Despertar temprano' });
    expect(updated?.label).toBe('Despertar temprano');
    expect(updated?.sync.revision).toBe(created.sync.revision + 1);
  });

  it('etiqueta vacía no cambia el registro', async () => {
    const service = createService(createMapDb());
    const created = (
      await service.add({ kind: 'timer', label: 'Café', trigger: { kind: 'countdown', at: NOW, durationMs: 1000 } })
    ).record!;
    const same = await service.update(created.id, { label: '   ' });
    expect(same?.label).toBe('Café');
  });

  it('id inexistente → null', async () => {
    const service = createService(createMapDb());
    expect(await service.update('no-existe', { label: 'x' })).toBeNull();
  });

  it('cambia la HORA (timeOfDay) y recalcula nextAt (rearm)', async () => {
    const service = createService(createMapDb());
    const created = (
      await service.add({
        kind: 'alarm',
        label: 'Despertar',
        trigger: { kind: 'daily', timeOfDay: '07:00' },
        recurrence: { kind: 'daily' },
      })
    ).record!;

    const updated = await service.update(created.id, { timeOfDay: '13:40' });
    expect((updated?.trigger as any).timeOfDay).toBe('13:40');
    expect(updated?.nextAt).not.toBe(created.nextAt);
    const d = new Date(updated!.nextAt);
    expect(d.getHours()).toBe(13);
    expect(d.getMinutes()).toBe(40);
  });

  it('hora inválida no cambia nada', async () => {
    const service = createService(createMapDb());
    const created = (
      await service.add({
        kind: 'alarm',
        label: 'A',
        trigger: { kind: 'daily', timeOfDay: '07:00' },
        recurrence: { kind: 'daily' },
      })
    ).record!;
    const same = await service.update(created.id, { timeOfDay: '99:99' });
    expect((same?.trigger as any).timeOfDay).toBe('07:00');
  });
});
