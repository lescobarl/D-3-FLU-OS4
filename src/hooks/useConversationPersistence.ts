// ============================================================
// useConversationPersistence — Auto-save/load conversation to IndexedDB
// ============================================================
// OS2-style: every conversation turn is persisted to the `audit_logs`
// table (or `conversations` table). On mount, we load the latest N
// entries to restore the conversation history across page reloads.
//
// This hook integrates with integrationStore to:
//   1. On mount: load persisted conversation rows into the store
//   2. On each addUserMessage / addFluMessage: save to DB
// ============================================================

import { useEffect, useRef } from 'react';
import { fluDb, newSyncTuple } from '../core/db/fluDatabase';
import { useIntegrationStore } from '../store/integrationStore';
import type { ConversationEntry } from '../types/bridge';

const MAX_LOADED_ROWS = 180; // OS2: conversationLogMax

/**
 * Convert a DB ConversationRow to a ConversationEntry (store format).
 */
function rowToEntry(row: any): ConversationEntry {
    return {
        id: row.id,
        role: row.role,
        text: row.text,
        timestamp: row.timestamp,
        sentiment: row.sentiment,
        speakerName: row.speakerName,
        response: row.response || '',
        meta: row.meta || (row.response ? { response: row.response } : undefined),
        signature: row.signature || null,
        phase: row.phase || '',
        navigation: row.navigation || null,
    };
}

/**
 * Convert a ConversationEntry to a DB row format.
 */
function entryToRow(entry: ConversationEntry) {
    return {
        id: entry.id,
        role: entry.role,
        text: entry.text,
        timestamp: entry.timestamp,
        sentiment: entry.sentiment || '',
        speakerId: entry.role === 'flu' ? 'flu' : (entry.speakerName || 'usuario'),
        speakerName: entry.speakerName || (entry.role === 'flu' ? 'FLU' : 'Usuario'),
        response: entry.response || '',
        meta: entry.meta || null,
        signature: entry.signature || null,
        phase: entry.phase || '',
        navigation: entry.navigation || null,
        sync: newSyncTuple(),
    };
}

/**
 * Hook that persists conversation entries to IndexedDB and loads
 * history on mount. Works with integrationStore.addUserMessage
 * and addFluMessage.
 */
export function useConversationPersistence() {
    const integrationStore = useIntegrationStore();
    const loadedRef = useRef(false);

    // ---- Load persisted history on mount ----
    useEffect(() => {
        if (loadedRef.current) return;
        loadedRef.current = true;

        (async () => {
            try {
                const rows = await fluDb.conversations
                    .orderBy('timestamp')
                    .reverse()
                    .limit(MAX_LOADED_ROWS)
                    .toArray();

                if (rows.length > 0) {
                    // Reverse back to chronological order
                    const allEntries = rows.reverse().map(rowToEntry);

                    // Filter out system events (participant_ignored, etc.) so they
                    // don't reappear in the UI after a page reload. These are ephemeral
                    // emotional events that should only exist during the session they
                    // were generated in.
                    // Also filter out any entries that contain system event text patterns,
                    // including Gemini's responses TO system events (which don't have
                    // meta.systemEvent marker but contain the emotional text).
                    const SYSTEM_EVENT_PATTERNS = [
                        '[FLU recuerda]',
                        '[FLU remembers]',
                        'Me enojé porque levanté la mano',
                        'I got upset because I raised my hand',
                        'Me siento realmente molesto y triste porque levanté la mano',
                        'I feel really upset and sad because I raised my hand',
                    ];
                    const entries = allEntries.filter((entry) => {
                        if (entry.meta?.systemEvent) return false;
                        const text = entry.text || '';
                        return !SYSTEM_EVENT_PATTERNS.some((pattern) =>
                            text.includes(pattern)
                        );
                    });

                    const filteredCount = allEntries.length - entries.length;
                    if (filteredCount > 0) {
                        console.log(`[ConversationPersistence] Filtered out ${filteredCount} system event entries from loaded history`);
                        // Clean up the DB by removing these entries so they don't
                        // accumulate on future reloads
                        const idsToRemove = allEntries
                            .filter((e) => !entries.includes(e))
                            .map((e) => e.id)
                            .filter(Boolean);
                        if (idsToRemove.length > 0) {
                            fluDb.conversations.bulkDelete(idsToRemove).catch((err) => {
                                console.error('[ConversationPersistence] Error cleaning up system events from DB:', err);
                            });
                        }
                    }

                    // Only load if store is empty (avoids double-load)
                    if (integrationStore.conversationHistory.length === 0 && entries.length > 0) {
                        // Use batchLoadHistory to set all entries at once
                        // without triggering side effects (TTS, state changes)
                        integrationStore.batchLoadHistory(entries);
                        console.log(`[ConversationPersistence] Loaded ${entries.length} entries from DB`);
                    }
                }
            } catch (err) {
                console.error('[ConversationPersistence] Error loading history:', err);
            }
        })();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ---- Save each new entry to DB ----
    // Subscribe to conversationHistory.length only (not the full array) to avoid
    // re-rendering on every Zustand state change. Zustand creates a new array
    // reference on every set(), which would cause this effect to fire constantly.
    // Using a selector that returns the length ensures the component only
    // re-renders when entries are actually added or removed.
    const historyLength = useIntegrationStore((s) => s.conversationHistory.length);
    const savedLengthRef = useRef(historyLength);

    useEffect(() => {
        if (historyLength > savedLengthRef.current) {
            // New entries were added — batch save all at once
            // Access the full history directly from the store to avoid stale closures
            const fullHistory = useIntegrationStore.getState().conversationHistory;
            const newEntries = fullHistory.slice(savedLengthRef.current);
            const rows = newEntries.map(entryToRow);
            fluDb.conversations.bulkPut(rows).catch((err) => {
                console.error('[ConversationPersistence] Error saving entries:', err);
            });
            savedLengthRef.current = historyLength;
            return;
        }
        if (historyLength === 0 && savedLengthRef.current > 0) {
            // El historial se vació en memoria ("iniciar conversación"/limpiar):
            // borrar también lo persistido para que NO reaparezca al recargar.
            savedLengthRef.current = 0;
            fluDb.conversations.clear().catch((err) => {
                console.error('[ConversationPersistence] Error clearing persisted history:', err);
            });
        }
    }, [historyLength]);
}
