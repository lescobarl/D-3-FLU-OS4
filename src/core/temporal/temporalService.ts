// ============================================================
// Temporal Service — Motor temporal genérico (alarmas + temporizadores)
// ------------------------------------------------------------
// Persistencia de alarmas y temporizadores sobre Dexie con:
//   - Obligación #6: UUIDv4 (id)
//   - Obligación #7: tupla Sync [revision, updated_at, deleted]
//   - Obligación #5: log de auditoría en cada mutación
//   - Regla #1: sin hardcode; límites desde FLU_CONFIG.temporal
// El cálculo de fechas es 100% puro (scheduleEngine) y el ítem
// guarda trigger + recurrence + nextAt (el nextAt es un "índice
// materializado" que re-arranca el hook con nextOccurrence).
// Inyección de dependencias: { db, config, now, newId }.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { addAuditLog, type SyncTuple } from '../db/fluDatabase';
import type {
  TemporalItemKind,
  TemporalItemRecord,
  TemporalItemStatus,
  TemporalRecurrence,
  TemporalTrigger,
} from './temporalTypes';
import { onceRecurrence } from './temporalTypes';
import { firstDueAt, nextOccurrence, parseTimeOfDayToMs } from './scheduleEngine';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

// Los tipos de registro provienen de temporalTypes (fuente única —
// Regla de oro) y se re-exportan aquí para comodidad del consumidor.
export type {
  TemporalItemKind,
  TemporalItemRecord,
  TemporalItemStatus,
  TemporalRecurrence,
  TemporalTrigger,
} from './temporalTypes';

export interface NewTemporalItemInput {
  kind: TemporalItemKind;
  label: string;
  trigger: TemporalTrigger;
  recurrence?: TemporalRecurrence;
  message?: string;
}

export interface TemporalConfig {
  /** Máximo de ítems activos (pending) simultáneos. */
  maxActive: number;
}

export interface TemporalDb {
  add(record: TemporalItemRecord): Promise<unknown>;
  put(record: TemporalItemRecord): Promise<unknown>;
  delete(id: string): Promise<void>;
  get(id: string): Promise<TemporalItemRecord | undefined>;
  toArray(): Promise<TemporalItemRecord[]>;
}

export interface TemporalServiceOptions {
  db: TemporalDb;
  config: TemporalConfig;
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
  /** Generador de id (por defecto: uuid v4). */
  newId?: () => string;
}

export interface AddTemporalResult {
  ok: boolean;
  record?: TemporalItemRecord;
  reason?: 'max-active' | 'invalid-input';
}

// ------------------------------------------------------------
// Validación declarativa (sin magia suelta ni hardcode)
// ------------------------------------------------------------

const VALID_KINDS = new Set<TemporalItemKind>(['alarm', 'timer']);
const VALID_RECURRENCE_KINDS = new Set<string>(['once', 'daily', 'weekdays', 'interval']);

function isValidTrigger(trigger: TemporalTrigger | undefined | null): boolean {
  if (!trigger || typeof trigger !== 'object') return false;
  switch (trigger.kind) {
    case 'absolute':
      return typeof trigger.at === 'number' && Number.isFinite(trigger.at);
    case 'daily':
      return typeof trigger.timeOfDay === 'string' && parseTimeOfDayToMs(trigger.timeOfDay) !== null;
    case 'countdown':
      return (
        typeof trigger.at === 'number' &&
        Number.isFinite(trigger.at) &&
        typeof trigger.durationMs === 'number' &&
        Number.isFinite(trigger.durationMs) &&
        trigger.durationMs >= 0
      );
    default:
      return false;
  }
}

function isValidRecurrence(recurrence: TemporalRecurrence | undefined | null): boolean {
  if (!recurrence || typeof recurrence !== 'object') return false;
  if (!VALID_RECURRENCE_KINDS.has(recurrence.kind)) return false;
  if (recurrence.kind === 'interval') {
    return (
      typeof recurrence.everyMs === 'number' &&
      Number.isFinite(recurrence.everyMs) &&
      recurrence.everyMs > 0
    );
  }
  return true;
}

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export function createTemporalService({
  db,
  config,
  now = () => Date.now(),
  newId = uuidv4,
}: TemporalServiceOptions) {
  const timestamp = (): number => now();

  const toRecord = (row: TemporalItemRecord): TemporalItemRecord => ({ ...row });

  const buildSync = (previous?: SyncTuple): SyncTuple => {
    if (!previous) return { revision: 1, updated_at: new Date(timestamp()).toISOString(), deleted: false };
    return {
      revision: previous.revision + 1,
      updated_at: new Date(timestamp()).toISOString(),
      deleted: previous.deleted,
    };
  };

  const countActive = async (): Promise<number> => {
    const all = await db.toArray();
    return all.filter((r) => r.status === 'pending').length;
  };

  const add = async (input: NewTemporalItemInput): Promise<AddTemporalResult> => {
    if (
      !input ||
      !VALID_KINDS.has(input.kind) ||
      typeof input.label !== 'string' ||
      !input.label.trim()
    ) {
      return { ok: false, reason: 'invalid-input' };
    }
    if (!isValidTrigger(input.trigger)) return { ok: false, reason: 'invalid-input' };

    const recurrence: TemporalRecurrence = input.recurrence
      ? { ...input.recurrence }
      : onceRecurrence();
    if (!isValidRecurrence(recurrence)) return { ok: false, reason: 'invalid-input' };

    const nextAt = firstDueAt(input.trigger, recurrence, timestamp());
    if (nextAt === null) return { ok: false, reason: 'invalid-input' };

    const active = await countActive();
    if (active >= config.maxActive) return { ok: false, reason: 'max-active' };

    const id = newId();
    const t = timestamp();
    const record: TemporalItemRecord = {
      id,
      kind: input.kind,
      label: input.label.trim(),
      trigger: { ...input.trigger },
      recurrence,
      nextAt,
      status: 'pending',
      message: input.message,
      personId: (input as { personId?: string }).personId,
      createdAt: t,
      updatedAt: t,
      sync: buildSync(),
    };
    await db.add(record);
    await addAuditLog(
      'temporalItem.create',
      'temporalItem',
      id,
      null,
      { kind: record.kind, label: record.label, nextAt: record.nextAt },
      'temporalService',
    );
    return { ok: true, record };
  };

  const get = async (id: string): Promise<TemporalItemRecord | undefined> => {
    if (!id) return undefined;
    const row = await db.get(id);
    return row ? toRecord(row) : undefined;
  };

  const list = async (): Promise<TemporalItemRecord[]> => {
    const all = await db.toArray();
    return all.map(toRecord);
  };

  const listActive = async (): Promise<TemporalItemRecord[]> => {
    const all = await db.toArray();
    return all.filter((r) => r.status === 'pending').map(toRecord);
  };

  const listByKind = async (kind: TemporalItemKind): Promise<TemporalItemRecord[]> => {
    const all = await db.toArray();
    return all.filter((r) => r.kind === kind).map(toRecord);
  };

  const listDue = async (at?: number): Promise<TemporalItemRecord[]> => {
    const reference = at ?? timestamp();
    const all = await db.toArray();
    return all
      .filter((r) => r.status === 'pending' && r.nextAt <= reference)
      .map(toRecord);
  };

  const transition = async (
    id: string,
    nextStatus: TemporalItemStatus,
    action: string,
  ): Promise<TemporalItemRecord | null> => {
    const row = await db.get(id);
    if (!row) return null;
    if (row.status === nextStatus) return toRecord(row);
    const updated: TemporalItemRecord = {
      ...row,
      status: nextStatus,
      updatedAt: timestamp(),
      sync: buildSync(row.sync),
    };
    await db.put(updated);
    await addAuditLog(action, 'temporalItem', id, row.status, nextStatus, 'temporalService');
    return toRecord(updated);
  };

  /**
   * Re-arranca un ítem recurrente al siguiente disparo estrictamente
   * posterior a `at` (o al reloj). Devuelve null si el disparo agotó su
   * recurrencia (el llamador debe completarlo).
   */
  const rearm = async (id: string, at?: number): Promise<TemporalItemRecord | null> => {
    const row = await db.get(id);
    if (!row) return null;
    if (row.status !== 'pending') return toRecord(row);
    const reference = at ?? timestamp();
    const nextAt = nextOccurrence(row.trigger, row.recurrence, reference);
    if (nextAt === null) return null;
    const updated: TemporalItemRecord = {
      ...row,
      nextAt,
      updatedAt: timestamp(),
      sync: buildSync(row.sync),
    };
    await db.put(updated);
    await addAuditLog('temporalItem.rearm', 'temporalItem', id, row.nextAt, nextAt, 'temporalService');
    return toRecord(updated);
  };

  const complete = (id: string): Promise<TemporalItemRecord | null> =>
    transition(id, 'done', 'temporalItem.complete');

  const cancel = (id: string): Promise<TemporalItemRecord | null> =>
    transition(id, 'cancelled', 'temporalItem.cancel');

  /** Edita etiqueta y/o hora (timeOfDay) de un ítem; recalcula `nextAt`. */
  const update = async (
    id: string,
    patch: { label?: string; timeOfDay?: string },
  ): Promise<TemporalItemRecord | null> => {
    const row = await db.get(id);
    if (!row) return null;

    const nextLabel = typeof patch.label === 'string' && patch.label.trim() ? patch.label.trim() : row.label;

    let trigger = row.trigger;
    let changed = nextLabel !== row.label;
    if (
      typeof patch.timeOfDay === 'string' &&
      patch.timeOfDay.trim() &&
      row.trigger?.kind === 'daily'
    ) {
      const tod = patch.timeOfDay.trim();
      if (parseTimeOfDayToMs(tod) !== null && tod !== row.trigger.timeOfDay) {
        trigger = { ...row.trigger, timeOfDay: tod };
        changed = true;
      }
    }

    if (!changed) return toRecord(row);

    const nextAt = firstDueAt(trigger, row.recurrence, timestamp());
    if (nextAt === null) return toRecord(row);

    const updated: TemporalItemRecord = {
      ...row,
      label: nextLabel,
      trigger,
      nextAt,
      updatedAt: timestamp(),
      sync: buildSync(row.sync),
    };
    await db.put(updated);
    await addAuditLog(
      'temporalItem.update',
      'temporalItem',
      id,
      { label: row.label, timeOfDay: row.trigger?.timeOfDay ?? null },
      { label: updated.label, timeOfDay: updated.trigger?.timeOfDay ?? null },
      'temporalService',
    );
    return toRecord(updated);
  };

  const remove = async (id: string): Promise<boolean> => {
    const row = await db.get(id);
    if (!row) return false;
    await db.delete(id);
    await addAuditLog('temporalItem.remove', 'temporalItem', id, row, null, 'temporalService');
    return true;
  };

  return {
    add,
    get,
    list,
    listActive,
    listByKind,
    listDue,
    countActive,
    complete,
    cancel,
    rearm,
    update,
    remove,
  };
}

export type TemporalService = ReturnType<typeof createTemporalService>;
