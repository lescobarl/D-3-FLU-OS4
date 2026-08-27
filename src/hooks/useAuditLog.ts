// ============================================================
// useAuditLog — Hook de Auditoría Persistente
// ============================================================
// Cumple Obligación #5: Log de auditoría
// Toda modificación de configuración se registra en IndexedDB.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import {
    fluDb,
    addAuditLog,
    getAuditLogs,
    clearAuditLogs,
    newId,
    newSyncTuple,
    type AuditLogEntry,
} from '../core/db/fluDatabase';

/**
 * Hook para acceder al log de auditoría.
 * Proporciona funciones para registrar y consultar cambios.
 */
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
            console.error('[useAuditLog] Error loading logs:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    /** Cargar logs al montar */
    useEffect(() => {
        refresh().catch(console.error);
    }, [refresh]);

    /**
     * Registrar un cambio de configuración.
     * @param entity — Nombre de la entidad modificada (ej. 'config', 'participant')
     * @param entityId — ID de la entidad
     * @param previousValue — Valor anterior
     * @param newValue — Valor nuevo
     * @param context — Contexto descriptivo
     */
    const logChange = useCallback(
        async (
            entity: string,
            entityId: string,
            previousValue: unknown,
            newValue: unknown,
            context: string = '',
        ): Promise<AuditLogEntry> => {
            const entry = await addAuditLog('config:change', entity, entityId, previousValue, newValue, context);
            setLogs((prev) => [entry, ...prev]);
            return entry;
        },
        [],
    );

    /**
     * Registrar un evento del sistema.
     */
    const logEvent = useCallback(
        async (
            action: string,
            entity: string,
            entityId: string,
            payload: unknown,
            context: string = '',
        ): Promise<AuditLogEntry> => {
            const entry = await addAuditLog(action, entity, entityId, null, payload, context);
            setLogs((prev) => [entry, ...prev]);
            return entry;
        },
        [],
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
