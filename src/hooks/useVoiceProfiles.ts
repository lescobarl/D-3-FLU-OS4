// ============================================================
// useVoiceProfiles — Hook de Perfiles de Voz Persistente
// ============================================================
// Wrapper sobre Dexie.js para almacenar y recuperar perfiles
// de voz de participantes. Reemplaza el array vacío en App.tsx.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { fluDb, newId, type VoiceProfileRecord } from '../core/db/fluDatabase';
import { buildSyncTuple } from '../core/db/syncTuple';
import { isLiveRecord } from '../core/db/recordCopy';
import { logCaughtError } from '../lib/caughtError';

/**
 * Perfil de voz en formato de UI.
 */
export interface VoiceProfileUI {
    id: string;
    label: string;
    speakerId: string;
    timestamp: number;
}

/**
 * Puerta ÚNICA de escritura de `fluDb.voiceProfiles` (C3).
 * Ningún otro módulo toca la tabla: si necesita escribir, llama a estas
 * funciones. Así el hook y el almacenamiento legacy comparten un solo escritor.
 */
export async function insertVoiceProfile(record: VoiceProfileRecord): Promise<void> {
    await fluDb.voiceProfiles.add(record);
}

export async function persistVoiceProfile(record: VoiceProfileRecord): Promise<void> {
    await fluDb.voiceProfiles.put(record);
}

/**
 * Lee las filas VIVAS de perfiles de voz (dueño único de la lectura).
 * @returns Registros vivos ordenados por timestamp.
 */
export async function listVoiceProfileRecords(): Promise<VoiceProfileRecord[]> {
    const rows = await fluDb.voiceProfiles.orderBy('timestamp').toArray();
    return rows.filter(isLiveRecord);
}

/**
 * Busca un perfil vivo por etiqueta normalizada.
 * Regla única: `trim` y, si hay duplicados, el MÁS ANTIGUO (timestamp asc).
 * @param label Etiqueta visible.
 * @returns Registro vivo, o null.
 */
export async function findVoiceProfileRecordByLabel(
    label: string,
): Promise<VoiceProfileRecord | null> {
    const normalized = String(label || '').trim();
    if (!normalized) return null;
    const rows = await listVoiceProfileRecords();
    const matches = rows
        .filter((row) => String(row.label || '').trim() === normalized)
        .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
    return matches[0] ?? null;
}

/**
 * Borrado lógico de un perfil de voz (dueño único del borrado).
 * @param profileId Id del perfil.
 * @returns true si existía y se marcó borrado.
 */
export async function deleteVoiceProfile(profileId: string): Promise<boolean> {
    const id = String(profileId || '').trim();
    if (!id) return false;
    const existing = await fluDb.voiceProfiles.get(id);
    if (!existing) return false;
    const at = Date.now();
    await persistVoiceProfile({
        ...existing,
        sync: { ...buildSyncTuple(existing.sync, at), deleted: true },
    });
    return true;
}

function toUI(record: VoiceProfileRecord): VoiceProfileUI {
    return {
        id: record.id,
        label: record.label,
        speakerId: record.speakerId,
        timestamp: record.timestamp,
    };
}

/**
 * Hook para gestionar perfiles de voz con persistencia en IndexedDB.
 */
export function useVoiceProfiles() {
    const [profiles, setProfiles] = useState<VoiceProfileUI[]>([]);
    const [loading, setLoading] = useState(true);

    /** Cargar perfiles desde IndexedDB */
    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const records = await listVoiceProfileRecords();
            setProfiles(records.slice().reverse().map(toUI));
        } catch (err) {
            logCaughtError('[useVoiceProfiles] Error loading profiles', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh().catch((e) => logCaughtError('src/hooks/useVoiceProfiles.ts: refresh', e));
    }, [refresh]);

    /** Agregar un perfil de voz */
    const addProfile = useCallback(async (label: string, speakerId: string): Promise<VoiceProfileUI> => {
        const record: VoiceProfileRecord = {
            id: newId(),
            label,
            speakerId,
            signature: null,
            embedding: null,
            timestamp: Date.now(),
            sync: buildSyncTuple(undefined, Date.now()),
        };
        await insertVoiceProfile(record);
        const ui = toUI(record);
        setProfiles((prev) => [ui, ...prev]);
        return ui;
    }, []);

    /** Renombrar un perfil de voz */
    /**
     * Renombrar un perfil de voz. DEVUELVE el perfil ya guardado: `App.handleRenameProfile`
     * lo necesita para renombrar la voz de la SESION y auditar; sin valor de retorno el
     * nombre cambiaba en Dexie y no en la sesion (auditoria 2026-10-22).
     * @returns {Promise<VoiceProfileUI | null>}
     */
    const renameProfile = useCallback(async (id: string, newLabel: string): Promise<VoiceProfileUI | null> => {
        const existing = await fluDb.voiceProfiles.get(id);
        if (!existing) return null;

        const updated: VoiceProfileRecord = {
            ...existing,
            label: newLabel,
            sync: buildSyncTuple(existing.sync, Date.now()),
        };
        await persistVoiceProfile(updated);
        const ui = toUI(updated);
        setProfiles((prev) => prev.map((p) => (p.id === id ? ui : p)));
        return ui;
    }, []);

    /** Eliminar un perfil de voz (borrado lógico) */
    const removeProfile = useCallback(async (id: string) => {
        const removed = await deleteVoiceProfile(id);
        if (!removed) return;
        setProfiles((prev) => prev.filter((p) => p.id !== id));
    }, []);

    /** Buscar perfil por label */
    const findProfileByLabel = useCallback(async (label: string): Promise<VoiceProfileUI | null> => {
        const record = await findVoiceProfileRecordByLabel(label);
        return record ? toUI(record) : null;
    }, []);

    return {
        profiles,
        loading,
        refresh,
        addProfile,
        renameProfile,
        removeProfile,
        findProfileByLabel,
    };
}
