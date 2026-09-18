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
import { fluDb, newId, newSyncTuple, bumpSync, type MinuteRecord, type MinuteSummarySnapshot, type KnowledgeKind } from '../core/db/fluDatabase';

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
 * Construye minuteKey al estilo OS2: titulo|tema_sesion normalizado.
 */
function buildMinuteKey(snapshot: MinuteSummarySnapshot): string {
    const title = (snapshot.titulo || '').trim().toLowerCase();
    const theme = (snapshot.tema_sesion || '').trim().toLowerCase();
    return `${title}|${theme}`;
}

/**
 * Formatea historyCode al estilo OS2: YYMMDD-NN
 */
function formatHistoryCode(now: Date, sequence: number): string {
    const year = String(now.getFullYear()).slice(-2);
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const seq = String(sequence).padStart(2, '0');
    return `${year}${month}${day}-${seq}`;
}

/**
 * Parsea historyCode: { date: string, sequence: number }
 */
function parseHistoryCode(code: string): { date: string; sequence: number } {
    const match = (code || '').trim().match(/^(\d{6})-(\d+)$/);
    if (!match) return { date: code || '', sequence: 0 };
    return { date: match[1], sequence: Number.parseInt(match[2], 10) || 0 };
}

/**
 * Compara dos historyCodes descendente (más reciente primero).
 */
function compareHistoryCodeDesc(a: string, b: string): number {
    const left = parseHistoryCode(a);
    const right = parseHistoryCode(b);
    const dateCompare = right.date.localeCompare(left.date);
    if (dateCompare !== 0) return dateCompare;
    return right.sequence - left.sequence;
}

/**
 * Obtiene la siguiente secuencia universal para historyCode.
 */
function getNextSequence(entries: MinuteRecord[]): number {
    return entries.reduce((max, entry) => {
        const { sequence } = parseHistoryCode(entry.historyCode);
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
 * Crea un MinuteSummarySnapshot vacío.
 */
export function createEmptySummarySnapshot(theme = ''): MinuteSummarySnapshot {
    return {
        titulo: '',
        participantes: [],
        resumen: '',
        acuerdos: [],
        pendientes: [],
        siguientes_pasos: [],
        tema_sesion: (theme || '').trim(),
    };
}

/**
 * Crea un MinuteSummarySnapshot desde un AISummaryResult (o cualquier objeto con esos campos).
 */
export function createSummarySnapshotFromResult(result: Record<string, unknown>, theme = ''): MinuteSummarySnapshot {
    return {
        titulo: String(result?.titulo || '').trim(),
        participantes: Array.isArray(result?.participantes)
            ? result.participantes.map((item: unknown) => String(item || '').trim()).filter(Boolean)
            : [],
        resumen: String(result?.resumen || '').trim(),
        acuerdos: Array.isArray(result?.acuerdos)
            ? result.acuerdos.map((item: unknown) => String(item || '').trim()).filter(Boolean)
            : [],
        pendientes: Array.isArray(result?.pendientes)
            ? result.pendientes.map((item: unknown) => String(item || '').trim()).filter(Boolean)
            : [],
        siguientes_pasos: Array.isArray(result?.siguientes_pasos)
            ? result.siguientes_pasos.map((item: unknown) => String(item || '').trim()).filter(Boolean)
            : [],
        tema_sesion: String(result?.tema_sesion || theme || '').trim(),
    };
}

/**
 * Crea un MinuteSummarySnapshot desde un draft de OS2 (createMinuteDraftFromSummary).
 */
export function createSummarySnapshotFromDraft(draft: Record<string, unknown>, theme = ''): MinuteSummarySnapshot {
    return {
        titulo: String(draft?.titulo || '').trim(),
        participantes: Array.isArray(draft?.participantes)
            ? draft.participantes.map((item: unknown) => String(item || '').trim()).filter(Boolean)
            : [],
        resumen: String(draft?.resumen || '').trim(),
        acuerdos: Array.isArray(draft?.acuerdos)
            ? draft.acuerdos.map((item: unknown) => String(item || '').trim()).filter(Boolean)
            : [],
        pendientes: Array.isArray(draft?.pendientes)
            ? draft.pendientes.map((item: unknown) => String(item || '').trim()).filter(Boolean)
            : [],
        siguientes_pasos: Array.isArray(draft?.siguientes_pasos)
            ? draft.siguientes_pasos.map((item: unknown) => String(item || '').trim()).filter(Boolean)
            : [],
        tema_sesion: String(draft?.tema_sesion || theme || '').trim(),
    };
}

/**
 * Formatea una etiqueta de historial al estilo OS2 formatMinuteHistoryLabel.
 * Formato: "YYMMDD-NN-Description" o solo "Description" si no hay code.
 */
export function formatMinuteHistoryLabel(entry: MinuteUIEntry): string {
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
            console.error('[useMinuteKnowledge] Error loading minutes:', err);
        } finally {
            setLoading(false);
        }
    }, [scope]);

    useEffect(() => {
        refresh().catch(console.error);
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
            const existingIndex = records.findIndex((r) => r.minuteKey === minuteKey && !r.sync.deleted);

            const record: MinuteRecord = {
                id: existingIndex >= 0 ? records[existingIndex].id : newId(),
                profileId: options?.profileId || '',
                userId: options?.userId || (scope !== 'global' ? scope : ''),
                minuteKey,
                historyCode:
                    existingIndex >= 0
                        ? records[existingIndex].historyCode
                        : formatHistoryCode(now, getNextSequence(records)),
                description,
                summarySnapshot: { ...snapshotWithKind },
                sequence: maxSeq + 1,
                createdAt: existingIndex >= 0 ? records[existingIndex].createdAt : now.toISOString(),
                updatedAt: now.toISOString(),
                sync: existingIndex >= 0 ? bumpSync(records[existingIndex].sync) : newSyncTuple(),
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
            return ui;
        },
        [],
    );

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
            sync: bumpSync(existing.sync),
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
            sync: { ...bumpSync(existing.sync), deleted: true },
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
        updateMinute,
        deleteMinute,
        getMinute,
    };
}
