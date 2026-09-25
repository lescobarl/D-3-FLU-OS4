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
import { fluDb, type ConversationRow } from '../core/db/fluDatabase';
import { buildSyncTuple } from '../core/db/syncTuple';
import { useIntegrationStore } from '../store/integrationStore';
import type { ConversationEntry } from '../types/bridge';
import { logCaughtError } from '../lib/caughtError';

const MAX_LOADED_ROWS = 180; // OS2: conversationLogMax

/**
 * C8 — Puerta ÚNICA de escritura de `fluDb.conversations`. Ningún otro módulo
 * toca la tabla: App y fluStorage delegan aquí (una sola fuente por intención).
 */
export async function putConversationRecord(record: ConversationRow): Promise<void> {
    await fluDb.conversations.put(record);
}

/** Borrado lógico de las filas indicadas (marca sync.deleted). */
export async function softDeleteConversationRows(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    return fluDb.conversations.where('id').anyOf(ids).modify((row) => {
        row.sync = { ...buildSyncTuple(row.sync, Date.now()), deleted: true };
    });
}

/**
 * Normaliza el campo `sentiment` persistido (string libre en la fila) al
 * conjunto cerrado que admite `ConversationEntry`.
 */
function toConversationSentiment(value: string | undefined): ConversationEntry['sentiment'] {
    if (value === 'positive' || value === 'negative' || value === 'neutral' || value === 'question') {
        return value;
    }
    return undefined;
}

/**
 * Convert a DB ConversationRow to a ConversationEntry (store format).
 */
function rowToEntry(row: ConversationRow): ConversationEntry {
    return {
        id: row.id,
        role: row.role,
        text: row.text,
        timestamp: row.timestamp,
        sentiment: toConversationSentiment(row.sentiment),
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
function entryToRow(entry: ConversationEntry, participantId: string) {
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
        participantId: entry.personId || participantId,
        sync: buildSyncTuple(undefined, Date.now()),
    };
}

/**
 * Hook that persists conversation entries to IndexedDB and loads
 * history on mount. Works with integrationStore.addUserMessage
 * and addFluMessage.
 */
export function useConversationPersistence(participantId?: string) {
    const integrationStore = useIntegrationStore();
    // Alcance por usuario: cada participante sólo ve SU conversación.
    const scope = participantId || 'global';
    const loadedRef = useRef(false);
    const loadedScopeRef = useRef<string>('');
    // Último usuario REAL observado (independiente del bucket `'global'` de la DB).
    const previousUserRef = useRef<string | undefined>(undefined);

    // ---- Load persisted history on mount / al cambiar de usuario ----
    useEffect(() => {
        const previousUser = previousUserRef.current;
        previousUserRef.current = participantId;

        // Sin usuario real: NO se carga y —NUNCA— se borra la conversación EN VIVO.
        // (Antes hacía batchLoadHistory([]) y borraba el turno recién dicho cuando
        // el usuario real era transitorio, p. ej. durante el onboarding.)
        if (!participantId) {
            loadedRef.current = false;
            loadedScopeRef.current = '';
            return;
        }
        if (loadedRef.current && loadedScopeRef.current === scope) return;
        loadedRef.current = true;
        loadedScopeRef.current = scope;

        (async () => {
            try {
                // Solo se vacía al cambiar entre DOS usuarios reales distintos
                // (para no mezclar conversaciones). Hacia/desde "sin usuario" NO
                // se toca lo que está en pantalla.
                const switchedRealUser = Boolean(previousUser) && previousUser !== participantId;
                if (switchedRealUser && useIntegrationStore.getState().conversationHistory.length > 0) {
                    useIntegrationStore.getState().batchLoadHistory([]);
                }
                const rows = (await fluDb.conversations.toArray())
                    .filter((row) => (row.participantId || 'global') === scope && !row.sync?.deleted)
                    .sort((a, b) => a.timestamp - b.timestamp)
                    .slice(-MAX_LOADED_ROWS);

                if (rows.length > 0) {
                    // Ya vienen en orden cronológico (ascendente).
                    const allEntries = rows.map(rowToEntry);

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
                        // Clean up the DB by removing these entries so they don't
                        // accumulate on future reloads
                        const idsToRemove = allEntries
                            .filter((e) => !entries.includes(e))
                            .map((e) => e.id)
                            .filter(Boolean);
                        if (idsToRemove.length > 0) {
                            fluDb.conversations
                                .where('id')
                                .anyOf(idsToRemove)
                                .modify((row) => {
                                    row.sync = { ...buildSyncTuple(row.sync, Date.now()), deleted: true };
                                })
                                .catch((err) => {
                                    console.error('[ConversationPersistence] Error cleaning up system events from DB:', err);
                                });
                        }
                    }

                    // Only load if store is empty (avoids double-load)
                    if (integrationStore.conversationHistory.length === 0 && entries.length > 0) {
                        // Use batchLoadHistory to set all entries at once
                        // without triggering side effects (TTS, state changes)
                        integrationStore.batchLoadHistory(entries);
                    }
                }
            } catch (err) {
                logCaughtError('[ConversationPersistence] Error loading history', err);
            }
        })();
    }, [scope, integrationStore, participantId]);

    // ---- Save each new entry to DB ----
    // Subscribe to conversationHistory.length only (not the full array) to avoid
    // re-rendering on every Zustand state change. Zustand creates a new array
    // reference on every set(), which would cause this effect to fire constantly.
    // Using a selector that returns the length ensures the component only
    // re-renders when entries are actually added or removed.
    const historyLength = useIntegrationStore((s) => s.conversationHistory.length);
    const conversationEpoch = useIntegrationStore((s) => s.conversationEpoch);
    const savedLengthRef = useRef(historyLength);
    const savedEpochRef = useRef(conversationEpoch);

    useEffect(() => {
        if (historyLength > savedLengthRef.current) {
            // New entries were added — batch save all at once
            // Access the full history directly from the store to avoid stale closures
            const fullHistory = useIntegrationStore.getState().conversationHistory;
            const newEntries = fullHistory.slice(savedLengthRef.current);
            const rows = newEntries.map((entry) => entryToRow(entry, scope));
            fluDb.conversations.bulkPut(rows).catch((err) => {
                console.error('[ConversationPersistence] Error saving entries:', err);
            });
        }
        savedLengthRef.current = historyLength;
    }, [historyLength, scope]);

    // ---- Borrado explícito de lo persistido ----
    // Se borra SOLO cuando el store anuncia un reset INTENCIONAL del historial
    // (conversationEpoch: "iniciar conversación"/"limpiar"). Un historial vacío
    // transitorio (onboarding, carga asíncrona) NO borra nada: ese efecto colateral
    // era la causa de "me borra lo que digo".
    useEffect(() => {
        if (conversationEpoch === savedEpochRef.current) return;
        savedEpochRef.current = conversationEpoch;
        savedLengthRef.current = 0;
        fluDb.conversations
            .toArray()
            .then((all) => {
                const ids = all
                    .filter((row) => (row.participantId || 'global') === scope && !row.sync?.deleted)
                    .map((row) => row.id);
                return ids.length
                    ? fluDb.conversations.where('id').anyOf(ids).modify((row) => {
                          row.sync = { ...buildSyncTuple(row.sync, Date.now()), deleted: true };
                      })
                    : undefined;
            })
            .catch((err) => {
                console.error('[ConversationPersistence] Error clearing persisted history:', err);
            });
    }, [conversationEpoch, scope]);
}
