// ============================================================
// diaryService — Diario personal (Fase 6, Módulo J)
// ------------------------------------------------------------
// Cubre el servicio del diario con una base en memoria (misma
// interfaz DiaryDb), reloj y newId inyectables.
// Regla #1: sin hardcode; tope diario desde config. Cubre:
// alta, listado (fecha desc, createdAt desc), historial,
// edición y borrado con auditoría.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAuditLog, type DiaryEntryRecord } from '../src/core/db/fluDatabase';
import {
  createDiaryService,
  type DiaryConfig,
  type DiaryDb,
} from '../src/core/diary/diaryService';

// IndexedDB no está disponible en vitest → se mockea el log de auditoría
// (fluDatabase no abre la conexión hasta la primera operación real).
vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
  return { ...actual, addAuditLog: vi.fn(async () => undefined as never) };
});

// Referencia de reloj fija: jueves 15 de enero de 2026, 10:00 local.
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const now = (): number => NOW;

const CONFIG: DiaryConfig = {
  maxEntriesPerDay: 50,
};

// 'YYYY-MM-DD' locales alrededor de la referencia (2026-01-15).
const TWO_DAYS_AGO = '2026-01-13';
const YESTERDAY = '2026-01-14';
const TODAY = '2026-01-15';

let idCounter = 0;

function makeEntry(overrides: Partial<DiaryEntryRecord> = {}): DiaryEntryRecord {
  return {
    id: 'seed-entry',
    date: TODAY,
    title: 'Mi día',
    content: 'Fue un buen día',
    mood: 4,
    participantId: 'p1',
    participantName: 'Ana',
    createdAt: NOW,
    updatedAt: NOW,
    sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
    ...overrides,
  };
}

function createMapDb(initialEntries: DiaryEntryRecord[] = []): DiaryDb {
  const diaryEntries = new Map<string, DiaryEntryRecord>();
  for (const r of initialEntries) diaryEntries.set(r.id, { ...r, sync: { ...r.sync } });
  return {
    diaryEntries: {
      async add(record: DiaryEntryRecord): Promise<unknown> {
        diaryEntries.set(record.id, { ...record, sync: { ...record.sync } });
        return undefined;
      },
      async put(record: DiaryEntryRecord): Promise<unknown> {
        diaryEntries.set(record.id, { ...record, sync: { ...record.sync } });
        return undefined;
      },
      async delete(id: string): Promise<void> {
        diaryEntries.delete(id);
      },
      async get(id: string): Promise<DiaryEntryRecord | undefined> {
        const row = diaryEntries.get(id);
        return row ? { ...row, sync: { ...row.sync } } : undefined;
      },
      async toArray(): Promise<DiaryEntryRecord[]> {
        return Array.from(diaryEntries.values()).map((r) => ({ ...r, sync: { ...r.sync } }));
      },
    },
  };
}

function createService(db: DiaryDb, config: DiaryConfig = CONFIG) {
  return createDiaryService({
    db,
    config,
    now,
    newId: () => `diary-${++idCounter}`,
  });
}

let db: DiaryDb;

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  db = createMapDb();
});

describe('diaryService — alta de entradas', () => {
  it('addEntry crea un registro completo, lo persiste y audita', async () => {
    const svc = createService(db);
    const result = await svc.addEntry({
      date: TODAY,
      title: 'Mi día',
      content: '  Fue un buen día  ',
      mood: 4,
      participantId: 'p1',
      participantName: 'Ana',
    });

    expect(result.ok).toBe(true);
    expect(result.record).toMatchObject({
      id: 'diary-1',
      date: TODAY,
      title: 'Mi día',
      content: 'Fue un buen día',
      mood: 4,
      participantId: 'p1',
      participantName: 'Ana',
    });
    expect(result.record?.createdAt).toBe(NOW);
    expect(result.record?.updatedAt).toBe(NOW);
    expect(result.record?.sync).toEqual({ revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false });

    // Persistencia en la tabla.
    const rows = await db.diaryEntries.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(result.record);

    // Auditoría: un único log de alta.
    expect(addAuditLog).toHaveBeenCalledTimes(1);
    expect(addAuditLog).toHaveBeenCalledWith(
      'diary.add',
      'diaryEntries',
      'diary-1',
      null,
      expect.objectContaining({ date: TODAY, title: 'Mi día' }),
      'diaryService',
    );
  });

  it('addEntry permite título y ánimo opcionales', async () => {
    const svc = createService(db);
    const result = await svc.addEntry({ date: TODAY, content: 'Nota sin título' });

    expect(result.ok).toBe(true);
    expect(result.record?.title).toBeUndefined();
    expect(result.record?.mood).toBeUndefined();
    expect(result.record?.participantId).toBeUndefined();
    expect(result.record?.participantName).toBeUndefined();
  });

  it('addEntry rechaza entrada inválida sin auditar', async () => {
    const svc = createService(db);

    expect(await svc.addEntry({ date: '', content: 'x' })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await svc.addEntry({ date: '15/01/2026', content: 'x' })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await svc.addEntry({ date: TODAY, content: '' })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await svc.addEntry({ date: TODAY, content: '   ' })).toEqual({ ok: false, reason: 'invalid-input' });

    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it('addEntry respeta el tope diario (maxEntriesPerDay)', async () => {
    const svc = createService(db, { ...CONFIG, maxEntriesPerDay: 2 });

    await svc.addEntry({ date: TODAY, content: 'Uno' });
    await svc.addEntry({ date: TODAY, content: 'Dos' });
    const result = await svc.addEntry({ date: TODAY, content: 'Tres' });

    expect(result).toEqual({ ok: false, reason: 'limit-reached' });

    // Otro día no se ve afectado por el tope de hoy.
    const other = await svc.addEntry({ date: YESTERDAY, content: 'Ayer' });
    expect(other.ok).toBe(true);

    // 2 altas de hoy + 1 alta de ayer.
    expect(addAuditLog).toHaveBeenCalledTimes(3);
  });
});

describe('diaryService — listado y consultas', () => {
  it('listEntries ordena por fecha desc y devuelve copias', async () => {
    const seeded = createMapDb([
      makeEntry({ id: 'seed-1', date: TWO_DAYS_AGO, content: 'A1' }),
      makeEntry({ id: 'seed-2', date: YESTERDAY, content: 'A2' }),
      makeEntry({ id: 'seed-3', date: TODAY, content: 'A3' }),
    ]);
    const svc = createService(seeded);

    const rows = await svc.listEntries();
    expect(rows.map((r) => r.date)).toEqual([TODAY, YESTERDAY, TWO_DAYS_AGO]);

    // Copias: mutar el resultado no afecta el mapa interno.
    rows[0].content = 'Mutado';
    const again = await svc.listEntries();
    expect(again[0].content).toBe('A3');
  });

  it('listEntries ordena por createdAt desc dentro del mismo día', async () => {
    const seeded = createMapDb([
      makeEntry({ id: 'seed-1', date: TODAY, content: 'Antigua', createdAt: NOW - 1000, updatedAt: NOW - 1000 }),
      makeEntry({ id: 'seed-2', date: TODAY, content: 'Reciente', createdAt: NOW, updatedAt: NOW }),
    ]);
    const svc = createService(seeded);

    const rows = await svc.listEntries(TODAY);
    expect(rows.map((r) => r.id)).toEqual(['seed-2', 'seed-1']);
  });

  it('listEntries filtra por fecha', async () => {
    const seeded = createMapDb([
      makeEntry({ id: 'seed-1', date: TODAY, content: 'Hoy' }),
      makeEntry({ id: 'seed-2', date: YESTERDAY, content: 'Ayer' }),
    ]);
    const svc = createService(seeded);

    const today = await svc.listEntries(TODAY);
    expect(today.map((r) => r.id)).toEqual(['seed-1']);

    const all = await svc.listEntries();
    expect(all).toHaveLength(2);
  });

  it('getEntry devuelve una copia y undefined para ids inexistentes o vacíos', async () => {
    const seeded = createMapDb([
      makeEntry({ id: 'seed-1', content: 'Original' }),
    ]);
    const svc = createService(seeded);

    const row = await svc.getEntry('seed-1');
    expect(row?.content).toBe('Original');
    row!.content = 'Cambiada';
    const again = await svc.getEntry('seed-1');
    expect(again?.content).toBe('Original');

    expect(await svc.getEntry('no-existe')).toBeUndefined();
    expect(await svc.getEntry('')).toBeUndefined();
  });

  it('getHistory aplica el límite y ordena de más reciente a más antiguo', async () => {
    const seeded = createMapDb([
      makeEntry({ id: 'seed-1', date: TWO_DAYS_AGO, content: 'A1' }),
      makeEntry({ id: 'seed-2', date: YESTERDAY, content: 'A2' }),
      makeEntry({ id: 'seed-3', date: TODAY, content: 'A3' }),
    ]);
    const svc = createService(seeded);

    const all = await svc.getHistory();
    expect(all.map((r) => r.date)).toEqual([TODAY, YESTERDAY, TWO_DAYS_AGO]);

    const limited = await svc.getHistory(2);
    expect(limited.map((r) => r.date)).toEqual([TODAY, YESTERDAY]);

    // Límites negativos devuelven todo.
    const negative = await svc.getHistory(-1);
    expect(negative).toHaveLength(3);
  });
});

describe('diaryService — edición y borrado', () => {
  it('updateEntry cambia campos, audita update y sube la revisión', async () => {
    const seeded = createMapDb([
      makeEntry({ id: 'seed-1', date: TODAY, title: 'T1', content: 'C1', mood: 3 }),
    ]);
    const svc = createService(seeded);

    const result = await svc.updateEntry('seed-1', { title: 'T2', content: '  C2  ', mood: 5 });

    expect(result.ok).toBe(true);
    expect(result.record).toMatchObject({
      id: 'seed-1',
      date: TODAY,
      title: 'T2',
      content: 'C2',
      mood: 5,
    });
    expect(result.record?.sync.revision).toBe(2);

    // Auditoría: un único log de update con el estado previo.
    expect(addAuditLog).toHaveBeenCalledTimes(1);
    expect(addAuditLog).toHaveBeenCalledWith(
      'diary.update',
      'diaryEntries',
      'seed-1',
      { date: TODAY, content: 'C1' },
      expect.objectContaining({ date: TODAY, title: 'T2' }),
      'diaryService',
    );
  });

  it('updateEntry rechaza entradas inválidas o inexistentes sin auditar', async () => {
    const seeded = createMapDb([
      makeEntry({ id: 'seed-1', date: TODAY, content: 'C1' }),
    ]);
    const svc = createService(seeded);

    expect(await svc.updateEntry('', { content: 'x' })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await svc.updateEntry('seed-1', { date: '15/01/2026' })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await svc.updateEntry('seed-1', { content: '   ' })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await svc.updateEntry('no-existe', { content: 'x' })).toEqual({ ok: false, reason: 'diary-not-found' });

    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it('removeEntry borra, audita con el registro previo y devuelve ok', async () => {
    const seeded = createMapDb([
      makeEntry({ id: 'seed-1', date: TODAY, content: 'C1' }),
    ]);
    const svc = createService(seeded);

    const result = await svc.removeEntry('seed-1');
    expect(result).toEqual({ ok: true });
    expect(await seeded.diaryEntries.toArray()).toHaveLength(0);

    expect(addAuditLog).toHaveBeenCalledTimes(1);
    expect(addAuditLog).toHaveBeenCalledWith(
      'diary.remove',
      'diaryEntries',
      'seed-1',
      { date: TODAY, content: 'C1' },
      null,
      'diaryService',
    );
  });

  it('removeEntry de una entrada inexistente devuelve diary-not-found sin auditar', async () => {
    const svc = createService(db);

    expect(await svc.removeEntry('no-existe')).toEqual({ ok: false, reason: 'diary-not-found' });
    expect(await svc.removeEntry('')).toEqual({ ok: false, reason: 'invalid-input' });

    expect(addAuditLog).not.toHaveBeenCalled();
  });
});
