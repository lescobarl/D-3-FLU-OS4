// ============================================================
// materiaGrisService — gamificación de participación (F5)
// ------------------------------------------------------------
// Cubre el servicio de puntos "materia gris" con una base en
// memoria (misma interfaz MateriaGrisDb), reloj y newId
// inyectables. Regla #1: sin hardcode; tabla de acciones y tope
// desde config.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAuditLog, type MateriaGrisRecord } from '../src/core/db/fluDatabase';
import {
  createMateriaGrisService,
  type MateriaGrisConfig,
  type MateriaGrisDb,
} from '../src/core/multiuser/materiaGrisService';

// IndexedDB no está disponible en vitest → se mockea el log de auditoría
// (fluDatabase no abre la conexión hasta la primera operación real).
vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
  return { ...actual, addAuditLog: vi.fn(async () => undefined as never) };
});

// Referencia de reloj fija: jueves 15 de enero de 2026, 10:00 local.
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const now = (): number => NOW;

const CONFIG: MateriaGrisConfig = {
  actions: {
    participacion_conversacion: 3,
    recordatorio_completado: 5,
    tarea_hogar: 5,
    juego_completado: 8,
    cuento: 10,
  },
  maxEntriesPerParticipant: 200,
};

let idCounter = 0;

function createMapDb(initial: MateriaGrisRecord[] = []): MateriaGrisDb {
  const map = new Map<string, MateriaGrisRecord>();
  for (const r of initial) map.set(r.id, { ...r, sync: { ...r.sync } });
  return {
    async add(record: MateriaGrisRecord): Promise<unknown> {
      map.set(record.id, { ...record, sync: { ...record.sync } });
      return undefined;
    },
    async put(record: MateriaGrisRecord): Promise<unknown> {
      map.set(record.id, { ...record, sync: { ...record.sync } });
      return undefined;
    },
    async delete(id: string): Promise<void> {
      map.delete(id);
    },
    async get(id: string): Promise<MateriaGrisRecord | undefined> {
      const row = map.get(id);
      return row ? { ...row, sync: { ...row.sync } } : undefined;
    },
    async toArray(): Promise<MateriaGrisRecord[]> {
      return Array.from(map.values()).map((r) => ({ ...r, sync: { ...r.sync } }));
    },
  };
}

function createService(db: MateriaGrisDb, config: MateriaGrisConfig = CONFIG) {
  return createMateriaGrisService({
    db,
    config,
    now,
    newId: () => `mg-${++idCounter}`,
  });
}

let db: MateriaGrisDb;

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  db = createMapDb();
});

describe('materiaGrisService — otorgar puntos', () => {
  it('awardPoints crea un registro completo, lo persiste y audita', async () => {
    const service = createService(db);
    const result = await service.awardPoints({
      participantId: 'p1',
      participantName: 'Luis',
      action: 'recordatorio_completado',
    });
    expect(result.ok).toBe(true);
    const record = result.record!;
    expect(record.id).toBe('mg-1');
    expect(record.participantId).toBe('p1');
    expect(record.participantName).toBe('Luis');
    expect(record.action).toBe('recordatorio_completado');
    expect(record.points).toBe(5);
    expect(record.createdAt).toBe(NOW);
    expect(record.updatedAt).toBe(NOW);
    expect(record.sync).toEqual({
      revision: 1,
      updated_at: new Date(NOW).toISOString(),
      deleted: false,
    });
    expect(await db.get('mg-1')).toBeDefined();
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'materiagris.award', 'materiaGris', 'mg-1', null,
      { participantId: 'p1', action: 'recordatorio_completado', points: 5 },
      'materiaGrisService',
    );
  });

  it('awardPoints respeta puntos explícitos', async () => {
    const service = createService(db);
    const result = await service.awardPoints({ participantId: 'p1', action: 'cuento', points: 25 });
    expect(result.ok).toBe(true);
    expect(result.record?.points).toBe(25);
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'materiagris.award', 'materiaGris', 'mg-1', null,
      { participantId: 'p1', action: 'cuento', points: 25 },
      'materiaGrisService',
    );
  });

  it('awardPoints rechaza entrada inválida sin auditar', async () => {
    const service = createService(db);
    expect(await service.awardPoints({} as never)).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await service.awardPoints({ participantId: 'p1' } as never)).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await service.awardPoints({ action: 'cuento' } as never)).toEqual({ ok: false, reason: 'invalid-input' });
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
  });

  it('awardPoints rechaza acciones o puntos inválidos como unknown-action', async () => {
    const service = createService(db);
    expect(await service.awardPoints({ participantId: 'p1', action: 'no_existe' })).toEqual({ ok: false, reason: 'unknown-action' });
    expect(await service.awardPoints({ participantId: 'p1', action: 'cuento', points: 0 })).toEqual({ ok: false, reason: 'unknown-action' });
    expect(await service.awardPoints({ participantId: 'p1', action: 'cuento', points: -3 })).toEqual({ ok: false, reason: 'unknown-action' });
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
  });

  it('awardPoints respeta el tope por participante', async () => {
    const limited = createService(db, { actions: CONFIG.actions, maxEntriesPerParticipant: 2 });
    expect((await limited.awardPoints({ participantId: 'p1', action: 'cuento' })).ok).toBe(true);
    expect((await limited.awardPoints({ participantId: 'p1', action: 'cuento' })).ok).toBe(true);
    expect(await limited.awardPoints({ participantId: 'p1', action: 'cuento' })).toEqual({ ok: false, reason: 'limit-reached' });
    expect((await limited.awardPoints({ participantId: 'p2', action: 'cuento' })).ok).toBe(true);
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledTimes(3);
  });
});

describe('materiaGrisService — clasificación y consultas', () => {
  it('getLeaderboard agrega por participante y ordena por puntos', async () => {
    const service = createService(db);
    // p1 (Luis): cuento 10 + tarea_hogar 5 = 15
    await service.awardPoints({ participantId: 'p1', participantName: 'Luis', action: 'cuento' });
    await service.awardPoints({ participantId: 'p1', participantName: 'Luis', action: 'tarea_hogar' });
    // p2 (Zoe): cuento 10 + juego_completado 8 = 18
    await service.awardPoints({ participantId: 'p2', participantName: 'Zoe', action: 'cuento' });
    await service.awardPoints({ participantId: 'p2', participantName: 'Zoe', action: 'juego_completado' });
    // p3 (Ana): 3 + 3 = 6
    await service.awardPoints({ participantId: 'p3', participantName: 'Ana', action: 'participacion_conversacion' });
    await service.awardPoints({ participantId: 'p3', participantName: 'Ana', action: 'participacion_conversacion' });

    const board = await service.getLeaderboard();
    expect(board.map((r) => r.participantName)).toEqual(['Zoe', 'Luis', 'Ana']);
    expect(board[0]).toMatchObject({ participantId: 'p2', points: 18, actions: 2 });
    expect(board[1]).toMatchObject({ participantId: 'p1', points: 15, actions: 2 });
    expect(board[2]).toMatchObject({ participantId: 'p3', points: 6, actions: 2 });
  });

  it('getLeaderboard desempata por nombre con locale es', async () => {
    const service = createService(db);
    await service.awardPoints({ participantId: 'p1', participantName: 'Carlos', action: 'cuento' });
    await service.awardPoints({ participantId: 'p2', participantName: 'Beatriz', action: 'cuento' });
    const board = await service.getLeaderboard();
    expect(board.map((r) => r.participantName)).toEqual(['Beatriz', 'Carlos']);
  });

  it('getTotalFor suma los puntos por participante', async () => {
    const service = createService(db);
    await service.awardPoints({ participantId: 'p1', action: 'cuento' });
    await service.awardPoints({ participantId: 'p1', action: 'participacion_conversacion' });
    await service.awardPoints({ participantId: 'p2', action: 'cuento' });
    expect(await service.getTotalFor('p1')).toBe(13);
    expect(await service.getTotalFor('p2')).toBe(10);
    expect(await service.getTotalFor('')).toBe(0);
    expect(await service.getTotalFor('nadie')).toBe(0);
  });

  it('getHistory ordena de más reciente a más antiguo y devuelve copias', async () => {
    const base: MateriaGrisRecord = {
      id: 'x',
      participantId: 'p1',
      participantName: 'Luis',
      action: 'cuento',
      points: 10,
      createdAt: 0,
      updatedAt: 0,
      sync: { revision: 1, updated_at: '', deleted: false },
    };
    const seeded = createMapDb([
      { ...base, id: 'h1', participantId: 'p1', createdAt: 100, updatedAt: 100 },
      { ...base, id: 'h2', participantId: 'p2', participantName: 'Zoe', action: 'juego_completado', points: 8, createdAt: 200, updatedAt: 200 },
      { ...base, id: 'h3', participantId: 'p1', action: 'tarea_hogar', points: 5, createdAt: 300, updatedAt: 300 },
    ]);
    const service = createService(seeded);

    const all = await service.getHistory();
    expect(all.map((r) => r.id)).toEqual(['h3', 'h2', 'h1']);

    const p1 = await service.getHistory('p1');
    expect(p1.map((r) => r.id)).toEqual(['h3', 'h1']);

    // Las copias devueltas no mutan la base.
    p1[0].points = 999;
    const again = await service.getHistory('p1');
    expect(again[0].points).toBe(5);
  });
});
