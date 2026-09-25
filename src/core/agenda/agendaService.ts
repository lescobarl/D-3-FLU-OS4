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
import { agendaDedupKey, normalizeAgendaLabel } from './agendaModel';
import { buildSyncTuple } from '../db/syncTuple';
import { FLU_CONFIG } from '../../voice/lib/fluConfig';

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

/**
 * Selector de OBJETIVO de una serie de agenda (fuente única del matcher).
 * - `kind` acota el tipo.
 * - `target` vacío ⇒ toda la serie del kind; con texto ⇒ match semántico.
 */
export interface AgendaTargetSelector {
    personId?: string;
    kind: AgendaKind;
    target?: string;
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
    clearAll: (opts?: { personId?: string }) => Promise<number>;
    /** Items vivos que casan con el selector (serie completa, no una fila). */
    findSeries: (selector: AgendaTargetSelector) => Promise<AgendaItem[]>;
    /** Borrado lógico de TODA la serie que casa (devuelve cuántas filas marcó). */
    cancelByTarget: (selector: AgendaTargetSelector) => Promise<number>;
    /** Actualiza TODA la serie que casa (devuelve cuántas filas actualizó). */
    updateByTarget: (
        selector: AgendaTargetSelector,
        patch: Partial<Pick<AgendaItem, 'label' | 'trigger'>>,
    ) => Promise<number>;
}

/**
 * Match semántico de etiqueta (compartido por cancelar/editar/preguntar):
 * exacto → contención bidireccional → solape de tokens (≥60 %).
 */
export function agendaLabelMatches(itemLabel: string, target: string): boolean {
    const a = normalizeAgendaLabel(itemLabel);
    const b = normalizeAgendaLabel(target);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    const aw = a.split(/\s+/).filter(Boolean);
    const bw = b.split(/\s+/).filter(Boolean);
    const overlap = bw.filter((word) => aw.includes(word)).length;
    const minRatio = FLU_CONFIG.agenda.labelMatchMinTokenOverlap;
    return overlap >= Math.max(1, Math.ceil(bw.length * minRatio));
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

    /** Filas vivas (no borradas) que casan con el selector: la SERIE completa. */
    async function findSeries(selector: AgendaTargetSelector): Promise<AgendaItem[]> {
        const all = await db.toArray();
        const scope = selector.personId || 'global';
        const target = String(selector.target || '').trim();
        return all.filter((item) => {
            if (item.status === 'deleted') return false;
            if ((item.personId || 'global') !== scope) return false;
            if (item.kind !== selector.kind) return false;
            return !target || agendaLabelMatches(item.label, target);
        });
    }

    /** Borrado lógico de la SERIE (bulkPut: una transacción, como clearAll). */
    async function cancelByTarget(selector: AgendaTargetSelector): Promise<number> {
        const matches = await findSeries(selector);
        if (!matches.length) return 0;
        const marked = matches.map((item) => ({
            ...item,
            status: 'deleted' as const,
            sync: { ...buildSyncTuple(item.sync, now()), deleted: true },
        }));
        await db.bulkPut(marked);
        return marked.length;
    }

    /** Actualiza la SERIE (bulkPut): mismo objetivo que cancelar/editar. */
    async function updateByTarget(
        selector: AgendaTargetSelector,
        patch: Partial<Pick<AgendaItem, 'label' | 'trigger'>>,
    ): Promise<number> {
        const matches = await findSeries(selector);
        if (!matches.length) return 0;
        const updated = matches.map((item) => ({
            ...item,
            ...(patch.label !== undefined ? { label: patch.label } : {}),
            ...(patch.trigger !== undefined ? { trigger: patch.trigger } : {}),
            sync: buildSyncTuple(item.sync, now()),
        }));
        await db.bulkPut(updated);
        return updated.length;
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

        findSeries,
        cancelByTarget,
        updateByTarget,

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

        async clearAll(opts?: { personId?: string }) {
            const all = await db.toArray();
            // Aislamiento: MISMO criterio que `list` (fallback a 'global') para que
            // "vacié la agenda" toque exactamente lo que el panel muestra.
            const scope = opts?.personId;
            const live = all.filter(
                (item) => item.status !== 'deleted' && (!scope || (item.personId || 'global') === scope),
            );
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
