// ============================================================
// useSessionPersistence — Save/restore session state across reloads
// ============================================================
// OS2-style: session state (active tab, language, role, participant
// state, workspace image, etc.) is persisted to localStorage so
// the UI returns to the same state after a page reload.
//
// This hook is complementary to useConversationPersistence (which
// persists conversation history to IndexedDB). This one handles
// ephemeral UI state via localStorage.
// ============================================================

import { useEffect, useRef } from 'react';

const SESSION_STORAGE_KEY = 'flu-session-state';

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

/**
 * Load session state from localStorage.
 */
export function loadSessionState(): SessionState {
    try {
        const raw = localStorage.getItem(SESSION_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return { ...DEFAULT_SESSION, ...parsed };
        }
    } catch (err) {
        console.warn('[SessionPersistence] loadSessionState failed:', err);
    }
    return { ...DEFAULT_SESSION };
}

/**
 * Save session state to localStorage.
 */
export function saveSessionState(state: Partial<SessionState>): void {
    try {
        const current = loadSessionState();
        const merged = { ...current, ...state };
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(merged));
    } catch (err) {
        console.warn('[SessionPersistence] saveSessionState failed:', err);
    }
}

/**
 * Clear session state from localStorage.
 */
export function clearSessionState(): void {
    try {
        localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch (err) {
        console.warn('[SessionPersistence] clearSessionState failed:', err);
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
        saveSessionState(state);
    }, [
        state.activeTab,
        state.language,
        state.sessionRole,
        state.expandedFrameId,
        state.selectedMinuteId,
        state.participantPhase,
        state.participantTurnCount,
        state.workspaceImageExpanded,
    ]);
}
