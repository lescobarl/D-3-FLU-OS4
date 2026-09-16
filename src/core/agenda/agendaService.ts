// ============================================================
// src/core/agenda/agendaService.ts
// Servicio ÚNICO del calendario unificado (CRUD + dedup + borrado lógico).
// ------------------------------------------------------------
// Una sola base de datos y un solo servicio para alarma/recordatorio/cita/
// junta/clase. Los servicios viejos (reminder/temporal/horario) migraron
// AQUÍ (factories `create*Agenda`) y sus módulos se borraron (sin doble ruta).
//   - dedup por `agendaDedupKey` (kind+label+trigger): no duplica.
//   - `cancel`/`remove` = borrado lógico (`status: 'deleted'` + sync.deleted).
//   - `personId` aísla por participante.
//   - `buildSyncTuple` es la fuente única de la tupla de sincronización.
// ============================================================
import { v4 as uuidv4 } from 'uuid';
import type { AgendaItem, AgendaKind, AgendaStatus, AgendaTrigger } from './agendaModel';
import { agendaDedupKey } from './agendaModel';
import { buildSyncTuple, makeTupleTimestamp } from '../db/syncTuple';
import { copyRecord } from '../db/recordCopy';
import { addAuditLog, type ReminderRecord, type ReminderStatus } from '../db/fluDatabase';
import type {
    TemporalItemKind,
    TemporalItemRecord,
    TemporalItemStatus,
    TemporalRecurrence,
    TemporalTrigger,
} from '../temporal/temporalTypes';
import { onceRecurrence } from '../temporal/temporalTypes';
import { firstDueAt, nextOccurrence, parseTimeOfDayToMs } from '../temporal/scheduleEngine';
import {
    type NewReminderInput,
    type NewTemporalItemInput,
} from './agendaShared';

// ------------------------------------------------------------
// Calendario unificado (AgendaItem) — CRUD + dedup + borrado lógico
// ------------------------------------------------------------

export interface AgendaDb {
    add: (item: AgendaItem) => Promise<unknown>;
    put: (item: AgendaItem) => Promise<unknown>;
    delete: (id: string) => Promise<unknown>;
    get: (id: string) => Promise<AgendaItem | undefined>;
    toArray: () => Promise<AgendaItem[]>;
}

export interface AgendaCreateInput {
    kind: AgendaKind;
    label: string;
    trigger: AgendaTrigger;
    personId?: string;
    fin?: string;
    aula?: string;
}

export interface AgendaServiceOptions {
    db: AgendaDb;
    now?: () => number;
    newId?: () => string;
}

export interface AgendaService {
    create: (input: AgendaCreateInput) => Promise<{ ok: boolean; reason?: string; item?: AgendaItem }>;
    list: (filter?: { personId?: string; status?: AgendaStatus }) => Promise<AgendaItem[]>;
    update: (id: string, patch: Partial<Pick<AgendaItem, 'label' | 'trigger'>>) => Promise<{ ok: boolean; reason?: string }>;
    cancel: (id: string) => Promise<{ ok: boolean; reason?: string }>;
    restore: (id: string) => Promise<{ ok: boolean; reason?: string }>;
    /** Marca un item como hecho (vence y no re-tica si es de una vez). */
    complete: (id: string) => Promise<{ ok: boolean; reason?: string }>;
}

export function createAgendaService(options: AgendaServiceOptions): AgendaService {
    const { db, now = () => Date.now(), newId = () => crypto.randomUUID() } = options;

    async function findDuplicate(input: AgendaCreateInput): Promise<AgendaItem | undefined> {
        const key = agendaDedupKey({ kind: input.kind, label: input.label, trigger: input.trigger });
        const all = await db.toArray();
        return all.find(
            (item) =>
                item.status !== 'deleted'
                && agendaDedupKey({ kind: item.kind, label: item.label, trigger: item.trigger }) === key,
        );
    }

    return {
        async create(input) {
            if (!input.label || !input.trigger) {
                return { ok: false, reason: 'label-trigger-obligatorios' };
            }
            if (await findDuplicate(input)) {
                return { ok: false, reason: 'duplicado' };
            }
            const item: AgendaItem = {
                id: newId(),
                kind: input.kind,
                label: input.label,
                trigger: input.trigger,
                personId: input.personId,
                status: 'pending',
                sync: buildSyncTuple(undefined, now()),
                ...(input.fin !== undefined ? { fin: input.fin } : {}),
                ...(input.aula !== undefined ? { aula: input.aula } : {}),
            };
            await db.add(item);
            return { ok: true, item };
        },

        async list(filter = {}) {
            const all = await db.toArray();
            const scope = filter.personId || 'global';
            return all.filter((item) => {
                if (filter.status && item.status !== filter.status) return false;
                return (item.personId || 'global') === scope;
            });
        },

        async update(id, patch) {
            const current = await db.get(id);
            if (!current) return { ok: false, reason: 'no-encontrado' };
            const updated: AgendaItem = {
                ...current,
                ...(patch.label !== undefined ? { label: patch.label } : {}),
                ...(patch.trigger !== undefined ? { trigger: patch.trigger } : {}),
                sync: buildSyncTuple(current.sync, now()),
            };
            await db.put(updated);
            return { ok: true };
        },

        async cancel(id) {
            const current = await db.get(id);
            if (!current) return { ok: false, reason: 'no-encontrado' };
            const cancelled: AgendaItem = {
                ...current,
                status: 'deleted',
                sync: { ...buildSyncTuple(current.sync, now()), deleted: true },
            };
            await db.put(cancelled);
            return { ok: true };
        },

        async restore(id) {
            const current = await db.get(id);
            if (!current) return { ok: false, reason: 'no-encontrado' };
            const restored: AgendaItem = {
                ...current,
                status: 'pending',
                sync: { ...buildSyncTuple(current.sync, now()), deleted: false },
            };
            await db.put(restored);
            return { ok: true };
        },

        async complete(id) {
            const current = await db.get(id);
            if (!current) return { ok: false, reason: 'no-encontrado' };
            const completed: AgendaItem = {
                ...current,
                status: 'done',
                sync: buildSyncTuple(current.sync, now()),
            };
            await db.put(completed);
            return { ok: true };
        },
    };
}

// ------------------------------------------------------------
// Dominio RECORDATORIOS (antes reminderService.ts) — absorbido aquí
// ------------------------------------------------------------

export interface ReminderConfig {
    maxPerDay: number;
    defaultCategory: string;
}

export interface RemindersDb {
    add(record: ReminderRecord): Promise<unknown>;
    put(record: ReminderRecord): Promise<unknown>;
    delete(id: string): Promise<void>;
    get(id: string): Promise<ReminderRecord | undefined>;
    toArray(): Promise<ReminderRecord[]>;
}

export interface ReminderAgendaOptions {
    db: RemindersDb;
    config: ReminderConfig;
    now?: () => number;
    newId?: () => string;
}

export interface AddReminderResult {
    ok: boolean;
    record?: ReminderRecord;
    reason?: 'max-per-day' | 'invalid-input';
}

export interface AuthorFilter {
    personId?: string;
    personName?: string;
}

export type ReminderAuthor = string | AuthorFilter;

export function createReminderAgenda({
    db,
    config,
    now = () => Date.now(),
    newId = uuidv4,
}: ReminderAgendaOptions) {
    const timestamp = makeTupleTimestamp(now);

    const startOfDay = (value: number): number => {
        const d = new Date(value);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    };

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

    const listByAuthor = async (author: ReminderAuthor): Promise<ReminderRecord[]> => {
        const all = await db.toArray();
        return all.filter((r) => matchesAuthor(r, author)).map(copyRecord);
    };

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

export type ReminderAgenda = ReturnType<typeof createReminderAgenda>;

// ------------------------------------------------------------
// Dominio TEMPORAL (antes temporalService.ts) — absorbido aquí
// ------------------------------------------------------------

export interface TemporalConfig {
    maxActive: number;
}

export interface TemporalDb {
    add(record: TemporalItemRecord): Promise<unknown>;
    put(record: TemporalItemRecord): Promise<unknown>;
    delete(id: string): Promise<void>;
    get(id: string): Promise<TemporalItemRecord | undefined>;
    toArray(): Promise<TemporalItemRecord[]>;
}

export interface TemporalAgendaOptions {
    db: TemporalDb;
    config: TemporalConfig;
    now?: () => number;
    newId?: () => string;
}

export interface AddTemporalResult {
    ok: boolean;
    record?: TemporalItemRecord;
    reason?: 'max-active' | 'invalid-input';
}

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

export function createTemporalAgenda({
    db,
    config,
    now = () => Date.now(),
    newId = uuidv4,
}: TemporalAgendaOptions) {
    const timestamp = makeTupleTimestamp(now);

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
            personId: input.personId,
            createdAt: t,
            updatedAt: t,
            sync: buildSyncTuple(undefined, timestamp()),
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
        return row ? copyRecord(row) : undefined;
    };

    const list = async (): Promise<TemporalItemRecord[]> => {
        const all = await db.toArray();
        return all.map(copyRecord);
    };

    const listActive = async (): Promise<TemporalItemRecord[]> => {
        const all = await db.toArray();
        return all.filter((r) => r.status === 'pending').map(copyRecord);
    };

    const listByKind = async (kind: TemporalItemKind): Promise<TemporalItemRecord[]> => {
        const all = await db.toArray();
        return all.filter((r) => r.kind === kind).map(copyRecord);
    };

    const listDue = async (at?: number): Promise<TemporalItemRecord[]> => {
        const reference = at ?? timestamp();
        const all = await db.toArray();
        return all
            .filter((r) => r.status === 'pending' && r.nextAt <= reference)
            .map(copyRecord);
    };

    const transition = async (
        id: string,
        nextStatus: TemporalItemStatus,
        action: string,
    ): Promise<TemporalItemRecord | null> => {
        const row = await db.get(id);
        if (!row) return null;
        if (row.status === nextStatus) return copyRecord(row);
        const updated: TemporalItemRecord = {
            ...row,
            status: nextStatus,
            updatedAt: timestamp(),
            sync: buildSyncTuple(row.sync, timestamp()),
        };
        await db.put(updated);
        await addAuditLog(action, 'temporalItem', id, row.status, nextStatus, 'temporalService');
        return copyRecord(updated);
    };

    const rearm = async (id: string, at?: number): Promise<TemporalItemRecord | null> => {
        const row = await db.get(id);
        if (!row) return null;
        if (row.status !== 'pending') return copyRecord(row);
        const reference = at ?? timestamp();
        const nextAt = nextOccurrence(row.trigger, row.recurrence, reference);
        if (nextAt === null) return null;
        const updated: TemporalItemRecord = {
            ...row,
            nextAt,
            updatedAt: timestamp(),
            sync: buildSyncTuple(row.sync, timestamp()),
        };
        await db.put(updated);
        await addAuditLog('temporalItem.rearm', 'temporalItem', id, row.nextAt, nextAt, 'temporalService');
        return copyRecord(updated);
    };

    const complete = (id: string): Promise<TemporalItemRecord | null> =>
        transition(id, 'done', 'temporalItem.complete');

    const cancel = (id: string): Promise<TemporalItemRecord | null> =>
        transition(id, 'cancelled', 'temporalItem.cancel');

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

        if (!changed) return copyRecord(row);

        const nextAt = firstDueAt(trigger, row.recurrence, timestamp());
        if (nextAt === null) return copyRecord(row);

        const updated: TemporalItemRecord = {
            ...row,
            label: nextLabel,
            trigger,
            nextAt,
            updatedAt: timestamp(),
            sync: buildSyncTuple(row.sync, timestamp()),
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
        return copyRecord(updated);
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

export type TemporalAgenda = ReturnType<typeof createTemporalAgenda>;
