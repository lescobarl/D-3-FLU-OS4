// ============================================================
// useMinuteKnowledge — Hook de Minutas Persistente
// ============================================================
// Wrapper sobre Dexie.js para almacenar y recuperar minutas.
// Sigue la nomenclatura exacta de OS2 normalizeMinuteKnowledgeRecord:
//   - summarySnapshot: { titulo, participantes, resumen, acuerdos, pendientes, siguientes_pasos, tema_sesion }
//   - historyCode: código de historial (YYMMDD-NN)
//   - description: texto descriptivo (titulo)
//   - minuteKey: clave única para dedup
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { fluDb, newId, type MinuteRecord, type MinuteSummarySnapshot, type KnowledgeKind } from '../core/db/fluDatabase';
import { buildSyncTuple } from '../core/db/syncTuple';
import { useIntegrationStore } from '../store/integrationStore';
import { logCaughtError } from '../lib/caughtError';
import { buildMinuteKey, formatMinuteHistoryCode, parseMinuteHistoryCode } from '../lib/minuteKnowledgeHelpers';

/**
 * Minuta en formato de UI (compatible con OS2 normalizeMinuteKnowledgeRecord).
 * Exponemos summarySnapshot directamente para que la UI acceda a los campos semánticos.
 */
export interface MinuteUIEntry {
    id: string;
    profileId: string;
    userId: string;
    minuteKey: string;
    historyCode: string;
    description: string;
    summarySnapshot: MinuteSummarySnapshot;
    sequence: number;
    createdAt: string;
    updatedAt: string;
}

/**
 * Clave/formato/parseo del historyCode: dueno unico en
 * src/lib/minuteKnowledgeHelpers.ts (se importan arriba). NO se reimplementan
 * aqui: la copia local divergia del canonico (auditoria 2026-10-02).
 */
function compareHistoryCodeDesc(a: string, b: string): number {
    const left = parseMinuteHistoryCode(a);
    const right = parseMinuteHistoryCode(b);
    const dateCompare = right.date.localeCompare(left.date);
    if (dateCompare !== 0) return dateCompare;
    return right.sequence - left.sequence;
}

/**
 * Obtiene la siguiente secuencia universal para historyCode.
 */
function getNextSequence(entries: MinuteRecord[]): number {
    return entries.reduce((max, entry) => {
        const { sequence } = parseMinuteHistoryCode(entry.historyCode);
        return Math.max(max, sequence);
    }, 0) + 1;
}

/**
 * Convierte MinuteRecord a MinuteUIEntry.
 */
function toUI(record: MinuteRecord): MinuteUIEntry {
    return {
        id: record.id,
        profileId: record.profileId,
        userId: record.userId,
        minuteKey: record.minuteKey,
        historyCode: record.historyCode,
        description: record.description,
        summarySnapshot: { ...record.summarySnapshot },
        sequence: record.sequence,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

/**
 * Formatea una etiqueta de historial al estilo OS2 formatMinuteHistoryLabelForUi.
 * Formato: "YYMMDD-NN-Description" o solo "Description" si no hay code.
 */
export function formatMinuteHistoryLabelForUi(entry: MinuteUIEntry): string {
    const code = (entry.historyCode || '').trim();
    const description = (entry.description || entry.summarySnapshot?.titulo || '').trim();
    if (!code) return description;
    if (!description) return code;
    return `${code}-${description}`;
}

/**
 * Hook para gestionar minutas con persistencia en IndexedDB.
 * Sigue la nomenclatura exacta de OS2 normalizeMinuteKnowledgeRecord.
 */
/**
 * UNICO punto del proyecto que publica una minuta en integrationStore (C10).
 *
 * El dueño de la minuta (useMinuteKnowledge) es quien publica; los consumidores
 * NO espejan por su cuenta. Centralizar aqui hace que la publicacion individual y
 * la hidratacion del store pasen por la misma puerta: antes App recorria las
 * minutas y llamaba a integrationStore.addMinute por su cuenta (segundo escritor).
 */
function publishMinuteToStore(entry: MinuteUIEntry): void {
    useIntegrationStore.getState().addMinute(entry);
}
export function useMinuteKnowledge(participantId?: string) {
    const scope = participantId || 'global';
    const [minutes, setMinutes] = useState<MinuteUIEntry[]>([]);
    const [loading, setLoading] = useState(true);

    /** Cargar minutas desde IndexedDB, ordenadas por createdAt descendente */
    const refresh = useCallback(async () => {
        // Sin usuario real: NO se lee nada (todo el pizarrón es por usuario).
        if (!participantId) {
            setMinutes([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const records = await fluDb.minutes
                .orderBy('sequence')
                .reverse()
                .toArray();
            setMinutes(
                records
                    // Aislamiento por usuario: solo las minutas de ESTE usuario.
                    .filter((r) => !r.sync.deleted && (r.userId || 'global') === scope)
                    .sort((a, b) => compareHistoryCodeDesc(a.historyCode, b.historyCode))
                    .map(toUI),
            );
        } catch (err) {
            logCaughtError('[useMinuteKnowledge] Error loading minutes', err);
        } finally {
            setLoading(false);
        }
    }, [scope, participantId]);

    useEffect(() => {
        refresh().catch((e) => logCaughtError('src/hooks/useMinuteKnowledge.ts: refresh', e));
    }, [refresh]);

    /**
     * Agregar una minuta.
     * Acepta un summarySnapshot (OS2 compatible) y genera los metadatos automáticamente.
     */
    const addMinute = useCallback(
        async (snapshot: MinuteSummarySnapshot, options?: { profileId?: string; userId?: string; kind?: KnowledgeKind }): Promise<MinuteUIEntry> => {
            const records = await fluDb.minutes.orderBy('sequence').reverse().toArray();
            const maxSeq = records.length > 0 ? records[0].sequence : 0;
            const now = new Date();
            const kind = options?.kind || snapshot.kind || 'minuta';
            const snapshotWithKind: MinuteSummarySnapshot = { ...snapshot, kind };
            const minuteKey = buildMinuteKey(snapshotWithKind);
            const description = (snapshotWithKind.titulo || '').trim();

            // Buscar si ya existe una minuta con el mismo minuteKey (upsert)
            // El dueno de la clave es buildMinuteKey (canonico). Las filas escritas
            // ANTES de la unificacion pueden llevar la clave vieja, asi que la clave
            // se RECALCULA al buscar: de lo contrario el upsert crearia una fila
            // duplicada de la misma minuta (AGENTS.md 7.7.c).
            const existingIndex = records.findIndex(
                (r) => !r.sync.deleted && buildMinuteKey(r.summarySnapshot) === minuteKey,
            );

            const record: MinuteRecord = {
                id: existingIndex >= 0 ? records[existingIndex].id : newId(),
                profileId: options?.profileId || '',
                userId: options?.userId || (scope !== 'global' ? scope : ''),
                minuteKey,
                historyCode:
                    existingIndex >= 0
                        ? records[existingIndex].historyCode
                        : formatMinuteHistoryCode(now, getNextSequence(records)),
                description,
                summarySnapshot: { ...snapshotWithKind },
                sequence: maxSeq + 1,
                createdAt: existingIndex >= 0 ? records[existingIndex].createdAt : now.toISOString(),
                updatedAt: now.toISOString(),
                sync: existingIndex >= 0 ? buildSyncTuple(records[existingIndex].sync, Date.now()) : buildSyncTuple(undefined, Date.now()),
            };

            if (existingIndex >= 0) {
                await fluDb.minutes.put(record);
            } else {
                await fluDb.minutes.add(record);
            }

            const ui = toUI(record);
            setMinutes((prev) => {
                const filtered = prev.filter((m) => m.id !== record.id);
                return [ui, ...filtered].sort((a, b) => compareHistoryCodeDesc(a.historyCode, b.historyCode));
            });
            // C10 — Escritura ÚNICA hacia el store: el dueño de la minuta
            // (persistencia) es quien publica en integrationStore; los
            // consumidores NO espejan por su cuenta.
            publishMinuteToStore(ui);
            return ui;
        },
        [scope],
    );

    /** Publica en integrationStore todas las minutas cargadas (hidratacion). */
    const publishAllToStore = useCallback(() => {
        minutes.forEach(publishMinuteToStore);
    }, [minutes]);

    /** Actualizar una minuta existente */
    const updateMinute = useCallback(async (id: string, snapshot: Partial<MinuteSummarySnapshot>) => {
        const existing = await fluDb.minutes.get(id);
        if (!existing) return;

        const mergedSnapshot: MinuteSummarySnapshot = {
            ...existing.summarySnapshot,
            ...snapshot,
        };

        const updated: MinuteRecord = {
            ...existing,
            summarySnapshot: mergedSnapshot,
            description: (mergedSnapshot.titulo || existing.description || '').trim(),
            minuteKey: buildMinuteKey(mergedSnapshot),
            updatedAt: new Date().toISOString(),
            sync: buildSyncTuple(existing.sync, Date.now()),
        };
        await fluDb.minutes.put(updated);
        setMinutes((prev) =>
            prev
                .map((m) => (m.id === id ? toUI(updated) : m))
                .sort((a, b) => compareHistoryCodeDesc(a.historyCode, b.historyCode)),
        );
    }, []);

    /** Eliminar una minuta (borrado lógico) */
    const deleteMinute = useCallback(async (id: string) => {
        const existing = await fluDb.minutes.get(id);
        if (!existing) return;

        const updated: MinuteRecord = {
            ...existing,
            sync: { ...buildSyncTuple(existing.sync, Date.now()), deleted: true },
        };
        await fluDb.minutes.put(updated);
        setMinutes((prev) => prev.filter((m) => m.id !== id));
    }, []);

    /** Obtener una minuta por ID */
    const getMinute = useCallback(async (id: string): Promise<MinuteUIEntry | null> => {
        const record = await fluDb.minutes.get(id);
        return record && !record.sync.deleted ? toUI(record) : null;
    }, []);

    return {
        minutes,
        loading,
        refresh,
        addMinute,
        publishAllToStore,
        updateMinute,
        deleteMinute,
        getMinute,
    };
}
