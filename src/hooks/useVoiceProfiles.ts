// ============================================================
// useVoiceProfiles — Hook de Perfiles de Voz Persistente
// ============================================================
// Wrapper sobre Dexie.js para almacenar y recuperar perfiles
// de voz de participantes. Reemplaza el array vacío en App.tsx.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { fluDb, newId, newSyncTuple, bumpSync, type VoiceProfileRecord } from '../core/db/fluDatabase';

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
            const records = await fluDb.voiceProfiles
                .orderBy('timestamp')
                .reverse()
                .toArray();
            setProfiles(records.filter((r) => !r.sync.deleted).map(toUI));
        } catch (err) {
            console.error('[useVoiceProfiles] Error loading profiles:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh().catch(console.error);
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
            sync: newSyncTuple(),
        };
        await insertVoiceProfile(record);
        const ui = toUI(record);
        setProfiles((prev) => [ui, ...prev]);
        return ui;
    }, []);

    /** Renombrar un perfil de voz */
    const renameProfile = useCallback(async (id: string, newLabel: string) => {
        const existing = await fluDb.voiceProfiles.get(id);
        if (!existing) return;

        const updated: VoiceProfileRecord = {
            ...existing,
            label: newLabel,
            sync: bumpSync(existing.sync),
        };
        await persistVoiceProfile(updated);
        setProfiles((prev) => prev.map((p) => (p.id === id ? toUI(updated) : p)));
    }, []);

    /** Eliminar un perfil de voz (borrado lógico) */
    const removeProfile = useCallback(async (id: string) => {
        const existing = await fluDb.voiceProfiles.get(id);
        if (!existing) return;

        const updated: VoiceProfileRecord = {
            ...existing,
            sync: { ...bumpSync(existing.sync), deleted: true },
        };
        await persistVoiceProfile(updated);
        setProfiles((prev) => prev.filter((p) => p.id !== id));
    }, []);

    /** Buscar perfil por label */
    const findProfileByLabel = useCallback(async (label: string): Promise<VoiceProfileUI | null> => {
        const record = await fluDb.voiceProfiles
            .where('label')
            .equals(label)
            .first();
        return record && !record.sync.deleted ? toUI(record) : null;
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
