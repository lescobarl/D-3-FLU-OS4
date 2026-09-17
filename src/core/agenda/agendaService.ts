// ============================================================
// src/core/agenda/agendaService.ts
// Servicio ÚNICO del calendario unificado (CRUD + dedup + borrado lógico).
// ------------------------------------------------------------
// Una sola base de datos y un solo servicio para alarma/recordatorio/cita/
// junta/clase. Los servicios viejos (reminder/temporal/horario) migraron
// AQUÍ y sus módulos se borraron (sin doble ruta).
//   - dedup por `agendaDedupKey` (kind+label+trigger): no duplica.
//   - `cancel`/`remove` = borrado lógico (`status: 'deleted'` + sync.deleted).
//   - `personId` aísla por participante.
//   - `buildSyncTuple` es la fuente única de la tupla de sincronización.
// ============================================================
import type { AgendaItem, AgendaKind, AgendaStatus, AgendaTrigger } from './agendaModel';
import { agendaDedupKey } from './agendaModel';
import { buildSyncTuple } from '../db/syncTuple';

// ------------------------------------------------------------
// Calendario unificado (AgendaItem) — CRUD + dedup + borrado lógico
// ------------------------------------------------------------

export interface AgendaDb {
    add: (item: AgendaItem) => Promise<unknown>;
    put: (item: AgendaItem) => Promise<unknown>;
    bulkPut: (items: AgendaItem[]) => Promise<unknown>;
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
    /** Borrado lógico de TODOS los items pendientes (devuelve cuántos marcó). */
    clearAll: () => Promise<number>;
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

        async clearAll() {
            const all = await db.toArray();
            const live = all.filter((item) => item.status !== 'deleted');
            // Escritura en LOTE (bulkPut): una sola transacción en vez de N put
            // secuenciales → borrar "toda la agenda" es inmediato aunque haya
            // muchos items.
            const marked = live.map((item) => ({
                ...item,
                status: 'deleted' as const,
                sync: { ...buildSyncTuple(item.sync, now()), deleted: true },
            }));
            if (marked.length > 0) await db.bulkPut(marked);
            return marked.length;
        },
    };
}
