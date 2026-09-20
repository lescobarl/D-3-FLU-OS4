// ============================================================
// moodService — Bienestar/Ánimo (Fase 5, Módulo H)
// ------------------------------------------------------------
// Cubre el servicio de registro diario de ánimo con una base en
// memoria (misma interfaz MoodDb), reloj y newId inyectables.
// Regla #1: sin hardcode; escala y tope desde config. Cubre:
// alta, upsert del mismo día, listado, historial, resumen y
// borrado con auditoría.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAuditLog, type MoodRecord } from '../src/core/db/fluDatabase';
import {
  createMoodService,
  type MoodConfig,
  type MoodDb,
} from '../src/core/mood/moodService';

// IndexedDB no está disponible en vitest → se mockea el log de auditoría
// (fluDatabase no abre la conexión hasta la primera operación real).
vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
  return { ...actual, addAuditLog: vi.fn(async () => undefined as never) };
});

// Referencia de reloj fija: jueves 15 de enero de 2026, 10:00 local.
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const now = (): number => NOW;

const CONFIG: MoodConfig = {
  scaleMin: 1,
  scaleMax: 5,
  maxLogsPerParticipant: 365,
};

// 'YYYY-MM-DD' locales alrededor de la referencia (2026-01-15).
const YESTERDAY = '2026-01-14';
const TODAY = '2026-01-15';
const TWO_DAYS_AGO = '2026-01-13';

let idCounter = 0;

function makeMood(overrides: Partial<MoodRecord> = {}): MoodRecord {
  return {
    id: 'seed-mood',
    participantId: 'p1',
    participantName: 'Ana',
    date: TODAY,
    mood: 4,
    createdAt: NOW,
    updatedAt: NOW,
    sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
    ...overrides,
  };
}

function createMapDb(initialMoods: MoodRecord[] = []): MoodDb {
  const moodCheckIns = new Map<string, MoodRecord>();
  for (const r of initialMoods) moodCheckIns.set(r.id, { ...r, sync: { ...r.sync } });
  return {
    moodCheckIns: {
      async add(record: MoodRecord): Promise<unknown> {
        moodCheckIns.set(record.id, { ...record, sync: { ...record.sync } });
        return undefined;
      },
      async put(record: MoodRecord): Promise<unknown> {
        moodCheckIns.set(record.id, { ...record, sync: { ...record.sync } });
        return undefined;
      },
      async get(id: string): Promise<MoodRecord | undefined> {
        const row = moodCheckIns.get(id);
        return row ? { ...row, sync: { ...row.sync } } : undefined;
      },
      async toArray(): Promise<MoodRecord[]> {
        return Array.from(moodCheckIns.values()).map((r) => ({ ...r, sync: { ...r.sync } }));
      },
    },
  };
}

function createService(db: MoodDb, config: MoodConfig = CONFIG) {
  return createMoodService({
    db,
    config,
    now,
    newId: () => `mood-${++idCounter}`,
  });
}

let db: MoodDb;

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  db = createMapDb();
});

describe('moodService — alta de ánimo', () => {
  it('logMood crea un registro completo, lo persiste y audita', async () => {
    const svc = createService(db);
    const result = await svc.logMood({ participantId: 'p1', participantName: 'Ana', date: TODAY, mood: 4 });

    expect(result.ok).toBe(true);
    expect(result.updated).toBe(false);
    expect(result.record).toMatchObject({
      id: 'mood-1',
      participantId: 'p1',
      participantName: 'Ana',
      date: TODAY,
      mood: 4,
    });
    expect(result.record?.note).toBeUndefined();
    expect(result.record?.createdAt).toBe(NOW);
    expect(result.record?.updatedAt).toBe(NOW);
    expect(result.record?.sync).toEqual({ revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false });

    // Persistencia en la tabla.
    const rows = await db.moodCheckIns.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(result.record);

    // Auditoría: un único log de alta.
    expect(addAuditLog).toHaveBeenCalledTimes(1);
    expect(addAuditLog).toHaveBeenCalledWith(
      'mood.log.add',
      'moodCheckIns',
      'mood-1',
      null,
      expect.objectContaining({ participantId: 'p1', date: TODAY, mood: 4 }),
      'moodService',
    );
  });

  it('logMood registra la nota opcional', async () => {
    const svc = createService(db);
    const result = await svc.logMood({ participantId: 'p1', date: TODAY, mood: 2, note: 'Estuve cansado hoy' });

    expect(result.ok).toBe(true);
    expect(result.record?.note).toBe('Estuve cansado hoy');
  });

  it('logMood rechaza entrada inválida sin auditar', async () => {
    const svc = createService(db);

    expect(await svc.logMood({ participantId: '', date: TODAY, mood: 3 })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await svc.logMood({ participantId: 'p1', date: '15/01/2026', mood: 3 })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await svc.logMood({ participantId: 'p1', date: TODAY, mood: 0 })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await svc.logMood({ participantId: 'p1', date: TODAY, mood: 6 })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await svc.logMood({ participantId: 'p1', date: TODAY, mood: NaN })).toEqual({ ok: false, reason: 'invalid-input' });

    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it('logMood respeta el tope por participante (maxLogsPerParticipant)', async () => {
    const svc = createService(db, { ...CONFIG, maxLogsPerParticipant: 2 });

    await svc.logMood({ participantId: 'p1', date: TWO_DAYS_AGO, mood: 3 });
    await svc.logMood({ participantId: 'p1', date: YESTERDAY, mood: 4 });
    const result = await svc.logMood({ participantId: 'p1', date: TODAY, mood: 5 });

    expect(result).toEqual({ ok: false, reason: 'limit-reached' });

    // Otro participante no se ve afectado por el tope de p1.
    const other = await svc.logMood({ participantId: 'p2', date: TODAY, mood: 3 });
    expect(other.ok).toBe(true);

    // 2 altas de p1 + 1 alta de p2.
    expect(addAuditLog).toHaveBeenCalledTimes(3);
  });
});

describe('moodService — upsert del mismo día', () => {
  it('logMood actualiza el registro del mismo día, audita update y sube la revisión', async () => {
    const svc = createService(db);
    const first = await svc.logMood({ participantId: 'p1', date: TODAY, mood: 4 });
    expect(first.ok).toBe(true);

    const second = await svc.logMood({ participantId: 'p1', date: TODAY, mood: 2, note: 'Me siento peor' });

    expect(second.ok).toBe(true);
    expect(second.updated).toBe(true);
    expect(second.record?.id).toBe(first.record?.id); // No se duplica.
    expect(second.record?.mood).toBe(2);
    expect(second.record?.note).toBe('Me siento peor');
    expect(second.record?.createdAt).toBe(NOW);
    expect(second.record?.sync.revision).toBe(2);

    // Solo un registro en la tabla.
    const rows = await db.moodCheckIns.toArray();
    expect(rows).toHaveLength(1);

    // Auditoría: 1 alta + 1 actualización.
    expect(addAuditLog).toHaveBeenCalledTimes(2);
    expect(addAuditLog).toHaveBeenCalledWith(
      'mood.log.update',
      'moodCheckIns',
      first.record?.id,
      { mood: 4, note: undefined },
      expect.objectContaining({ participantId: 'p1', date: TODAY, mood: 2 }),
      'moodService',
    );
  });
});

describe('moodService — listado y consultas', () => {
  it('listMoods ordena de más reciente a más antiguo y devuelve copias', async () => {
    const seeded = createMapDb([
      makeMood({ id: 'seed-1', date: TWO_DAYS_AGO, mood: 3 }),
      makeMood({ id: 'seed-2', date: YESTERDAY, mood: 4 }),
    ]);
    const svc = createService(seeded);

    const rows = await svc.listMoods();
    expect(rows.map((r) => r.date)).toEqual([YESTERDAY, TWO_DAYS_AGO]);

    // Copias: mutar el resultado no afecta el mapa interno.
    rows[0].mood = 99;
    const again = await svc.listMoods();
    expect(again[0].mood).toBe(4);
  });

  it('listMoods filtra por participante', async () => {
    const seeded = createMapDb([
      makeMood({ id: 'seed-1', participantId: 'p1', date: TODAY, mood: 4 }),
      makeMood({ id: 'seed-2', participantId: 'p2', date: TODAY, mood: 3 }),
    ]);
    const svc = createService(seeded);

    const rows = await svc.listMoods('p1');
    expect(rows).toHaveLength(1);
    expect(rows[0].participantId).toBe('p1');

    const all = await svc.listMoods();
    expect(all).toHaveLength(2);
  });

  it('getMoodOn devuelve una copia y undefined para fechas inexistentes o inválidas', async () => {
    const seeded = createMapDb([
      makeMood({ id: 'seed-1', participantId: 'p1', date: TODAY, mood: 4 }),
    ]);
    const svc = createService(seeded);

    const row = await svc.getMoodOn('p1', TODAY);
    expect(row?.mood).toBe(4);
    row!.mood = 99;
    const again = await svc.getMoodOn('p1', TODAY);
    expect(again?.mood).toBe(4);

    expect(await svc.getMoodOn('p1', YESTERDAY)).toBeUndefined();
    expect(await svc.getMoodOn('p1', '')).toBeUndefined();
    expect(await svc.getMoodOn('', TODAY)).toBeUndefined();
    expect(await svc.getMoodOn('p1', '15/01/2026')).toBeUndefined();
  });
});

describe('moodService — historial y resumen', () => {
  it('getHistory aplica el límite y ordena de más reciente a más antiguo', async () => {
    const seeded = createMapDb([
      makeMood({ id: 'seed-1', date: TWO_DAYS_AGO, mood: 3 }),
      makeMood({ id: 'seed-2', date: YESTERDAY, mood: 4 }),
      makeMood({ id: 'seed-3', date: TODAY, mood: 5 }),
    ]);
    const svc = createService(seeded);

    const all = await svc.getHistory('p1');
    expect(all.map((r) => r.date)).toEqual([TODAY, YESTERDAY, TWO_DAYS_AGO]);

    const limited = await svc.getHistory('p1', 2);
    expect(limited.map((r) => r.date)).toEqual([TODAY, YESTERDAY]);
  });

  it('getSummary calcula total, promedio, mejor, peor, actual y conteos', async () => {
    const seeded = createMapDb([
      makeMood({ id: 'seed-1', participantId: 'p1', date: TWO_DAYS_AGO, mood: 3 }),
      makeMood({ id: 'seed-2', participantId: 'p1', date: YESTERDAY, mood: 4 }),
      makeMood({ id: 'seed-3', participantId: 'p1', date: TODAY, mood: 5 }),
      makeMood({ id: 'seed-4', participantId: 'p2', date: TODAY, mood: 2 }),
    ]);
    const svc = createService(seeded);

    const summary = await svc.getSummary('p1');
    expect(summary).toEqual({
      totalLogs: 3,
      averageMood: 4,
      bestMood: 5,
      worstMood: 3,
      currentMood: 5,
      currentDate: TODAY,
      moodCounts: { 3: 1, 4: 1, 5: 1 },
    });

    // Sin filtro cuenta a todos los participantes.
    const all = await svc.getSummary();
    expect(all.totalLogs).toBe(4);
  });

  it('getSummary devuelve un resumen vacío sin registros', async () => {
    const svc = createService(db);

    const summary = await svc.getSummary();
    expect(summary).toEqual({ totalLogs: 0, moodCounts: {} });
    expect(summary.averageMood).toBeUndefined();
    expect(summary.bestMood).toBeUndefined();
    expect(summary.worstMood).toBeUndefined();
    expect(summary.currentMood).toBeUndefined();
  });
});

describe('moodService — borrado', () => {
  it('removeMood borra, audita con el registro previo y devuelve ok', async () => {
    const seeded = createMapDb([
      makeMood({ id: 'seed-1', participantId: 'p1', date: TODAY, mood: 4 }),
    ]);
    const svc = createService(seeded);

    const result = await svc.removeMood('seed-1');
    expect(result).toEqual({ ok: true });
    const rows = await seeded.moodCheckIns.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].sync?.deleted).toBe(true);
    expect(await svc.listMoods()).toHaveLength(0);

    expect(addAuditLog).toHaveBeenCalledTimes(1);
    expect(addAuditLog).toHaveBeenCalledWith(
      'mood.log.remove',
      'moodCheckIns',
      'seed-1',
      { participantId: 'p1', date: TODAY, mood: 4 },
      { participantId: 'p1', date: TODAY, mood: 4 },
      'moodService',
    );
  });

  it('removeMood de un registro inexistente devuelve mood-not-found sin auditar', async () => {
    const svc = createService(db);

    expect(await svc.removeMood('no-existe')).toEqual({ ok: false, reason: 'mood-not-found' });
    expect(await svc.removeMood('')).toEqual({ ok: false, reason: 'invalid-input' });

    expect(addAuditLog).not.toHaveBeenCalled();
  });
});
