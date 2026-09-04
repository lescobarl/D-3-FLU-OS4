// ============================================================
// Mood Service — Bienestar/Ánimo (Fase 5, Módulo H)
// ------------------------------------------------------------
// Registro diario de ánimo por participante con:
//   - escala de ánimo configurable (scaleMin..scaleMax, por defecto 1..5)
//   - nota opcional por registro
//   - un único registro por participante y día (upsert si se repite)
//   - historial y resumen (promedio, mejor, peor, actual y conteos)
// Cumple:
//   - Obligación #6: UUIDv4 (id)
//   - Obligación #7: tupla Sync [revision, updated_at, deleted]
//   - Obligación #5: log de auditoría en cada mutación
//   - Regla #1: sin hardcode; escala y límites desde config
// Inyección de dependencias: { db, config, now, newId }.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { addAuditLog, type MoodRecord, type SyncTuple } from '../db/fluDatabase';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

// Los tipos de registro provienen de la capa de base de datos
// (fuente única de verdad — Regla de oro) y se re-exportan aquí.
export type { MoodRecord } from '../db/fluDatabase';

export interface MoodConfig {
  /** Extremo inferior de la escala de ánimo (por defecto 1). */
  scaleMin?: number;
  /** Extremo superior de la escala de ánimo (por defecto 5). */
  scaleMax?: number;
  /** Tope de registros por participante (opcional). */
  maxLogsPerParticipant?: number;
}

export interface MoodTableDb {
  add(record: MoodRecord): Promise<unknown>;
  put(record: MoodRecord): Promise<unknown>;
  delete(id: string): Promise<void>;
  get(id: string): Promise<MoodRecord | undefined>;
  toArray(): Promise<MoodRecord[]>;
}

export interface MoodDb {
  moodCheckIns: MoodTableDb;
}

export interface MoodServiceOptions {
  db: MoodDb;
  config: MoodConfig;
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
  /** Generador de id (por defecto: uuid v4). */
  newId?: () => string;
}

export interface LogMoodInput {
  participantId: string;
  participantName?: string;
  /** Clave de día local 'YYYY-MM-DD'. */
  date: string;
  /** Ánimo dentro de la escala scaleMin..scaleMax. */
  mood: number;
  note?: string;
}

export interface LogMoodResult {
  ok: boolean;
  record?: MoodRecord;
  /** true si actualizó un registro previo del mismo día; false si creó uno nuevo. */
  updated?: boolean;
  reason?: 'invalid-input' | 'limit-reached';
}

export interface MoodSummary {
  totalLogs: number;
  /** Promedio redondeado a 1 decimal (undefined si no hay registros). */
  averageMood?: number;
  /** Mejor ánimo registrado (undefined si no hay registros). */
  bestMood?: number;
  /** Peor ánimo registrado (undefined si no hay registros). */
  worstMood?: number;
  /** Ánimo más reciente (undefined si no hay registros). */
  currentMood?: number;
  /** Clave de día del registro más reciente. */
  currentDate?: string;
  /** Conteo de registros por valor de ánimo. */
  moodCounts: Record<number, number>;
}

export interface RemoveMoodResult {
  ok: boolean;
  reason?: 'invalid-input' | 'mood-not-found';
}

// ------------------------------------------------------------
// Helpers de fecha (día local 'YYYY-MM-DD' a partir de un timestamp)
// ------------------------------------------------------------

const toDateKey = (value: number): string => {
  const d = new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export function createMoodService({
  db,
  config,
  now = () => Date.now(),
  newId = uuidv4,
}: MoodServiceOptions) {
  const timestamp = (): number => now();

  const scaleMin = typeof config.scaleMin === 'number' ? config.scaleMin : 1;
  const scaleMax = typeof config.scaleMax === 'number' ? config.scaleMax : 5;

  const toRecord = (row: MoodRecord): MoodRecord => ({ ...row });

  const buildSync = (previous?: SyncTuple): SyncTuple => {
    if (!previous) return { revision: 1, updated_at: new Date(timestamp()).toISOString(), deleted: false };
    return {
      revision: previous.revision + 1,
      updated_at: new Date(timestamp()).toISOString(),
      deleted: previous.deleted,
    };
  };

  const inScale = (value: number): boolean =>
    Number.isFinite(value) && value >= scaleMin && value <= scaleMax;

  const logMood = async (input: LogMoodInput): Promise<LogMoodResult> => {
    if (
      !input ||
      !input.participantId ||
      !input.date ||
      !DATE_KEY_RE.test(input.date) ||
      typeof input.mood !== 'number' ||
      !inScale(input.mood)
    ) {
      return { ok: false, reason: 'invalid-input' };
    }

    const all = await db.moodCheckIns.toArray();
    const existing = all.find(
      (m) => m.participantId === input.participantId && m.date === input.date,
    );

    if (existing) {
      const previous = { mood: existing.mood, note: existing.note };
      const updated: MoodRecord = {
        ...existing,
        mood: input.mood,
        note: input.note,
        updatedAt: timestamp(),
        sync: buildSync(existing.sync),
      };
      await db.moodCheckIns.put(updated);
      await addAuditLog(
        'mood.log.update',
        'moodCheckIns',
        existing.id,
        previous,
        { participantId: updated.participantId, date: updated.date, mood: updated.mood },
        'moodService',
      );
      return { ok: true, record: toRecord(updated), updated: true };
    }

    if (config.maxLogsPerParticipant !== undefined) {
      const count = all.filter((m) => m.participantId === input.participantId).length;
      if (count >= config.maxLogsPerParticipant) {
        return { ok: false, reason: 'limit-reached' };
      }
    }

    const id = newId();
    const t = timestamp();
    const record: MoodRecord = {
      id,
      participantId: input.participantId,
      participantName: input.participantName,
      date: input.date,
      mood: input.mood,
      note: input.note,
      createdAt: t,
      updatedAt: t,
      sync: buildSync(),
    };
    await db.moodCheckIns.add(record);
    await addAuditLog(
      'mood.log.add',
      'moodCheckIns',
      id,
      null,
      { participantId: record.participantId, date: record.date, mood: record.mood },
      'moodService',
    );
    return { ok: true, record: toRecord(record), updated: false };
  };

  const listMoods = async (participantId?: string): Promise<MoodRecord[]> => {
    const all = await db.moodCheckIns.toArray();
    const filtered = participantId ? all.filter((m) => m.participantId === participantId) : all;
    return filtered
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt))
      .map(toRecord);
  };

  const getMoodOn = async (
    participantId: string,
    date: string,
  ): Promise<MoodRecord | undefined> => {
    if (!participantId || !date || !DATE_KEY_RE.test(date)) return undefined;
    const all = await db.moodCheckIns.toArray();
    const row = all.find((m) => m.participantId === participantId && m.date === date);
    return row ? toRecord(row) : undefined;
  };

  const getHistory = async (participantId?: string, limit?: number): Promise<MoodRecord[]> => {
    const sorted = await listMoods(participantId);
    return typeof limit === 'number' && limit >= 0 ? sorted.slice(0, limit) : sorted;
  };

  const getSummary = async (participantId?: string): Promise<MoodSummary> => {
    const records = await listMoods(participantId);
    const moodCounts: Record<number, number> = {};
    for (const r of records) {
      moodCounts[r.mood] = (moodCounts[r.mood] ?? 0) + 1;
    }
    if (records.length === 0) {
      return { totalLogs: 0, moodCounts };
    }
    const values = records.map((r) => r.mood);
    const averageMood = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
    const current = records[0]; // listMoods ordena de más reciente a más antiguo
    return {
      totalLogs: records.length,
      averageMood,
      bestMood: Math.max(...values),
      worstMood: Math.min(...values),
      currentMood: current.mood,
      currentDate: current.date,
      moodCounts,
    };
  };

  const removeMood = async (id: string): Promise<RemoveMoodResult> => {
    if (!id) return { ok: false, reason: 'invalid-input' };
    const mood = await db.moodCheckIns.get(id);
    if (!mood) return { ok: false, reason: 'mood-not-found' };
    await db.moodCheckIns.delete(id);
    await addAuditLog(
      'mood.log.remove',
      'moodCheckIns',
      id,
      { participantId: mood.participantId, date: mood.date, mood: mood.mood },
      null,
      'moodService',
    );
    return { ok: true };
  };

  return {
    logMood,
    listMoods,
    getMoodOn,
    getHistory,
    getSummary,
    removeMood,
  };
}

export type MoodService = ReturnType<typeof createMoodService>;
