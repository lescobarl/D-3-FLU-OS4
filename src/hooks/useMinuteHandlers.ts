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

export interface MinuteHandlers {
    isGeneratingMinute: boolean;
    isSummarizing: boolean;
    handleGenerateMinute: () => Promise<void>;
    handleGenerateSummary: (opts?: { announce?: boolean }) => Promise<void>;
    handleSaveMinute: (draftOverride?: any, opts?: { announce?: boolean }) => Promise<void>;
    handleSelectMinuteHistory: (entry: any) => void;
}

export interface MinuteHandlersDeps {
    integrationStore: IntegrationStore;
    minuteKnowledge: {
        minutes: MinuteUIEntry[];
        addMinute: (snapshot: any) => Promise<MinuteUIEntry>;
    };
    auditLog: {
        logEvent: (type: string, category: string, id: string, data: any, description: string) => Promise<any>;
    };
    language: string;
    apiKey: string;
    sessionRole: string;
    voiceStatus: string;
    minuteDraft: any;
    setMinuteDraft: (draft: any) => void;
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
                const persisted = await minuteKnowledge.addMinute(snapshot);
                // Add to integration store (expects MinuteUIEntry)
                integrationStore.addMinute(persisted);
                // OS2 parity: speak the minute title after generation
                const speechText = getCommandSpeech('GUARDAR_MINUTA', language);
                if (speechText) {
                    try {
                        await speakResponse(`${speechText} ${snapshot.titulo || ''}`, language);
                    } catch (speechErr) {
                        console.warn('[useMinuteHandlers] Minute generation speech failed:', speechErr);
                    }
                }
                auditLog.logEvent('minute:generated', 'minute', persisted.id, {
                    titulo: snapshot.titulo,
                    historyLength: history.length,
                }, 'Minute generated from conversation').catch(console.error);
            }
        } catch (error) {
            console.error('[useMinuteHandlers] Error generating minute:', error);
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
    // ============================================================
    const handleGenerateSummary = useCallback(async ({ announce = false }: { announce?: boolean } = {}) => {
        const history = integrationStore.conversationHistory;
        if (history.length === 0 || isSummarizing) return;

        if (announce) {
            try {
                const speechText = getCommandSpeech('GENERAR_RESUMEN', language);
                if (speechText) {
                    await speakResponse(speechText, language);
                }
            } catch (speechErr) {
                console.warn('[useMinuteHandlers] GENERAR_RESUMEN command speech failed:', speechErr);
            }
        }

        const wasListening = voiceStatus === 'listening';
        if (wasListening) {
            await os2StopListening({ closing: true }).catch(() => { });
        }

        // FLU "Pensando" (Idle_1) while generating the summary — deterministic
        // per definition. Restore only if the prior state was IDLE.
        const prevState = integrationStore.conversationState;
        if (prevState !== 'THINKING') {
            integrationStore.setConversationState('THINKING');
        }
        setIsSummarizing(true);
        try {
            const result = await aiService.generateConversationSummary({ apiKey, language, role: sessionRole }, history);

            if (result) {
                const draft = createMinuteDraftFromSummary(result, sessionRole);
                setMinuteDraft(draft);
                setSelectedMinuteId('');

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
                        console.warn('[useMinuteHandlers] Summary speech failed:', speechErr);
                    }
                }

                auditLog.logEvent('summary:generated', 'summary', uuidv4(), {
                    titulo: result.titulo || '',
                    historyLength: history.length,
                }, 'Summary generated').catch(console.error);
            }
        } catch (error) {
            console.error('[useMinuteHandlers] Error generating summary:', error);
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
                os2StartListening({ resume: true }).catch(() => { });
            }
        }
    }, [apiKey, integrationStore, language, sessionRole, voiceStatus, os2StartListening, os2StopListening, auditLog, isSummarizing, setMinuteDraft, setSelectedMinuteId, getCommandSpeech]);

    // ============================================================
    // handleSaveMinute
    // ============================================================
    const handleSaveMinute = useCallback(async (draftOverride?: any, { announce = true }: { announce?: boolean } = {}) => {
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
                    console.warn('[useMinuteHandlers] GUARDAR_MINUTA speech failed:', speechErr);
                }
            }

            auditLog.logEvent('minute:saved', 'minute', persisted.id, {
                titulo: persisted.summarySnapshot.titulo || '',
            }, 'Minute saved').catch(console.error);
        } catch (error) {
            console.error('[useMinuteHandlers] Error saving minute:', error);
            auditLog.logEvent('minute:save-error', 'minute', uuidv4(), {
                error: String(error),
            }, 'Minute save failed').catch(console.error);
        }
    }, [minuteDraft, minuteKnowledge, language, sessionRole, auditLog, setMinuteDraft, setSelectedMinuteId, getCommandSpeech]);

    // ============================================================
    // handleSelectMinuteHistory
    // ============================================================
    const handleSelectMinuteHistory = useCallback((entry: any) => {
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
        handleSelectMinuteHistory,
    };
}
