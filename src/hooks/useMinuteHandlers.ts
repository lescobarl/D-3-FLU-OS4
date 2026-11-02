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
import { COMMAND_IDS } from '../voice/api/commands'
import { FLU_CONFIG } from '../voice/api/config'
import { speakResponse } from '../voice/api/speech';
import { buildMinuteSnapshot, createMinuteDraftFromSummary } from '../lib/minuteKnowledgeHelpers';
import type { IntegrationStore } from '../store/integrationStore';
import type { MinuteUIEntry } from './useMinuteKnowledge';
import type { AuditLogEntry, MinuteSummarySnapshot } from '../core/db/fluDatabase';
import { logCaughtError } from '../lib/caughtError';
import { resolveConfiguredTemperature } from '../services/aiTemperature';
import { resolveMinuteTutoringArea } from '../core/tutoring/tutoringModel';

/**
 * Una escritura de auditoria que falla es un sintoma secundario: se registra con
 * el evento que se intentaba escribir y no rompe el turno. Un unico sitio.
 * @param event Clave del evento de auditoria que no se pudo escribir.
 * @param e Rechazo capturado.
 */
function reportAuditWriteFailure(event: string, e: unknown): void {
    logCaughtError(`useMinuteHandlers: no se pudo escribir el evento de auditoria "${event}"`, e);
}

/** Texto de una minuta que puede nombrar su area de tutoria (P8.58). */
function minuteTutoringText(snapshot: { titulo?: string; resumen?: string; tema_sesion?: string; acuerdos?: string[]; pendientes?: string[]; siguientes_pasos?: string[] }): string {
    return [
        snapshot.titulo,
        snapshot.resumen,
        snapshot.tema_sesion,
        ...(snapshot.acuerdos || []),
        ...(snapshot.pendientes || []),
        ...(snapshot.siguientes_pasos || []),
    ]
        .filter(Boolean)
        .join(' ');
}

/** Texto de la conversacion de la sesion (para resolver de que area era). */
function conversationTextOf(history: Array<{ text?: string }> = []): string {
    return history.map((row) => row.text || '').filter(Boolean).join(' ');
}

/**
 * Etiqueta la minuta con su area de tutoria (P8.58). Devuelve un parcial que se
 * esparce en el snapshot; `{}` si la sesion no declaro un area conocida. Un solo
 * dueno de la resolucion (core/tutoring/tutoringModel).
 */
/** Practica de la sesion (P8.63): la aporta el tutor; se esparce solo si vino. */
function practicaOf(result: { practica?: { aciertos: number; errores: number } } = {}): { practica?: { aciertos: number; errores: number } } {
    return result?.practica ? { practica: result.practica } : {};
}

function withTutoringArea(
    snapshot: { titulo?: string; resumen?: string; tema_sesion?: string; acuerdos?: string[]; pendientes?: string[]; siguientes_pasos?: string[] },
    history: Array<{ text?: string }> = [],
): { tutoring_area?: string } {
    const area = resolveMinuteTutoringArea(minuteTutoringText(snapshot), conversationTextOf(history));
    return area ? { tutoring_area: area.label } : {};
}

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
            const result = await aiService.generateMinute(
                { apiKey, language, temperature: resolveConfiguredTemperature() },
                history,
                'neutral',
            );
            if (result) {
                // Build a MinuteSummarySnapshot from the Gemini result
                const snapshot = buildMinuteSnapshot(result, 'Minuta', String(result.tema_sesion || ''));
                // Add to IndexedDB via minuteKnowledge (expects MinuteSummarySnapshot)
                // C10: la publicación en integrationStore la hace el dueño de la
                // minuta (useMinuteKnowledge.addMinute); aquí NO se espeja.
                const persisted = await minuteKnowledge.addMinute({ ...snapshot, ...withTutoringArea(snapshot, history), ...practicaOf(result) });
                // OS2 parity: speak the minute title after generation
                const speechText = getCommandSpeech(COMMAND_IDS.GUARDAR_MINUTA, language);
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
                }, 'Minute generated from conversation').catch((e) => reportAuditWriteFailure('minute:generated', e));
            }
        } catch (error) {
            logCaughtError('[useMinuteHandlers] Error generating minute:', error);
            auditLog.logEvent('minute:error', 'minute', uuidv4(), {
                error: String(error),
            }, 'Minute generation failed').catch((e) => reportAuditWriteFailure('minute:error', e));
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
    /** Genera el resumen de conversación con el payload único del motor. */
    const generateSummary = useCallback(
        (history: Parameters<typeof aiService.generateConversationSummary>[1]) =>
            aiService.generateConversationSummary(
                { apiKey, language, role: sessionRole, temperature: resolveConfiguredTemperature() },
                history,
            ),
        [apiKey, language, sessionRole],
    );

    const handleGenerateSummary = useCallback(async ({ announce = false, save = false }: { announce?: boolean; save?: boolean } = {}): Promise<boolean> => {
        const history = integrationStore.conversationHistory;
        if (history.length === 0 || isSummarizing) return false;

        if (announce) {
            try {
                const speechText = getCommandSpeech(COMMAND_IDS.GENERAR_RESUMEN, language);
                if (speechText) {
                    await speakResponse(speechText, language);
                }
            } catch (speechErr) {
                logCaughtError('[useMinuteHandlers] GENERAR_RESUMEN command speech failed', speechErr);
            }
        }

        const wasListening = voiceStatus === 'listening';
        if (wasListening) {
            await os2StopListening({ closing: true }).catch((e: unknown) => { logCaughtError('src/hooks/useMinuteHandlers.ts', e) });
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
            const result = await generateSummary(history);

            if (result) {
                const draft = createMinuteDraftFromSummary(result, sessionRole);
                setMinuteDraft(draft);
                setSelectedMinuteId('');

                if (save) {
                    const snapshot = buildMinuteSnapshot(result, 'Minuta', sessionRole);
                    const persisted = await minuteKnowledge.addMinute({ ...snapshot, ...withTutoringArea(snapshot, history), ...practicaOf(result) });
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
                // `announce` gobierna TODA la locución, no sólo el aviso previo: el
                // cierre de día llama con announce:false (segundo plano) y antes la
                // minuta del día anterior se leía en voz alta al arrancar.
                if (speechText && announce) {
                    try {
                        await speakResponse(speechText, language);
                    } catch (speechErr) {
                        logCaughtError('[useMinuteHandlers] Summary speech failed', speechErr);
                    }
                }

                auditLog.logEvent('summary:generated', 'summary', uuidv4(), {
                    titulo: result.titulo || '',
                    historyLength: history.length,
                }, 'Summary generated').catch((e) => reportAuditWriteFailure('summary:generated', e));
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
            }, 'Summary generation failed').catch((e) => reportAuditWriteFailure('summary:error', e));
        } finally {
            setIsSummarizing(false);
            if (prevState === 'IDLE') {
                integrationStore.setConversationState('IDLE');
            }
            if (wasListening) {
                os2StartListening({ resume: true }).catch((e: unknown) => { logCaughtError('src/hooks/useMinuteHandlers.ts', e) });
            }
        }
        return saved;
    }, [integrationStore, minuteKnowledge, language, sessionRole, voiceStatus, os2StartListening, os2StopListening, auditLog, isSummarizing, setMinuteDraft, setSelectedMinuteId, getCommandSpeech, generateSummary]);

    // ============================================================
    // handleSaveMinute
    // ============================================================
    const handleSaveMinute = useCallback(async (draftOverride?: MinuteDraft | null, { announce = true }: { announce?: boolean } = {}) => {
        const sourceDraft = draftOverride || minuteDraft;
        if (!sourceDraft) return;
        const history = integrationStore.conversationHistory;

        try {
            // sourceDraft is a flat draft object (titulo, participantes, resumen, etc.)
            // Convert to MinuteSummarySnapshot for minuteKnowledge.addMinute
            const snapshot = buildMinuteSnapshot(sourceDraft, '', sourceDraft.tema_sesion || sessionRole);
            const persisted = await minuteKnowledge.addMinute({ ...snapshot, ...withTutoringArea(snapshot, history) });
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
            const commandSpeechText = getCommandSpeech(COMMAND_IDS.GUARDAR_MINUTA, language);
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
            }, 'Minute saved').catch((e) => reportAuditWriteFailure('minute:saved', e));
        } catch (error) {
            logCaughtError('[useMinuteHandlers] Error saving minute:', error);
            auditLog.logEvent('minute:save-error', 'minute', uuidv4(), {
                error: String(error),
            }, 'Minute save failed').catch((e) => reportAuditWriteFailure('minute:save-error', e));
        }
    }, [minuteDraft, minuteKnowledge, integrationStore, language, sessionRole, auditLog, setMinuteDraft, setSelectedMinuteId, getCommandSpeech]);

    // ============================================================
    // handleSaveConversationSummary
    // Guarda el resumen de la conversación UNA sola vez como
    // conocimiento de tipo 'conversacion' (Paso 6: memoria con kind).
    // ============================================================
    const handleSaveConversationSummary = useCallback(async ({ announce = false }: { announce?: boolean } = {}) => {
        const history = integrationStore.conversationHistory;
        if (history.length === 0) return;

        try {
            const result = await generateSummary(history);
            if (!result) return;

            const snapshot = buildMinuteSnapshot(result, 'Conversación', sessionRole);
            const persisted = await minuteKnowledge.addMinute({ ...snapshot, ...withTutoringArea(snapshot, history), ...practicaOf(result) }, { kind: 'conversacion' });

            if (announce) {
                const speechText = getCommandSpeech(COMMAND_IDS.GUARDAR_MINUTA, language);
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
            }, 'Conversation summary saved on close').catch((e) => reportAuditWriteFailure('conversation:summary-saved', e));
        } catch (error) {
            logCaughtError('[useMinuteHandlers] Error saving conversation summary:', error);
            auditLog.logEvent('conversation:summary-save-error', 'summary', uuidv4(), {
                error: String(error),
            }, 'Conversation summary save failed').catch((e) => reportAuditWriteFailure('conversation:summary-save-error', e));
        }
    }, [integrationStore, minuteKnowledge, auditLog, language, sessionRole, getCommandSpeech, generateSummary]);

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
