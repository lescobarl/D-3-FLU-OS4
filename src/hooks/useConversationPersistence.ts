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
import {
    bulkPutConversationRecords,
    softDeleteConversationRows,
} from '../core/db/conversationRowWriter';
import { crearConfigFlu, motorConversacionActivo } from '../voice/conversation/index';
import { useIntegrationStore } from '../store/integrationStore';
import type { ConversationEntry } from '../types/bridge';
import { logCaughtError } from '../lib/caughtError';
import { SYSTEM_EVENT_PREFIX } from '../lib/systemEventLog';
import { sessionSpeakerHighWater } from '../voice/api/identity';

const MAX_LOADED_ROWS = 180; // OS2: conversationLogMax

/**
 * C8 — el escritor ÚNICO vive en `core/db/conversationRowWriter.ts`.
 * App importa el borrado lógico desde aquí por compatibilidad; el punto de
 * escritura sigue siendo el mismo (una sola fuente por intención).
 */
export { softDeleteConversationRows };

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
        // La VOZ de la fila; el nombre se resuelve al MOSTRAR (no se persiste como dato).
        speakerId: row.speakerId,
        speakerName: row.speakerName,
        sessionId: row.sessionId,
        meta: row.meta || undefined,
        signature: row.signature || null,
        phase: row.phase || '',
        navigation: row.navigation || null,
    };
}

/**
 * Convert a ConversationEntry to a DB row format.
 * @param entry Entrada del store.
 * @param participantId Participante del scope actual.
 * @param syncPrevio Tupla de la fila que ya existía (o `null`).
 * @param existente Fila ya persistida; conserva los campos que la entrada no trae
 *   (respuesta, firma, fase…) y evita perder `sessionId`.
 */
function entryToRow(
    entry: ConversationEntry,
    participantId: string,
    syncPrevio?: { revision: number; updated_at: string; deleted: boolean } | null,
    existente?: ConversationRow | null,
) {
    const fila = {
        id: entry.id,
        role: entry.role,
        text: entry.text,
        timestamp: entry.timestamp,
        sentiment: entry.sentiment || '',
        // La VOZ de la fila (el nombre se resuelve al MOSTRAR, no se persiste en el texto).
        speakerId: entry.role === 'flu' ? 'flu' : (entry.speakerId || 'usuario'),
        // FLU/Sistema se identifican; una fila de usuario NO lleva nombre inventado.
        speakerName: entry.role === 'flu' ? 'FLU' : (entry.speakerName || ''),

        meta: entry.meta || null,
        signature: entry.signature || null,
        phase: entry.phase || '',
        navigation: entry.navigation || null,
        participantId: entry.personId || participantId,
        sessionId: entry.sessionId || existente?.sessionId,
        // REVISION QUE SE CONSERVA: la tupla incrementa sobre la fila que ya existe. Antes se
        // reiniciaba en 1 en CADA escritura (auditoria 2026-10-22) y la sincronizacion perdia el
        // rastro de las revisiones anteriores.
        sync: buildSyncTuple(syncPrevio ?? undefined, Date.now()),
    };
    if (!existente) return fila;
    // La entrada es la vista PARCIAL del store: no borra lo que solo vive en la fila.
    return {
        ...existente,
        ...fila,
        meta: fila.meta ?? existente.meta ?? null,
        sessionId: fila.sessionId || existente.sessionId,
        sync: fila.sync,
    };
}

/**
 * ¿La fila persistida ya representa EXACTAMENTE esta entrada?
 * Se usa con `engine: new` para no reescribir la fila que el módulo acaba de
 * escribir (misma locución = una sola escritura). Un renombre de voz, una fila
 * importada que falte o cualquier cambio real NO coinciden y sí se persisten.
 */
function mismaFilaPersistida(entry: ConversationEntry, row: ConversationRow): boolean {
    const speakerId = entry.role === 'flu' ? 'flu' : (entry.speakerId || 'usuario');
    const speakerName = entry.role === 'flu' ? 'FLU' : (entry.speakerName || '');
    return (
        row.role === entry.role &&
        row.text === entry.text &&
        Number(row.timestamp) === Number(entry.timestamp) &&
        row.speakerId === speakerId &&
        row.speakerName === speakerName &&
        (row.sessionId || '') === (entry.sessionId || '') &&
        JSON.stringify(row.meta || null) === JSON.stringify(entry.meta || null)
    );
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
                    // P9.83: el filtro es ESTRUCTURAL. Fuera la lista de literales (6 textos
                    // que habia que mantener a mano y se rompia al reescribir una frase): se
                    // descartan el PROPIO evento (marca `systemEvent`), su RESPUESTA (marca
                    // `systemEventReply`, la pone el escritor unico) y, por compatibilidad con
                    // filas ya guardadas, el texto que abre con el prefijo del dueno.
                    const entries = allEntries.filter((entry) => {
                        if (entry.meta?.systemEvent || entry.meta?.systemEventReply) return false;
                        const text = entry.text || '';
                        return !text.includes(SYSTEM_EVENT_PREFIX.es) && !text.includes(SYSTEM_EVENT_PREFIX.en);
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
                            softDeleteConversationRows(idsToRemove).catch((err) => {
                                logCaughtError('[ConversationPersistence] Error cleaning up system events from DB', err);
                            });
                        }
                    }

                    // Only load if store is empty (avoids double-load)
                    if (integrationStore.conversationHistory.length === 0 && entries.length > 0) {
                        // Use batchLoadHistory to set all entries at once
                        // without triggering side effects (TTS, state changes)
                        integrationStore.batchLoadHistory(entries);

                        // HIGH-WATER de la sesion tras restaurar: las filas llevan su clave
                        // (`speaker_N`), asi que el siguiente numero no reutiliza uno usado.
                        const restaurado = useIntegrationStore.getState();
                        restaurado.noteSpeakerHighWater(
                            sessionSpeakerHighWater({
                                rows: restaurado.conversationHistory,
                                epoch: restaurado.conversationEpoch,
                            }),
                        );
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

    // P4 - CONSOLIDACION: la fila se escribe en la base cuando se CONSOLIDA (su voz o su texto
    // cambian: nombrar una voz, completar un fragmento), no solo al insertarse. Suscripcion SIN
    // render (no toca el estado de React) y solo se suben las entradas que CAMBIARON de objeto.
    useEffect(() => {
        const persistidas = new Map<string, object>();
        // Tupla de sync por fila: la escritura siguiente incrementa sobre la anterior.
        const syncPorFila = new Map<string, { revision: number; updated_at: string; deleted: boolean }>();
        const guardarCambiadas = (historial: ConversationEntry[]) => {
            const cambiadas = historial.filter((e) => persistidas.get(String(e.id)) !== e);
            if (!cambiadas.length) return;
            cambiadas.forEach((e) => persistidas.set(String(e.id), e));
            const persistir = async () => {
                // Con `engine: new` la fila de usuario ya la escribió el módulo (por el
                // MISMO escritor). Solo se persiste si falta (import/backup) o si la
                // entrada cambió de verdad (renombre de voz). Con `engine: legacy` no
                // hay módulo: el usuario se persiste siempre, o sus filas desaparecen.
                const motorNuevo = motorConversacionActivo(crearConfigFlu());
                const existentes = new Map<string, ConversationRow>();
                if (motorNuevo) {
                    const ids = cambiadas.map((entry) => String(entry.id));
                    const filas = await fluDb.conversations.bulkGet(ids);
                    filas.forEach((fila, indice) => {
                        if (fila) existentes.set(ids[indice], fila);
                    });
                }
                const filas: ConversationRow[] = [];
                for (const entry of cambiadas) {
                    const id = String(entry.id);
                    const existente = existentes.get(id) || null;
                    if (motorNuevo && entry.role === 'user' && existente && mismaFilaPersistida(entry, existente)) {
                        continue;
                    }
                    const previa = syncPorFila.get(id) || existente?.sync || null;
                    const fila = entryToRow(entry, scope, previa, existente);
                    syncPorFila.set(id, fila.sync);
                    filas.push(fila);
                }
                if (!filas.length) return;
                await bulkPutConversationRecords(filas);
            };
            persistir().catch((err) => {
                logCaughtError('[ConversationPersistence] Error consolidando la fila', err);
            });
        };
        guardarCambiadas(useIntegrationStore.getState().conversationHistory);
        const soltar = useIntegrationStore.subscribe((estado) => guardarCambiadas(estado.conversationHistory));
        return () => soltar();
    }, [scope]);

    useEffect(() => {
        // UN SOLO ESCRITOR: la suscripcion de arriba ya persiste las entradas nuevas (y las
        // consolidadas). Escribirlas tambien aqui era la MISMA fila dos veces por insercion
        // (auditoria 2026-10-22). Este efecto solo mantiene el contador que usa el reset.
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
                return ids.length ? softDeleteConversationRows(ids) : undefined;
            })
            .catch((err) => {
                logCaughtError('[ConversationPersistence] Error clearing persisted history', err);
            });
    }, [conversationEpoch, scope]);
}
