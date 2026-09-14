// ============================================================
// Habit Service — Hábitos y Metas (Fase 4, Módulo G)
// ------------------------------------------------------------
// Gestión persistente de metas/hábitos por participante con:
//   - check-in diario (un registro por meta y día, upsert)
//   - rachas (streaks) de días consecutivos completados
//   - progreso respecto a un objetivo de días (targetDays)
// Cumple:
//   - Obligación #6: UUIDv4 (id)
//   - Obligación #7: tupla Sync [revision, updated_at, deleted]
//   - Obligación #5: log de auditoría en cada mutación
//   - Regla #1: sin hardcode; categorías y límites desde config
// Inyección de dependencias: { db, config, now, newId }.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import {
  addAuditLog,
  type GoalCheckInRecord,
  type GoalRecord,
  type GoalStatus,
} from '../db/fluDatabase';
import { buildSyncTuple, makeTupleTimestamp } from '../db/syncTuple';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

// Los tipos de registro provienen de la capa de base de datos
// (fuente única de verdad — Regla de oro) y se re-exportan aquí.
export type { GoalCheckInRecord, GoalRecord, GoalStatus } from '../db/fluDatabase';

export interface HabitsConfig {
  /** Categorías válidas para una meta/hábito (p. ej. 'habito', 'meta', ...). */
  categories: string[];
  /** Días objetivo por defecto cuando no se indica targetDays (para hábitos). */
  defaultTargetDays?: number;
  /** Tope de metas activas por participante (opcional). */
  maxGoalsPerParticipant?: number;
}

export interface GoalTableDb {
  add(record: GoalRecord): Promise<unknown>;
  put(record: GoalRecord): Promise<unknown>;
  delete(id: string): Promise<void>;
  get(id: string): Promise<GoalRecord | undefined>;
  toArray(): Promise<GoalRecord[]>;
}

export interface CheckInTableDb {
  add(record: GoalCheckInRecord): Promise<unknown>;
  put(record: GoalCheckInRecord): Promise<unknown>;
  delete(id: string): Promise<void>;
  get(id: string): Promise<GoalCheckInRecord | undefined>;
  toArray(): Promise<GoalCheckInRecord[]>;
}

export interface HabitsDb {
  goals: GoalTableDb;
  checkIns: CheckInTableDb;
}

export interface HabitsServiceOptions {
  db: HabitsDb;
  config: HabitsConfig;
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
  /** Generador de id (por defecto: uuid v4). */
  newId?: () => string;
}

export interface NewGoalInput {
  participantId: string;
  participantName?: string;
  title: string;
  description?: string;
  category: string;
  targetDays?: number;
  unit?: string;
}

export interface AddGoalResult {
  ok: boolean;
  record?: GoalRecord;
  reason?: 'invalid-input' | 'limit-reached';
}

export interface CheckInInput {
  goalId: string;
  /** Clave de día local 'YYYY-MM-DD'. */
  date: string;
  done: boolean;
  note?: string;
}

export interface CheckInResult {
  ok: boolean;
  record?: GoalCheckInRecord;
  /** Racha de días consecutivos completados tras el check-in. */
  streak?: number;
  reason?: 'invalid-input' | 'goal-not-found';
}

export interface UpdateStatusResult {
  ok: boolean;
  record?: GoalRecord;
  reason?: 'invalid-input' | 'goal-not-found';
}

export interface RemoveResult {
  ok: boolean;
  reason?: 'invalid-input' | 'goal-not-found';
}

export interface GoalStats {
  goal: GoalRecord;
  completedDays: number;
  streak: number;
  /** Progreso 0..1 respecto a targetDays (undefined si no aplica). */
  progress?: number;
  /** Check-in de hoy (si existe). */
  todayCheckIn?: GoalCheckInRecord;
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

const previousDayKey = (dateKey: string): string => {
  const [y, m, d] = dateKey.split('-').map(Number);
  const prev = new Date(y, m - 1, d - 1);
  const pm = String(prev.getMonth() + 1).padStart(2, '0');
  const pd = String(prev.getDate()).padStart(2, '0');
  return `${prev.getFullYear()}-${pm}-${pd}`;
};

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export function createHabitsService({
  db,
  config,
  now = () => Date.now(),
  newId = uuidv4,
}: HabitsServiceOptions) {
  const timestamp = makeTupleTimestamp(now);

  const toGoal = (row: GoalRecord): GoalRecord => ({ ...row });
  const toCheckIn = (row: GoalCheckInRecord): GoalCheckInRecord => ({ ...row });

  const defaultTargetDays =
    typeof config.defaultTargetDays === 'number' ? config.defaultTargetDays : undefined;

  const addGoal = async (input: NewGoalInput): Promise<AddGoalResult> => {
    if (
      !input ||
      !input.participantId ||
      !input.title ||
      !input.title.trim() ||
      !input.category ||
      !config.categories.includes(input.category)
    ) {
      return { ok: false, reason: 'invalid-input' };
    }
    if (config.maxGoalsPerParticipant !== undefined) {
      const all = await db.goals.toArray();
      const count = all.filter(
        (g) => g.participantId === input.participantId && g.status === 'active',
      ).length;
      if (count >= config.maxGoalsPerParticipant) {
        return { ok: false, reason: 'limit-reached' };
      }
    }
    const id = newId();
    const t = timestamp();
    const record: GoalRecord = {
      id,
      participantId: input.participantId,
      participantName: input.participantName,
      title: input.title.trim(),
      description: input.description,
      category: input.category,
      status: 'active',
      targetDays: input.targetDays ?? defaultTargetDays,
      unit: input.unit,
      createdAt: t,
      updatedAt: t,
      sync: buildSyncTuple(undefined, timestamp()),
    };
    await db.goals.add(record);
    await addAuditLog(
      'habits.goal.add',
      'goals',
      id,
      null,
      { participantId: record.participantId, title: record.title, category: record.category },
      'habitService',
    );
    return { ok: true, record };
  };

  const listGoals = async (participantId?: string): Promise<GoalRecord[]> => {
    const all = await db.goals.toArray();
    const filtered = participantId ? all.filter((g) => g.participantId === participantId) : all;
    return filtered
      .slice()
      .sort((a, b) => {
        const statusOrder = (s: GoalStatus): number => (s === 'active' ? 0 : 1);
        return statusOrder(a.status) - statusOrder(b.status) || b.createdAt - a.createdAt;
      })
      .map(toGoal);
  };

  const getGoal = async (id: string): Promise<GoalRecord | undefined> => {
    if (!id) return undefined;
    const row = await db.goals.get(id);
    return row ? toGoal(row) : undefined;
  };

  /** Días consecutivos completados (done=true) hasta la fecha de referencia. */
  const getStreak = async (goalId: string, reference?: number): Promise<number> => {
    if (!goalId) return 0;
    const all = await db.checkIns.toArray();
    const doneDates = new Set(
      all.filter((c) => c.goalId === goalId && c.done).map((c) => c.date),
    );
    const today = toDateKey(reference ?? timestamp());
    const todayCheck = all.find((c) => c.goalId === goalId && c.date === today);
    // Si hoy tiene check-in y NO está completado, la racha está rota hoy.
    if (todayCheck && !todayCheck.done) return 0;
    let cursor = doneDates.has(today) ? today : previousDayKey(today);
    let streak = 0;
    while (doneDates.has(cursor)) {
      streak += 1;
      cursor = previousDayKey(cursor);
    }
    return streak;
  };

  const getStats = async (participantId?: string, reference?: number): Promise<GoalStats[]> => {
    const goals = await listGoals(participantId);
    const all = await db.checkIns.toArray();
    const today = toDateKey(reference ?? timestamp());
    return goals.map((goal) => {
      const entries = all.filter((c) => c.goalId === goal.id);
      const completedDays = entries.filter((c) => c.done).length;
      const streak = (() => {
        const doneDates = new Set(entries.filter((c) => c.done).map((c) => c.date));
        const todayCheck = entries.find((c) => c.date === today);
        if (todayCheck && !todayCheck.done) return 0;
        let cursor = doneDates.has(today) ? today : previousDayKey(today);
        let s = 0;
        while (doneDates.has(cursor)) {
          s += 1;
          cursor = previousDayKey(cursor);
        }
        return s;
      })();
      const progress =
        typeof goal.targetDays === 'number' && goal.targetDays > 0
          ? Math.min(1, completedDays / goal.targetDays)
          : undefined;
      return {
        goal,
        completedDays,
        streak,
        progress,
        todayCheckIn: entries.find((c) => c.date === today),
      };
    });
  };

  const checkIn = async (input: CheckInInput, reference?: number): Promise<CheckInResult> => {
    if (!input || !input.goalId || !input.date || !DATE_KEY_RE.test(input.date)) {
      return { ok: false, reason: 'invalid-input' };
    }
    const goal = await db.goals.get(input.goalId);
    if (!goal) return { ok: false, reason: 'goal-not-found' };

    const all = await db.checkIns.toArray();
    const existing = all.find(
      (c) => c.goalId === input.goalId && c.date === input.date,
    );

    if (existing) {
      const previous = { done: existing.done, note: existing.note };
      const updated: GoalCheckInRecord = {
        ...existing,
        done: input.done,
        note: input.note,
        updatedAt: timestamp(),
        sync: buildSyncTuple(existing.sync, timestamp()),
      };
      await db.checkIns.put(updated);
      await addAuditLog(
        'habits.checkin.update',
        'goalCheckIns',
        existing.id,
        previous,
        { done: updated.done, note: updated.note },
        'habitService',
      );
      const streak = await getStreak(input.goalId, reference);
      return { ok: true, record: toCheckIn(updated), streak };
    }

    const id = newId();
    const t = timestamp();
    const record: GoalCheckInRecord = {
      id,
      goalId: input.goalId,
      participantId: goal.participantId,
      date: input.date,
      done: input.done,
      note: input.note,
      createdAt: t,
      updatedAt: t,
      sync: buildSyncTuple(undefined, timestamp()),
    };
    await db.checkIns.add(record);
    await addAuditLog(
      'habits.checkin.add',
      'goalCheckIns',
      id,
      null,
      { goalId: record.goalId, date: record.date, done: record.done },
      'habitService',
    );
    const streak = await getStreak(input.goalId, reference);
    return { ok: true, record: toCheckIn(record), streak };
  };

  const updateStatus = async (id: string, status: GoalStatus): Promise<UpdateStatusResult> => {
    if (!id || !['active', 'done', 'paused', 'archived'].includes(status)) {
      return { ok: false, reason: 'invalid-input' };
    }
    const goal = await db.goals.get(id);
    if (!goal) return { ok: false, reason: 'goal-not-found' };
    if (goal.status === status) return { ok: true, record: toGoal(goal) };
    const previous = { status: goal.status };
    const updated: GoalRecord = {
      ...goal,
      status,
      updatedAt: timestamp(),
      sync: buildSyncTuple(goal.sync, timestamp()),
    };
    await db.goals.put(updated);
    await addAuditLog(
      'habits.goal.status',
      'goals',
      id,
      previous,
      { status: updated.status },
      'habitService',
    );
    return { ok: true, record: toGoal(updated) };
  };

  const removeGoal = async (id: string): Promise<RemoveResult> => {
    if (!id) return { ok: false, reason: 'invalid-input' };
    const goal = await db.goals.get(id);
    if (!goal) return { ok: false, reason: 'goal-not-found' };
    // Borra también sus check-ins (integridad del histórico).
    const all = await db.checkIns.toArray();
    const checkIns = all.filter((c) => c.goalId === id);
    for (const c of checkIns) {
      await db.checkIns.delete(c.id);
      await addAuditLog(
        'habits.checkin.remove',
        'goalCheckIns',
        c.id,
        { goalId: c.goalId, date: c.date },
        null,
        'habitService',
      );
    }
    await db.goals.delete(id);
    await addAuditLog(
      'habits.goal.remove',
      'goals',
      id,
      { participantId: goal.participantId, title: goal.title },
      null,
      'habitService',
    );
    return { ok: true };
  };

  return {
    addGoal,
    listGoals,
    getGoal,
    getStreak,
    getStats,
    checkIn,
    updateStatus,
    removeGoal,
  };
}

export type HabitsService = ReturnType<typeof createHabitsService>;
