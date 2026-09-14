// ============================================================
// Materia Gris Service — Gamificación (F5)
// ------------------------------------------------------------
// Puntos de "materia gris" por participante con:
//   - Obligación #6: UUIDv4 (id)
//   - Obligación #7: tupla Sync [revision, updated_at, deleted]
//   - Obligación #5: log de auditoría en cada mutación
//   - Regla #1: sin hardcode; tabla de acciones desde config
// Inyección de dependencias: { db, config, now, newId }.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { addAuditLog, type MateriaGrisRecord } from '../db/fluDatabase';
import { buildSyncTuple } from '../db/syncTuple';
import { copyRecord } from '../db/recordCopy';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

// El tipo de registro proviene de la capa de base de datos
// (fuente única de verdad — Regla de oro) y se re-exporta aquí.
export type { MateriaGrisRecord } from '../db/fluDatabase';

export interface MateriaGrisConfig {
  /** Tabla de acciones → puntos ('recordatorio_completado': 5, ...). */
  actions: Record<string, number>;
  /** Tope de registros históricos por participante (opcional). */
  maxEntriesPerParticipant?: number;
}

export interface MateriaGrisDb {
  add(record: MateriaGrisRecord): Promise<unknown>;
  put(record: MateriaGrisRecord): Promise<unknown>;
  delete(id: string): Promise<void>;
  get(id: string): Promise<MateriaGrisRecord | undefined>;
  toArray(): Promise<MateriaGrisRecord[]>;
}

export interface MateriaGrisServiceOptions {
  db: MateriaGrisDb;
  config: MateriaGrisConfig;
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
  /** Generador de id (por defecto: uuid v4). */
  newId?: () => string;
}

export interface AwardInput {
  participantId: string;
  participantName?: string;
  /** Acción de la tabla config (p.ej. 'recordatorio_completado'). */
  action: string;
  /** Puntos explícitos (opcional; por defecto usa config.actions[action]). */
  points?: number;
}

export interface AwardResult {
  ok: boolean;
  record?: MateriaGrisRecord;
  reason?: 'invalid-input' | 'unknown-action' | 'limit-reached';
}

export interface LeaderboardRow {
  participantId: string;
  participantName?: string;
  points: number;
  actions: number;
}

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export function createMateriaGrisService({
  db,
  config,
  now = () => Date.now(),
  newId = uuidv4,
}: MateriaGrisServiceOptions) {
  const timestamp = (): number => now();

  const awardPoints = async (input: AwardInput): Promise<AwardResult> => {
    if (!input || !input.participantId || !input.action) {
      return { ok: false, reason: 'invalid-input' };
    }
    const configured = config.actions[input.action];
    const points = input.points ?? configured;
    if (typeof points !== 'number' || Number.isNaN(points) || points <= 0) {
      return { ok: false, reason: 'unknown-action' };
    }
    if (config.maxEntriesPerParticipant !== undefined) {
      const all = await db.toArray();
      const count = all.filter((r) => r.participantId === input.participantId).length;
      if (count >= config.maxEntriesPerParticipant) {
        return { ok: false, reason: 'limit-reached' };
      }
    }
    const id = newId();
    const t = timestamp();
    const record: MateriaGrisRecord = {
      id,
      participantId: input.participantId,
      participantName: input.participantName,
      action: input.action,
      points,
      createdAt: t,
      updatedAt: t,
      sync: buildSyncTuple(undefined, timestamp()),
    };
    await db.add(record);
    await addAuditLog(
      'materiagris.award',
      'materiaGris',
      id,
      null,
      { participantId: record.participantId, action: record.action, points: record.points },
      'materiaGrisService',
    );
    return { ok: true, record };
  };

  const getLeaderboard = async (): Promise<LeaderboardRow[]> => {
    const all = await db.toArray();
    const map = new Map<string, LeaderboardRow>();
    for (const row of all) {
      const existing = map.get(row.participantId);
      if (existing) {
        existing.points += row.points;
        existing.actions += 1;
        if (row.participantName) existing.participantName = row.participantName;
      } else {
        map.set(row.participantId, {
          participantId: row.participantId,
          participantName: row.participantName,
          points: row.points,
          actions: 1,
        });
      }
    }
    return [...map.values()].sort(
      (a, b) =>
        b.points - a.points ||
        (a.participantName ?? '').localeCompare(b.participantName ?? '', 'es'),
    );
  };

  const getTotalFor = async (participantId: string): Promise<number> => {
    if (!participantId) return 0;
    const all = await db.toArray();
    return all
      .filter((r) => r.participantId === participantId)
      .reduce((sum, r) => sum + r.points, 0);
  };

  const getHistory = async (participantId?: string): Promise<MateriaGrisRecord[]> => {
    const all = await db.toArray();
    const filtered = participantId
      ? all.filter((r) => r.participantId === participantId)
      : all;
    return filtered
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(copyRecord);
  };

  return {
    awardPoints,
    getLeaderboard,
    getTotalFor,
    getHistory,
  };
}

export type MateriaGrisService = ReturnType<typeof createMateriaGrisService>;
