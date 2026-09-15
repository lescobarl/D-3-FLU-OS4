// ============================================================
// src/core/agenda/agendaService.ts
// Servicio ÚNICO del calendario unificado (CRUD sobre la tabla `agenda`).
// ------------------------------------------------------------
// Una sola base de datos y un solo servicio para alarma/recordatorio/cita/
// junta/clase. Los servicios viejos (reminder/temporal/horario) deben migrar
// AQUÍ y luego borrarse (sin doble ruta).
//   - dedup por `agendaDedupKey` (kind+label+trigger): no duplica.
//   - `cancel`/`remove` = borrado lógico (`status: 'deleted'` + sync.deleted).
//   - `personId` aísla por participante.
//   - `buildSyncTuple` es la fuente única de la tupla de sincronización.
// ============================================================
import type { AgendaItem, AgendaKind, AgendaStatus, AgendaTrigger } from './agendaModel';
import { agendaDedupKey } from './agendaModel';
import { buildSyncTuple } from '../db/syncTuple';

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
    };
}
