// ============================================================
// habitService — Hábitos y Metas (Fase 4, Módulo G)
// ------------------------------------------------------------
// Cubre el servicio de metas/hábitos con una base en memoria
// (misma interfaz HabitsDb), reloj y newId inyectables.
// Regla #1: sin hardcode; categorías, días objetivo y tope desde
// config. Cubre: alta, check-in diario, rachas, progreso,
// estado y borrado con auditoría.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAuditLog, type GoalCheckInRecord, type GoalRecord } from '../src/core/db/fluDatabase';
import {
  createHabitsService,
  type HabitsConfig,
  type HabitsDb,
} from '../src/core/habits/habitService';

// IndexedDB no está disponible en vitest → se mockea el log de auditoría
// (fluDatabase no abre la conexión hasta la primera operación real).
vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
  return { ...actual, addAuditLog: vi.fn(async () => undefined as never) };
});

// Referencia de reloj fija: jueves 15 de enero de 2026, 10:00 local.
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const now = (): number => NOW;

const CONFIG: HabitsConfig = {
  categories: ['habito', 'meta', 'estudio', 'personal'],
  defaultTargetDays: 21,
  maxGoalsPerParticipant: 50,
};

// 'YYYY-MM-DD' locales alrededor de la referencia (2026-01-15).
const YESTERDAY = '2026-01-14';
const TODAY = '2026-01-15';
const TWO_DAYS_AGO = '2026-01-13';

let idCounter = 0;

function createMapDb(initialGoals: GoalRecord[] = [], initialCheckIns: GoalCheckInRecord[] = []): HabitsDb {
  const goals = new Map<string, GoalRecord>();
  const checkIns = new Map<string, GoalCheckInRecord>();
  for (const r of initialGoals) goals.set(r.id, { ...r, sync: { ...r.sync } });
  for (const r of initialCheckIns) checkIns.set(r.id, { ...r, sync: { ...r.sync } });
  return {
    goals: {
      async add(record: GoalRecord): Promise<unknown> {
        goals.set(record.id, { ...record, sync: { ...record.sync } });
        return undefined;
      },
      async put(record: GoalRecord): Promise<unknown> {
        goals.set(record.id, { ...record, sync: { ...record.sync } });
        return undefined;
      },
      async delete(id: string): Promise<void> {
        goals.delete(id);
      },
      async get(id: string): Promise<GoalRecord | undefined> {
        const row = goals.get(id);
        return row ? { ...row, sync: { ...row.sync } } : undefined;
      },
      async toArray(): Promise<GoalRecord[]> {
        return Array.from(goals.values()).map((r) => ({ ...r, sync: { ...r.sync } }));
      },
    },
    checkIns: {
      async add(record: GoalCheckInRecord): Promise<unknown> {
        checkIns.set(record.id, { ...record, sync: { ...record.sync } });
        return undefined;
      },
      async put(record: GoalCheckInRecord): Promise<unknown> {
        checkIns.set(record.id, { ...record, sync: { ...record.sync } });
        return undefined;
      },
      async delete(id: string): Promise<void> {
        checkIns.delete(id);
      },
      async get(id: string): Promise<GoalCheckInRecord | undefined> {
        const row = checkIns.get(id);
        return row ? { ...row, sync: { ...row.sync } } : undefined;
      },
      async toArray(): Promise<GoalCheckInRecord[]> {
        return Array.from(checkIns.values()).map((r) => ({ ...r, sync: { ...r.sync } }));
      },
    },
  };
}

function createService(db: HabitsDb, config: HabitsConfig = CONFIG) {
  return createHabitsService({
    db,
    config,
    now,
    newId: () => `hab-${++idCounter}`,
  });
}

let db: HabitsDb;

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  db = createMapDb();
});

describe('habitService — alta de metas', () => {
  it('addGoal crea un registro completo, lo persiste y audita', async () => {
    const service = createService(db);
    const result = await service.addGoal({
      participantId: 'p1',
      participantName: 'Luis',
      title: 'Leer 15 minutos',
      category: 'habito',
    });
    expect(result.ok).toBe(true);
    const record = result.record!;
    expect(record.id).toBe('hab-1');
    expect(record.participantId).toBe('p1');
    expect(record.participantName).toBe('Luis');
    expect(record.title).toBe('Leer 15 minutos');
    expect(record.category).toBe('habito');
    expect(record.status).toBe('active');
    // Días objetivo por defecto desde config (sin hardcode).
    expect(record.targetDays).toBe(21);
    expect(record.createdAt).toBe(NOW);
    expect(record.updatedAt).toBe(NOW);
    expect(record.sync).toEqual({
      revision: 1,
      updated_at: new Date(NOW).toISOString(),
      deleted: false,
    });
    expect(await db.goals.get('hab-1')).toBeDefined();
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'habits.goal.add', 'goals', 'hab-1', null,
      { participantId: 'p1', title: 'Leer 15 minutos', category: 'habito' },
      'habitService',
    );
  });

  it('addGoal respeta targetDays explícitos', async () => {
    const service = createService(db);
    const result = await service.addGoal({
      participantId: 'p1',
      title: 'Correr 5 km',
      category: 'meta',
      targetDays: 30,
      unit: 'sesiones',
    });
    expect(result.ok).toBe(true);
    expect(result.record?.targetDays).toBe(30);
    expect(result.record?.unit).toBe('sesiones');
  });

  it('addGoal rechaza entrada inválida sin auditar', async () => {
    const service = createService(db);
    expect(await service.addGoal({} as never)).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await service.addGoal({ participantId: 'p1', title: '', category: 'habito' })).toEqual({
      ok: false,
      reason: 'invalid-input',
    });
    expect(await service.addGoal({ participantId: 'p1', title: 'X', category: 'no_existe' })).toEqual({
      ok: false,
      reason: 'invalid-input',
    });
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
  });

  it('addGoal respeta el tope por participante', async () => {
    const limited = createService(db, {
      categories: CONFIG.categories,
      defaultTargetDays: 21,
      maxGoalsPerParticipant: 2,
    });
    expect((await limited.addGoal({ participantId: 'p1', title: 'A', category: 'habito' })).ok).toBe(true);
    expect((await limited.addGoal({ participantId: 'p1', title: 'B', category: 'habito' })).ok).toBe(true);
    expect(await limited.addGoal({ participantId: 'p1', title: 'C', category: 'habito' })).toEqual({
      ok: false,
      reason: 'limit-reached',
    });
    expect((await limited.addGoal({ participantId: 'p2', title: 'D', category: 'habito' })).ok).toBe(true);
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledTimes(3);
  });
});

describe('habitService — listado y consultas', () => {
  it('listGoals ordena activas primero y luego por createdAt desc', async () => {
    // Reloj fijo → todos los addGoal comparten createdAt; se siembran timestamps
    // distintos y un estado 'done' para ejercitar el orden real del servicio.
    const seedDb = createMapDb([
      {
        id: 'hab-1', participantId: 'p1', title: 'Meta vieja', category: 'meta',
        status: 'active', createdAt: NOW - 2000, updatedAt: NOW - 2000,
        sync: { revision: 1, updated_at: new Date(NOW - 2000).toISOString(), deleted: false },
      },
      {
        id: 'hab-2', participantId: 'p1', title: 'Hábito nuevo', category: 'habito',
        status: 'active', createdAt: NOW, updatedAt: NOW,
        sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
      },
      {
        id: 'hab-3', participantId: 'p1', title: 'Meta hecha', category: 'meta',
        status: 'done', createdAt: NOW, updatedAt: NOW,
        sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
      },
    ]);
    const service = createService(seedDb);
    const rows = await service.listGoals();
    // Primero las activas (más reciente primero), después las no activas.
    expect(rows.map((r) => r.title)).toEqual(['Hábito nuevo', 'Meta vieja', 'Meta hecha']);
  });

  it('listGoals filtra por participante y devuelve copias', async () => {
    const service = createService(db);
    await service.addGoal({ participantId: 'p1', title: 'Meta p1', category: 'meta' });
    await service.addGoal({ participantId: 'p2', title: 'Meta p2', category: 'meta' });
    const p1 = await service.listGoals('p1');
    expect(p1.map((r) => r.title)).toEqual(['Meta p1']);
    // Las copias devueltas no mutan la base.
    p1[0].title = 'MUTADO';
    const again = await service.listGoals('p1');
    expect(again[0].title).toBe('Meta p1');
  });

  it('getGoal devuelve una copia y undefined para ids inexistentes o vacíos', async () => {
    const service = createService(db);
    const added = await service.addGoal({ participantId: 'p1', title: 'Meta', category: 'meta' });
    const got = await service.getGoal(added.record!.id);
    expect(got?.title).toBe('Meta');
    got!.title = 'MUTADO';
    expect((await service.getGoal(added.record!.id))?.title).toBe('Meta');
    expect(await service.getGoal('nope')).toBeUndefined();
    expect(await service.getGoal('')).toBeUndefined();
  });
});

describe('habitService — check-in diario y rachas', () => {
  it('checkIn crea un registro, lo persiste y audita', async () => {
    const service = createService(db);
    const added = await service.addGoal({ participantId: 'p1', title: 'Leer', category: 'habito' });
    const goalId = added.record!.id;

    const result = await service.checkIn({ goalId, date: TODAY, done: true });
    expect(result.ok).toBe(true);
    const record = result.record!;
    expect(record.id).toBe('hab-2');
    expect(record.goalId).toBe(goalId);
    expect(record.participantId).toBe('p1');
    expect(record.date).toBe(TODAY);
    expect(record.done).toBe(true);
    expect(record.sync.revision).toBe(1);
    expect(result.streak).toBe(1);
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'habits.checkin.add', 'goalCheckIns', 'hab-2', null,
      { goalId, date: TODAY, done: true },
      'habitService',
    );
  });

  it('checkIn hace upsert por meta y día, sube la revisión y audita update', async () => {
    const service = createService(db);
    const added = await service.addGoal({ participantId: 'p1', title: 'Leer', category: 'habito' });
    const goalId = added.record!.id;

    await service.checkIn({ goalId, date: TODAY, done: true, note: 'primera vez' });
    const updated = await service.checkIn({ goalId, date: TODAY, done: true, note: 'editado' });

    expect(updated.ok).toBe(true);
    expect(updated.record?.note).toBe('editado');
    expect(updated.record?.sync.revision).toBe(2);
    // Un solo registro por meta+día.
    const all = await db.checkIns.toArray();
    expect(all.length).toBe(1);
    // 1 alta de meta + 1 check-in nuevo + 1 update del mismo check-in.
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(addAuditLog)).toHaveBeenLastCalledWith(
      'habits.checkin.update', 'goalCheckIns', 'hab-2',
      { done: true, note: 'primera vez' },
      { done: true, note: 'editado' },
      'habitService',
    );
  });

  it('checkIn rechaza entrada inválida o meta inexistente sin auditar', async () => {
    const service = createService(db);
    expect(await service.checkIn({ goalId: 'x', date: 'no-es-fecha', done: true })).toEqual({
      ok: false,
      reason: 'invalid-input',
    });
    expect(await service.checkIn({ goalId: '', date: TODAY, done: true })).toEqual({
      ok: false,
      reason: 'invalid-input',
    });
    expect(await service.checkIn({ goalId: 'nope', date: TODAY, done: true })).toEqual({
      ok: false,
      reason: 'goal-not-found',
    });
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
  });

  it('getStreak cuenta días consecutivos completados hasta hoy o ayer', async () => {
    const service = createService(db);
    const added = await service.addGoal({ participantId: 'p1', title: 'Leer', category: 'habito' });
    const goalId = added.record!.id;

    // Sin check-ins → 0.
    expect(await service.getStreak(goalId)).toBe(0);

    // Ayer completado → racha 1 (hoy aún sin marcar).
    await service.checkIn({ goalId, date: YESTERDAY, done: true });
    expect(await service.getStreak(goalId)).toBe(1);

    // Hoy completado → racha 2.
    await service.checkIn({ goalId, date: TODAY, done: true });
    expect(await service.getStreak(goalId)).toBe(2);

    // Hueco real: meta nueva con check-in solo en anteayer (hoy y ayer pendientes) → 0.
    const gapGoal = await service.addGoal({ participantId: 'p1', title: 'Rutina', category: 'habito' });
    const gapGoalId = gapGoal.record!.id;
    await service.checkIn({ goalId: gapGoalId, date: TWO_DAYS_AGO, done: true });
    expect(await service.getStreak(gapGoalId)).toBe(0);
  });

  it('getStreak devuelve 0 si el check-in de hoy está marcado como no completado', async () => {
    const service = createService(db);
    const added = await service.addGoal({ participantId: 'p1', title: 'Leer', category: 'habito' });
    const goalId = added.record!.id;

    await service.checkIn({ goalId, date: YESTERDAY, done: true });
    await service.checkIn({ goalId, date: TODAY, done: false });
    expect(await service.getStreak(goalId)).toBe(0);

    // Sin objetivo ni ids vacíos → 0.
    expect(await service.getStreak('')).toBe(0);
    expect(await service.getStreak('nope')).toBe(0);
  });
});

describe('habitService — estadísticas', () => {
  it('getStats calcula días completados, racha y progreso respecto a targetDays', async () => {
    const service = createService(db);
    const added = await service.addGoal({
      participantId: 'p1',
      title: 'Meditar',
      category: 'habito',
      targetDays: 4,
    });
    const goalId = added.record!.id;

    // 3 de 4 días: 13, 14 y 15 (hoy) → completados 3, racha 3, progreso 0.75.
    await service.checkIn({ goalId, date: TWO_DAYS_AGO, done: true });
    await service.checkIn({ goalId, date: YESTERDAY, done: true });
    await service.checkIn({ goalId, date: TODAY, done: true });

    const stats = await service.getStats('p1');
    expect(stats).toHaveLength(1);
    expect(stats[0].completedDays).toBe(3);
    expect(stats[0].streak).toBe(3);
    expect(stats[0].progress).toBeCloseTo(0.75);
    expect(stats[0].todayCheckIn?.done).toBe(true);

    // Sin targetDays → progreso undefined. addGoal siempre aplica
    // defaultTargetDays, así que se siembra la meta directamente sin targetDays.
    const noTargetId = 'hab-10';
    await db.goals.add({
      id: noTargetId, participantId: 'p1', title: 'Meta abierta', category: 'meta',
      status: 'active', createdAt: NOW, updatedAt: NOW,
      sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
    });
    await service.checkIn({ goalId: noTargetId, date: TODAY, done: true });
    const statsNoTarget = await service.getStats('p1');
    const open = statsNoTarget.find((s) => s.goal.id === noTargetId)!;
    expect(open.completedDays).toBe(1);
    expect(open.progress).toBeUndefined();
  });

  it('getStats clampa el progreso a 1 y respeta la referencia de reloj', async () => {
    const service = createService(db);
    const added = await service.addGoal({
      participantId: 'p1',
      title: 'Meta corta',
      category: 'meta',
      targetDays: 2,
    });
    const goalId = added.record!.id;
    await service.checkIn({ goalId, date: TWO_DAYS_AGO, done: true });
    await service.checkIn({ goalId, date: YESTERDAY, done: true });
    await service.checkIn({ goalId, date: TODAY, done: true });

    const stats = await service.getStats('p1', NOW);
    expect(stats[0].progress).toBe(1);
    expect(stats[0].completedDays).toBe(3);
  });
});

describe('habitService — estado y borrado', () => {
  it('updateStatus cambia el estado, audita y sube la revisión de sync', async () => {
    const service = createService(db);
    const added = await service.addGoal({ participantId: 'p1', title: 'Leer', category: 'habito' });
    const goalId = added.record!.id;

    const result = await service.updateStatus(goalId, 'done');
    expect(result.ok).toBe(true);
    expect(result.record?.status).toBe('done');
    expect(result.record?.sync.revision).toBe(2);
    expect(vi.mocked(addAuditLog)).toHaveBeenLastCalledWith(
      'habits.goal.status', 'goals', goalId,
      { status: 'active' },
      { status: 'done' },
      'habitService',
    );

    // Mismo estado → ok sin volver a auditar.
    await service.updateStatus(goalId, 'done');
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledTimes(2);
  });

  it('updateStatus rechaza estados inválidos o metas inexistentes', async () => {
    const service = createService(db);
    expect(await service.updateStatus('x', 'raro' as never)).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await service.updateStatus('', 'done')).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await service.updateStatus('nope', 'done')).toEqual({ ok: false, reason: 'goal-not-found' });
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
  });

  it('removeGoal borra la meta y sus check-ins, auditando cada borrado', async () => {
    const service = createService(db);
    const added = await service.addGoal({ participantId: 'p1', title: 'Leer', category: 'habito' });
    const goalId = added.record!.id;
    await service.checkIn({ goalId, date: YESTERDAY, done: true });
    await service.checkIn({ goalId, date: TODAY, done: true });

    expect(await service.removeGoal(goalId)).toEqual({ ok: true });
    expect(await db.goals.get(goalId)).toBeUndefined();
    expect(await db.checkIns.toArray()).toHaveLength(0);
    // 1 alta + 2 check-ins + 2 borrados de check-in + 1 borrado de meta.
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledTimes(6);
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'habits.checkin.remove', 'goalCheckIns', 'hab-2',
      { goalId, date: YESTERDAY },
      null,
      'habitService',
    );
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'habits.goal.remove', 'goals', goalId,
      { participantId: 'p1', title: 'Leer' },
      null,
      'habitService',
    );
  });

  it('removeGoal de una meta inexistente devuelve goal-not-found sin auditar', async () => {
    const service = createService(db);
    expect(await service.removeGoal('nope')).toEqual({ ok: false, reason: 'goal-not-found' });
    expect(await service.removeGoal('')).toEqual({ ok: false, reason: 'invalid-input' });
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
  });
});
