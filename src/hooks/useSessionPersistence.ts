// ============================================================
// useSessionPersistence — Save/restore session state across reloads
// ============================================================
// C9 — Un ÚNICO backend de sesión: IndexedDB (Dexie, vía fluStorage).
// El estado de interfaz (tab/frames/minuta) se persiste en la misma base
// que la sesión de voz; ya NO existe una ruta localStorage duplicada.
//
// P8.46 — UN VALOR, UN ALMACÉN: `language` y `sessionRole` NO viajan en este
// payload. Esos dos ajustes tienen su registro en localStorage
// (`STORAGE_KEYS.LANGUAGE` / `SESSION_ROLE`) porque los leen consumidores
// SÍNCRONOS: el estado inicial de `useConfigPersistence` y la copia de seguridad
// de `backupSystem`. La copia que había aquí la escribía el hook en cada cambio y
// NO la leía nadie (la hidratación de App solo aplica expandedFrameId y
// selectedMinuteId), así que era una ruta doble de datos con escritor y sin
// lector: dos almacenes del mismo valor, con divergencia posible. `pickSession`
// sanea además lo YA guardado, de modo que un registro viejo no reinyecte esos
// dos campos ni ningún otro que no esté declarado.
// ============================================================

import { useEffect, useRef } from 'react';
import { logCaughtError } from '../lib/caughtError';
import { clearUiSessionState, loadUiSessionState, saveUiSessionState } from '../voice/api/storage';

export interface SessionState {
    activeTab: string;
    expandedFrameId: string;
    selectedMinuteId: string | null;
    participantPhase: string;
    participantTurnCount: number;
    workspaceImageExpanded: boolean;
}

const DEFAULT_SESSION: SessionState = {
    activeTab: 'workspace',
    expandedFrameId: '',
    selectedMinuteId: null,
    participantPhase: 'idle',
    participantTurnCount: 0,
    workspaceImageExpanded: false,
};

/** Campos DECLARADOS del payload de sesión (lo que no está aquí no se persiste). */
const SESSION_FIELD_KEYS = Object.keys(DEFAULT_SESSION) as Array<keyof SessionState>;

/** Sanea una fuente (registro guardado o estado entrante) a los campos declarados. */
function pickSession(source: unknown): Partial<SessionState> {
    const out: Record<string, unknown> = {};
    if (!source || typeof source !== 'object') return out;
    for (const key of SESSION_FIELD_KEYS) {
        const value = (source as Record<string, unknown>)[key];
        if (value !== undefined) out[key] = value;
    }
    return out as Partial<SessionState>;
}

/** Valores por defecto (para hidratación síncrona inicial de la UI). */
export function defaultSessionState(): SessionState {
    return { ...DEFAULT_SESSION };
}

/**
 * Load session state from the Dexie session store (fluStorage).
 */
export async function readSessionState(): Promise<SessionState> {
    try {
        const stored = await loadUiSessionState();
        if (stored) return { ...DEFAULT_SESSION, ...pickSession(stored) };
    } catch (err) {
        logCaughtError('[SessionPersistence] readSessionState failed', err);
    }
    return { ...DEFAULT_SESSION };
}

/**
 * Save session state to the Dexie backend (merge con lo ya persistido, saneado).
 */
export async function writeSessionState(state: Partial<SessionState>): Promise<void> {
    try {
        const current = await loadUiSessionState();
        const merged = { ...DEFAULT_SESSION, ...pickSession(current), ...pickSession(state) };
        await saveUiSessionState(merged);
    } catch (err) {
        logCaughtError('[SessionPersistence] writeSessionState failed', err);
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
export function useSessionPersistence(state: SessionState) {
    const isInitialMount = useRef(true);

    useEffect(() => {
        // Skip the initial mount to avoid overwriting loaded state
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }
        void writeSessionState(state);
    }, [
        state.activeTab,
        state.expandedFrameId,
        state.selectedMinuteId,
        state.participantPhase,
        state.participantTurnCount,
        state.workspaceImageExpanded,
      state,
    ]);
}
