// ============================================================
// useMinuteHandlers — Hook para handlers de minutas/resúmenes
// ============================================================
// Extraído de App.tsx para reducir la carga del componente principal.
// Maneja:
//   - handleGenerateMinute: generar minuta desde conversación vía Gemini
//   - handleGenerateSummary: generar resumen desde conversación vía Gemini
//   - handleSaveMinute: guardar minuta (draft) en IndexedDB
//   - handleSelectMinuteHistory: cargar minuta del historial
// ============================================================

import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { aiService } from '../services/aiServiceFactory';
import { speakResponse } from '../voice/lib/fluSpeech';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { createMinuteDraftFromSummary } from '../lib/minuteKnowledgeHelpers';
import type { IntegrationStore } from '../store/integrationStore';
import type { MinuteUIEntry } from './useMinuteKnowledge';
import type { AuditLogEntry, MinuteSummarySnapshot } from '../core/db/fluDatabase';
import { logCaughtError } from '../lib/caughtError';

/** Draft de minuta producido por `createMinuteDraftFromSummary`. */
export type MinuteDraft = ReturnType<typeof createMinuteDraftFromSummary>;

export interface MinuteHandlers {
    isGeneratingMinute: boolean;
    isSummarizing: boolean;
    handleGenerateMinute: () => Promise<void>;
    handleGenerateSummary: (opts?: { announce?: boolean; save?: boolean }) => Promise<boolean>;
    handleSaveMinute: (draftOverride?: MinuteDraft | null, opts?: { announce?: boolean }) => Promise<void>;
    handleSaveConversationSummary: (opts?: { announce?: boolean }) => Promise<void>;
    handleSelectMinuteHistory: (entry: MinuteUIEntry) => void;
}

export interface MinuteHandlersDeps {
    integrationStore: IntegrationStore;
    minuteKnowledge: {
        minutes: MinuteUIEntry[];
        addMinute: (snapshot: MinuteSummarySnapshot, options?: { profileId?: string; userId?: string; kind?: 'minuta' | 'conversacion' | 'diario' }) => Promise<MinuteUIEntry>;
    };
    auditLog: {
        logEvent: (type: string, category: string, id: string, data: unknown, description: string) => Promise<AuditLogEntry>;
    };
    language: string;
    apiKey: string;
    sessionRole: string;
    voiceStatus: string;
    minuteDraft: MinuteDraft | null;
    setMinuteDraft: (draft: MinuteDraft | null) => void;
    setSelectedMinuteId: (id: string | null) => void;
    os2StartListening: (opts?: { resume?: boolean }) => Promise<void>;
    os2StopListening: (opts?: { closing?: boolean }) => Promise<void>;
    getCommandSpeech: (comando: string, lang: string) => string;
}

export function useMinuteHandlers(deps: MinuteHandlersDeps): MinuteHandlers {
    const {
        integrationStore,
        minuteKnowledge,
        auditLog,
        language,
        apiKey,
        sessionRole,
        voiceStatus,
        minuteDraft,
        setMinuteDraft,
        setSelectedMinuteId,
        os2StartListening,
        os2StopListening,
        getCommandSpeech,
    } = deps;

    const [isGeneratingMinute, setIsGeneratingMinute] = useState(false);
    const [isSummarizing, setIsSummarizing] = useState(false);

    // ============================================================
    // handleGenerateMinute
    // ============================================================
    const handleGenerateMinute = useCallback(async () => {
        const history = integrationStore.conversationHistory;
        if (history.length === 0 || isGeneratingMinute) return;

        // FLU "Pensando" (Idle_1) while generating the minute — deterministic
        // per definition. Restore only if the prior state was IDLE so we never
        // clobber an active LISTENING/SPEAKING conversation.
        const prevState = integrationStore.conversationState;
        if (prevState !== 'THINKING') {
            integrationStore.setConversationState('THINKING');
        }
        setIsGeneratingMinute(true);
        try {
            const result = await aiService.generateMinute({ apiKey, language }, history, 'neutral');
            if (result) {
                // Build a MinuteSummarySnapshot from the Gemini result
                const snapshot = {
                    titulo: result.titulo || 'Minuta',
                    participantes: Array.isArray(result.participantes) ? result.participantes : [],
                    resumen: result.resumen || '',
                    acuerdos: Array.isArray(result.acuerdos) ? result.acuerdos : [],
                    pendientes: Array.isArray(result.pendientes) ? result.pendientes : [],
                    siguientes_pasos: Array.isArray(result.siguientes_pasos) ? result.siguientes_pasos : [],
                    tema_sesion: result.tema_sesion || '',
                };
                // Add to IndexedDB via minuteKnowledge (expects MinuteSummarySnapshot)
                // C10: la publicación en integrationStore la hace el dueño de la
                // minuta (useMinuteKnowledge.addMinute); aquí NO se espeja.
                const persisted = await minuteKnowledge.addMinute(snapshot);
                // OS2 parity: speak the minute title after generation
                const speechText = getCommandSpeech('GUARDAR_MINUTA', language);
                if (speechText) {
                    try {
                        await speakResponse(`${speechText} ${snapshot.titulo || ''}`, language);
                    } catch (speechErr) {
                        logCaughtError('[useMinuteHandlers] Minute generation speech failed', speechErr);
                    }
                }
                auditLog.logEvent('minute:generated', 'minute', persisted.id, {
                    titulo: snapshot.titulo,
                    historyLength: history.length,
                }, 'Minute generated from conversation').catch(console.error);
            }
        } catch (error) {
            logCaughtError('[useMinuteHandlers] Error generating minute:', error);
            auditLog.logEvent('minute:error', 'minute', uuidv4(), {
                error: String(error),
            }, 'Minute generation failed').catch(console.error);
        } finally {
            setIsGeneratingMinute(false);
            if (prevState === 'IDLE') {
                integrationStore.setConversationState('IDLE');
            }
        }
    }, [integrationStore, minuteKnowledge, auditLog, isGeneratingMinute, language, apiKey, getCommandSpeech]);

    // ============================================================
    // handleGenerateSummary
    // `save: true` persiste la minuta (cierre de día). Devuelve true
    // sólo si se guardó, para que el llamante marque el día con evidencia.
    // ============================================================
    const handleGenerateSummary = useCallback(async ({ announce = false, save = false }: { announce?: boolean; save?: boolean } = {}): Promise<boolean> => {
        const history = integrationStore.conversationHistory;
        if (history.length === 0 || isSummarizing) return false;

        if (announce) {
            try {
                const speechText = getCommandSpeech('GENERAR_RESUMEN', language);
                if (speechText) {
                    await speakResponse(speechText, language);
                }
            } catch (speechErr) {
                logCaughtError('[useMinuteHandlers] GENERAR_RESUMEN command speech failed', speechErr);
            }
        }

        const wasListening = voiceStatus === 'listening';
        if (wasListening) {
            await os2StopListening({ closing: true }).catch((e: unknown) => { logCaughtError('[catch] src/hooks/useMinuteHandlers.ts', e) });
        }

        // FLU "Pensando" (Idle_1) while generating the summary — deterministic
        // per definition. Restore only if the prior state was IDLE.
        const prevState = integrationStore.conversationState;
        if (prevState !== 'THINKING') {
            integrationStore.setConversationState('THINKING');
        }
        setIsSummarizing(true);
        let saved = false;
        try {
            const result = await aiService.generateConversationSummary({ apiKey, language, role: sessionRole }, history);

            if (result) {
                const draft = createMinuteDraftFromSummary(result, sessionRole);
                setMinuteDraft(draft);
                setSelectedMinuteId('');

                if (save) {
                    const snapshot = {
                        titulo: String(result.titulo || 'Minuta').trim(),
                        participantes: Array.isArray(result.participantes) ? result.participantes : [],
                        resumen: String(result.resumen || '').trim(),
                        acuerdos: Array.isArray(result.acuerdos) ? result.acuerdos : [],
                        pendientes: Array.isArray(result.pendientes) ? result.pendientes : [],
                        siguientes_pasos: Array.isArray(result.siguientes_pasos) ? result.siguientes_pasos : [],
                        tema_sesion: String(sessionRole || '').trim(),
                    };
                    const persisted = await minuteKnowledge.addMinute(snapshot);
                    setSelectedMinuteId(persisted.id);
                    saved = true;
                }

                // OS2 parity: buildSummarySpeechText + speakResponse (Gap 25)
                const summaryParts: string[] = [];
                if (result.titulo) summaryParts.push(result.titulo);
                if (result.resumen) summaryParts.push(result.resumen);
                if (Array.isArray(result.acuerdos) && result.acuerdos.length > 0) {
                    summaryParts.push(`Acuerdos: ${result.acuerdos.join(', ')}`);
                }
                const speechText = summaryParts.join('. ');
                if (speechText) {
                    try {
                        await speakResponse(speechText, language);
                    } catch (speechErr) {
                        logCaughtError('[useMinuteHandlers] Summary speech failed', speechErr);
                    }
                }

                auditLog.logEvent('summary:generated', 'summary', uuidv4(), {
                    titulo: result.titulo || '',
                    historyLength: history.length,
                }, 'Summary generated').catch(console.error);
            }
        } catch (error) {
            logCaughtError('[useMinuteHandlers] Error generating summary:', error);
            setMinuteDraft(
                createMinuteDraftFromSummary({
                    titulo: FLU_CONFIG.ui.workspace.summaryUnavailableTitle || 'Resumen no disponible',
                    participantes: [],
                    resumen: error instanceof Error ? error.message : 'Error al generar resumen',
                    acuerdos: [],
                    pendientes: [],
                    siguientes_pasos: [],
                    tema_sesion: sessionRole,
                }, sessionRole),
            );
            auditLog.logEvent('summary:error', 'summary', uuidv4(), {
                error: String(error),
            }, 'Summary generation failed').catch(console.error);
        } finally {
            setIsSummarizing(false);
            if (prevState === 'IDLE') {
                integrationStore.setConversationState('IDLE');
            }
            if (wasListening) {
                os2StartListening({ resume: true }).catch((e: unknown) => { logCaughtError('[catch] src/hooks/useMinuteHandlers.ts', e) });
            }
        }
        return saved;
    }, [apiKey, integrationStore, minuteKnowledge, language, sessionRole, voiceStatus, os2StartListening, os2StopListening, auditLog, isSummarizing, setMinuteDraft, setSelectedMinuteId, getCommandSpeech]);

    // ============================================================
    // handleSaveMinute
    // ============================================================
    const handleSaveMinute = useCallback(async (draftOverride?: MinuteDraft | null, { announce = true }: { announce?: boolean } = {}) => {
        const sourceDraft = draftOverride || minuteDraft;
        if (!sourceDraft) return;

        try {
            // sourceDraft is a flat draft object (titulo, participantes, resumen, etc.)
            // Convert to MinuteSummarySnapshot for minuteKnowledge.addMinute
            const snapshot = {
                titulo: String(sourceDraft.titulo || '').trim(),
                participantes: Array.isArray(sourceDraft.participantes) ? sourceDraft.participantes : [],
                resumen: String(sourceDraft.resumen || '').trim(),
                acuerdos: Array.isArray(sourceDraft.acuerdos) ? sourceDraft.acuerdos : [],
                pendientes: Array.isArray(sourceDraft.pendientes) ? sourceDraft.pendientes : [],
                siguientes_pasos: Array.isArray(sourceDraft.siguientes_pasos) ? sourceDraft.siguientes_pasos : [],
                tema_sesion: String(sourceDraft.tema_sesion || sessionRole || '').trim(),
            };
            const persisted = await minuteKnowledge.addMinute(snapshot);
            setSelectedMinuteId(persisted.id);
            setMinuteDraft(
                createMinuteDraftFromSummary(
                    persisted.summarySnapshot,
                    persisted.summarySnapshot.tema_sesion || sessionRole,
                    persisted.id,
                ),
            );

            // OS2 parity: command speech for GUARDAR_MINUTA (Gap 26)
            const savedTitle = String(persisted.summarySnapshot.titulo || '').trim();
            const commandSpeechText = getCommandSpeech('GUARDAR_MINUTA', language);
            const speechText = savedTitle
                ? `${commandSpeechText} ${savedTitle}`
                : commandSpeechText;
            if (announce && speechText) {
                try {
                    await speakResponse(speechText, language);
                } catch (speechErr) {
                    logCaughtError('[useMinuteHandlers] GUARDAR_MINUTA speech failed', speechErr);
                }
            }

            auditLog.logEvent('minute:saved', 'minute', persisted.id, {
                titulo: persisted.summarySnapshot.titulo || '',
            }, 'Minute saved').catch(console.error);
        } catch (error) {
            logCaughtError('[useMinuteHandlers] Error saving minute:', error);
            auditLog.logEvent('minute:save-error', 'minute', uuidv4(), {
                error: String(error),
            }, 'Minute save failed').catch(console.error);
        }
    }, [minuteDraft, minuteKnowledge, language, sessionRole, auditLog, setMinuteDraft, setSelectedMinuteId, getCommandSpeech]);

    // ============================================================
    // handleSaveConversationSummary
    // Guarda el resumen de la conversación UNA sola vez como
    // conocimiento de tipo 'conversacion' (Paso 6: memoria con kind).
    // ============================================================
    const handleSaveConversationSummary = useCallback(async ({ announce = false }: { announce?: boolean } = {}) => {
        const history = integrationStore.conversationHistory;
        if (history.length === 0) return;

        try {
            const result = await aiService.generateConversationSummary({ apiKey, language, role: sessionRole }, history);
            if (!result) return;

            const snapshot = {
                titulo: String(result.titulo || 'Conversación').trim(),
                participantes: Array.isArray(result.participantes) ? result.participantes : [],
                resumen: String(result.resumen || '').trim(),
                acuerdos: Array.isArray(result.acuerdos) ? result.acuerdos : [],
                pendientes: Array.isArray(result.pendientes) ? result.pendientes : [],
                siguientes_pasos: Array.isArray(result.siguientes_pasos) ? result.siguientes_pasos : [],
                tema_sesion: String(sessionRole || '').trim(),
            };
            const persisted = await minuteKnowledge.addMinute(snapshot, { kind: 'conversacion' });

            if (announce) {
                const speechText = getCommandSpeech('GUARDAR_MINUTA', language);
                const savedTitle = String(persisted.summarySnapshot.titulo || '').trim();
                if (speechText) {
                    try {
                        await speakResponse(savedTitle ? `${speechText} ${savedTitle}` : speechText, language);
                    } catch (speechErr) {
                        logCaughtError('[useMinuteHandlers] Conversation summary speech failed', speechErr);
                    }
                }
            }

            auditLog.logEvent('conversation:summary-saved', 'summary', persisted.id, {
                titulo: persisted.summarySnapshot.titulo || '',
                historyLength: history.length,
                kind: 'conversacion',
            }, 'Conversation summary saved on close').catch(console.error);
        } catch (error) {
            logCaughtError('[useMinuteHandlers] Error saving conversation summary:', error);
            auditLog.logEvent('conversation:summary-save-error', 'summary', uuidv4(), {
                error: String(error),
            }, 'Conversation summary save failed').catch(console.error);
        }
    }, [integrationStore, minuteKnowledge, auditLog, language, apiKey, sessionRole, getCommandSpeech]);

    // ============================================================
    // handleSelectMinuteHistory
    // ============================================================
    const handleSelectMinuteHistory = useCallback((entry: MinuteUIEntry) => {
        if (!entry) return;
        setSelectedMinuteId(entry.id);
        const snapshot = entry.summarySnapshot || entry;
        const theme = snapshot.tema_sesion || sessionRole;
        setMinuteDraft(
            createMinuteDraftFromSummary(snapshot, theme, entry.id),
        );
    }, [sessionRole, setMinuteDraft, setSelectedMinuteId]);

    return {
        isGeneratingMinute,
        isSummarizing,
        handleGenerateMinute,
        handleGenerateSummary,
        handleSaveMinute,
        handleSaveConversationSummary,
        handleSelectMinuteHistory,
    };
}
