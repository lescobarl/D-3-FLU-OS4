// ============================================================
// useAuditLog — Hook de Auditoría Persistente
// ============================================================
// Cumple Obligación #5: Log de auditoría
// Toda modificación de configuración se registra en IndexedDB.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { logCaughtError } from '../lib/caughtError';
import {
    addAuditLog,
    getAuditLogs,
    clearAuditLogs,
    type AuditLogEntry,
} from '../core/db/fluDatabase';

/**
 * Hook para acceder al log de auditoría.
 * Proporciona funciones para registrar y consultar cambios.
 */
/** Argumentos de un cambio de configuración. */
type ChangeArgs = [entity: string, entityId: string, previous: unknown, next: unknown, context?: string];

/** Argumentos de un evento del sistema. */
type EventArgs = [action: string, entity: string, entityId: string, payload: unknown, context?: string];

export function useAuditLog() {
    const [logs, setLogs] = useState<AuditLogEntry[]>([]);
    const [loading, setLoading] = useState(true);

    /** Recargar logs desde IndexedDB */
    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const entries = await getAuditLogs(200);
            setLogs(entries);
        } catch (err) {
            logCaughtError('[useAuditLog] Error loading logs', err);
        } finally {
            setLoading(false);
        }
    }, []);

    /** Cargar logs al montar */
    useEffect(() => {
        refresh().catch((e) => logCaughtError('src/hooks/useAuditLog.ts: refresh', e));
    }, [refresh]);

    /**
     * Registrar un cambio de configuración.
     * @param entity — Nombre de la entidad modificada (ej. 'config', 'participant')
     * @param entityId — ID de la entidad
     * @param previousValue — Valor anterior
     * @param newValue — Valor nuevo
     * @param context — Contexto descriptivo
     */
    /** Añade la entrada creada al estado y la devuelve (dueño único). */
    const appendEntry = useCallback(async (created: Promise<AuditLogEntry>): Promise<AuditLogEntry> => {
        const entry = await created;
        setLogs((prev) => [entry, ...prev]);
        return entry;
    }, []);

    const logChange = useCallback(
        async (...args: ChangeArgs): Promise<AuditLogEntry> => {
            const [entity, entityId, previousValue, newValue, context = ''] = args;
            return appendEntry(
                addAuditLog('config:change', entity, entityId, previousValue, newValue, context),
            );
        },
        [appendEntry],
    );

    /**
     * Registrar un evento del sistema.
     */
    const logEvent = useCallback(
        async (...args: EventArgs): Promise<AuditLogEntry> => {
            const [action, entity, entityId, payload, context = ''] = args;
            return appendEntry(addAuditLog(action, entity, entityId, null, payload, context));
        },
        [appendEntry],
    );

    /**
     * Limpiar todos los logs de auditoría (OS2 parity: clearAuditLogs).
     */
    const clearAll = useCallback(async () => {
        await clearAuditLogs();
        setLogs([]);
    }, []);

    return {
        logs,
        loading,
        refresh,
        logChange,
        logEvent,
        clearAll,
    };
}
