// ============================================================
// Reminder Service — Memoria y recordatorios (B1/B4)
// ------------------------------------------------------------
// Persistencia de recordatorios sobre Dexie con:
//   - Obligación #6: UUIDv4 (id)
//   - Obligación #7: tupla Sync [revision, updated_at, deleted]
//   - Obligación #5: log de auditoría en cada mutación
//   - Regla #1: sin hardcode; límites desde FLU_CONFIG.reminders
// Inyección de dependencias: { db, config, now, newId }.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { addAuditLog, type ReminderRecord, type ReminderStatus } from '../db/fluDatabase';
import { buildSyncTuple, makeTupleTimestamp } from '../db/syncTuple';
import { copyRecord } from '../db/recordCopy';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

// Los tipos de registro y estado provienen de la capa de base de datos
// (fuente única de verdad — Regla de oro) y se re-exportan aquí.
export type { ReminderRecord, ReminderStatus } from '../db/fluDatabase';

export interface NewReminderInput {
  text: string;
  dueAt: number;
  personId?: string;
  personName?: string;
  category?: string;
}

export interface ReminderConfig {
  /** Máximo de recordatorios creados por día. */
  maxPerDay: number;
  /** Categoría por defecto. */
  defaultCategory: string;
}

export interface RemindersDb {
  add(record: ReminderRecord): Promise<unknown>;
  put(record: ReminderRecord): Promise<unknown>;
  delete(id: string): Promise<void>;
  get(id: string): Promise<ReminderRecord | undefined>;
  toArray(): Promise<ReminderRecord[]>;
}

export interface ReminderServiceOptions {
  db: RemindersDb;
  config: ReminderConfig;
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
  /** Generador de id (por defecto: uuid v4). */
  newId?: () => string;
}

export interface AddReminderResult {
  ok: boolean;
  record?: ReminderRecord;
  reason?: 'max-per-day' | 'invalid-input';
}

// Filtro de autor para B11 (pendientes por autor).
export interface AuthorFilter {
  personId?: string;
  personName?: string;
}

/** Autor: un nombre (texto) o un filtro con personId/personName. */
export type ReminderAuthor = string | AuthorFilter;

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export function createReminderService({
  db,
  config,
  now = () => Date.now(),
  newId = uuidv4,
}: ReminderServiceOptions) {
  const timestamp = makeTupleTimestamp(now);

  const startOfDay = (value: number): number => {
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  /** Valida que no se supere el tope diario de creación. */
  const countCreatedToday = async (): Promise<number> => {
    const all = await db.toArray();
    const t = timestamp();
    const dayStart = startOfDay(t);
    return all.filter((r) => r.createdAt >= dayStart && r.createdAt < dayStart + 24 * 60 * 60 * 1000).length;
  };

  const add = async (input: NewReminderInput): Promise<AddReminderResult> => {
    if (!input || typeof input.text !== 'string' || !input.text.trim() || typeof input.dueAt !== 'number' || Number.isNaN(input.dueAt)) {
      return { ok: false, reason: 'invalid-input' };
    }
    const created = await countCreatedToday();
    if (created >= config.maxPerDay) {
      return { ok: false, reason: 'max-per-day' };
    }
    const id = newId();
    const t = timestamp();
    const record: ReminderRecord = {
      id,
      text: input.text.trim(),
      dueAt: input.dueAt,
      personId: input.personId,
      personName: input.personName,
      category: input.category || config.defaultCategory,
      status: 'pending',
      createdAt: t,
      updatedAt: t,
      sync: buildSyncTuple(undefined, timestamp()),
    };
    await db.add(record);
    await addAuditLog('reminder.create', 'reminder', id, null, { text: record.text, dueAt: record.dueAt }, 'reminderService');
    return { ok: true, record };
  };

  const get = async (id: string): Promise<ReminderRecord | undefined> => {
    if (!id) return undefined;
    const row = await db.get(id);
    return row ? copyRecord(row) : undefined;
  };

  const list = async (): Promise<ReminderRecord[]> => {
    const all = await db.toArray();
    return all.map(copyRecord);
  };

  const listPending = async (): Promise<ReminderRecord[]> => {
    const all = await db.toArray();
    return all.filter((r) => r.status === 'pending').map(copyRecord);
  };

  const listDue = async (at?: number): Promise<ReminderRecord[]> => {
    const reference = at ?? timestamp();
    const all = await db.toArray();
    return all
      .filter((r) => r.status === 'pending' && r.dueAt <= reference)
      .map(copyRecord);
  };

  // B11: un recordatorio pertenece a un autor si coincide su personId o su
  // personName (comparación sin mayúsculas y sin espacios extra).
  const matchesAuthor = (record: ReminderRecord, author: ReminderAuthor): boolean => {
    if (!author) return false;
    if (typeof author === 'string') {
      const needle = author.trim().toLowerCase();
      return (record.personName ?? '').trim().toLowerCase() === needle;
    }
    if (author.personId && record.personId === author.personId) return true;
    if (author.personName) {
      const needle = author.personName.trim().toLowerCase();
      if ((record.personName ?? '').trim().toLowerCase() === needle) return true;
    }
    return false;
  };

  // B11: recordatorios de un autor (pendientes o en cualquier estado).
  const listByAuthor = async (author: ReminderAuthor): Promise<ReminderRecord[]> => {
    const all = await db.toArray();
    return all.filter((r) => matchesAuthor(r, author)).map(copyRecord);
  };

  // B11: solo pendientes de un autor.
  const listPendingByAuthor = async (author: ReminderAuthor): Promise<ReminderRecord[]> => {
    const all = await db.toArray();
    return all.filter((r) => r.status === 'pending' && matchesAuthor(r, author)).map(copyRecord);
  };

  const transition = async (
    id: string,
    nextStatus: ReminderStatus,
    action: string,
  ): Promise<ReminderRecord | null> => {
    const row = await db.get(id);
    if (!row) return null;
    if (row.status === nextStatus) return copyRecord(row);
    const updated: ReminderRecord = {
      ...row,
      status: nextStatus,
      updatedAt: timestamp(),
      sync: buildSyncTuple(row.sync, timestamp()),
    };
    await db.put(updated);
    await addAuditLog(action, 'reminder', id, row.status, nextStatus, 'reminderService');
    return copyRecord(updated);
  };

  const complete = (id: string): Promise<ReminderRecord | null> =>
    transition(id, 'done', 'reminder.complete');

  const dismiss = (id: string): Promise<ReminderRecord | null> =>
    transition(id, 'dismissed', 'reminder.dismiss');

  /** Edita texto y/o vencimiento de un recordatorio (mismo patrón que transition). */
  const update = async (
    id: string,
    patch: { text?: string; dueAt?: number },
  ): Promise<ReminderRecord | null> => {
    const row = await db.get(id);
    if (!row) return null;
    const nextText = typeof patch.text === 'string' ? patch.text.trim() : row.text;
    if (!nextText) return copyRecord(row);
    const nextDueAt =
      typeof patch.dueAt === 'number' && !Number.isNaN(patch.dueAt) ? patch.dueAt : row.dueAt;
    if (nextText === row.text && nextDueAt === row.dueAt) return copyRecord(row);
    const updated: ReminderRecord = {
      ...row,
      text: nextText,
      dueAt: nextDueAt,
      updatedAt: timestamp(),
      sync: buildSyncTuple(row.sync, timestamp()),
    };
    await db.put(updated);
    await addAuditLog(
      'reminder.update',
      'reminder',
      id,
      { text: row.text, dueAt: row.dueAt },
      { text: updated.text, dueAt: updated.dueAt },
      'reminderService',
    );
    return copyRecord(updated);
  };

  const remove = async (id: string): Promise<boolean> => {
    const row = await db.get(id);
    if (!row) return false;
    await db.delete(id);
    await addAuditLog('reminder.remove', 'reminder', id, row, null, 'reminderService');
    return true;
  };

  return {
    add,
    get,
    list,
    listPending,
    listDue,
    listByAuthor,
    listPendingByAuthor,
    complete,
    dismiss,
    update,
    remove,
    countCreatedToday,
  };
}

export type ReminderService = ReturnType<typeof createReminderService>;
