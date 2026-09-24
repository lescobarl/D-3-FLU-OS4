// ============================================================
// useSessionPersistence — Save/restore session state across reloads
// ============================================================
// C9 — Un ÚNICO backend de sesión: IndexedDB (Dexie, vía fluStorage).
// El estado de interfaz (tab/idioma/rol/frames) se persiste en la misma base
// que la sesión de voz; ya NO existe una ruta localStorage duplicada.
// ============================================================

import { useEffect, useRef } from 'react';
import { logCaughtError } from '../lib/caughtError';
import {
    loadUiSessionState,
    saveUiSessionState,
    clearUiSessionState,
} from '../voice/lib/fluStorage';

export interface SessionState {
    activeTab: string;
    language: string;
    sessionRole: string;
    expandedFrameId: string;
    selectedMinuteId: string | null;
    participantPhase: string;
    participantTurnCount: number;
    workspaceImageExpanded: boolean;
}

const DEFAULT_SESSION: SessionState = {
    activeTab: 'workspace',
    language: 'es',
    sessionRole: '',
    expandedFrameId: '',
    selectedMinuteId: null,
    participantPhase: 'idle',
    participantTurnCount: 0,
    workspaceImageExpanded: false,
};

/** Valores por defecto (para hidratación síncrona inicial de la UI). */
export function defaultSessionState(): SessionState {
    return { ...DEFAULT_SESSION };
}

/**
 * Load session state from the Dexie session store (fluStorage).
 */
export async function loadSessionState(): Promise<SessionState> {
    try {
        const stored = await loadUiSessionState();
        if (stored) return { ...DEFAULT_SESSION, ...stored };
    } catch (err) {
        logCaughtError('[SessionPersistence] loadSessionState failed', err);
    }
    return { ...DEFAULT_SESSION };
}

/**
 * Save session state to the Dexie backend (merge con lo ya persistido).
 */
export async function saveSessionState(state: Partial<SessionState>): Promise<void> {
    try {
        const current = await loadUiSessionState();
        const merged = { ...DEFAULT_SESSION, ...(current || {}), ...state };
        await saveUiSessionState(merged);
    } catch (err) {
        logCaughtError('[SessionPersistence] saveSessionState failed', err);
    }
}

/**
 * Clear session state from the Dexie backend.
 */
export async function clearSessionState(): Promise<void> {
    try {
        await clearUiSessionState();
    } catch (err) {
        logCaughtError('[SessionPersistence] clearSessionState failed', err);
    }
}

/**
 * Hook that auto-saves session state on changes.
 * Pass the current values and they'll be persisted automatically.
 */
export function useSessionPersistence(state: {
    activeTab: string;
    language: string;
    sessionRole: string;
    expandedFrameId: string;
    selectedMinuteId: string | null;
    participantPhase: string;
    participantTurnCount: number;
    workspaceImageExpanded: boolean;
}) {
    const isInitialMount = useRef(true);

    useEffect(() => {
        // Skip the initial mount to avoid overwriting loaded state
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }
        void saveSessionState(state);
    }, [
        state.activeTab,
        state.language,
        state.sessionRole,
        state.expandedFrameId,
        state.selectedMinuteId,
        state.participantPhase,
        state.participantTurnCount,
        state.workspaceImageExpanded,
      state,
    ]);
}
