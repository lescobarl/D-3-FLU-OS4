// ============================================================
// useNavigationCommands — Hook para comandos de navegación
// ============================================================
// Extraído de App.tsx para reducir la carga del componente principal.
// Maneja:
//   - speakFlu: suspender reconocimiento, hablar, esperar idle
//   - clearResumeListeningTimer: limpiar timer de reanudación
//   - scheduleResumeListening: programar reanudación con retry
//   - handleNavigationCommand: manejar comando de navegación unificado
// ============================================================

import { useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { speakResponse, isSpeechBusy, waitForSpeechIdle } from '../voice/lib/fluSpeech';
import { FLU_CONFIG, isSessionResetCommand } from '../voice/lib/fluConfig';
import { userRequestedNavigationCommand } from '../voice/lib/voiceCommands';
import { dispatchFluEvent, FLU_EVENTS } from '../core/events/fluEvents';
import type { IntegrationStore } from '../store/integrationStore';

export interface NavigationCommands {
    speakFlu: (text: string, lang: string) => Promise<void>;
    clearResumeListeningTimer: () => void;
    scheduleResumeListening: (responseTextLength?: number) => void;
    handleNavigationCommand: (params: {
        navegacion: { comando: string | null };
        transcript: string;
        speakerName?: string;
        phase: string;
        resolvedLanguage: string;
        commandSpeech: string;
        showListeningAck?: () => void;
        integrationStore: IntegrationStore;
        auditLog: { logEvent: (type: string, category: string, id: string, data: any, description: string) => Promise<any> };
        fluParticipant: { resetParticipant: () => void };
        os2ResetVoiceDisplay?: () => void;
    }) => Promise<void>;
}

export function useNavigationCommands(
    conversationActiveRef: React.MutableRefObject<boolean>,
    resumeListeningTimerRef: React.MutableRefObject<number | null>,
    os2SuspendRecognition: (() => Promise<void>) | undefined,
    os2StartListening: (opts?: { resume?: boolean }) => Promise<void>,
    voiceStatus: string,
): NavigationCommands {
    // ============================================================
    // clearResumeListeningTimer
    // ============================================================
    const clearResumeListeningTimer = useCallback(() => {
        if (resumeListeningTimerRef.current !== null) {
            window.clearTimeout(resumeListeningTimerRef.current);
            resumeListeningTimerRef.current = null;
        }
    }, [resumeListeningTimerRef]);

    // ============================================================
    // speakFlu — suspend recognition, speak, wait for idle
    // ============================================================
    const speakFlu = useCallback(async (text: string, lang: string) => {
        clearResumeListeningTimer();
        await os2SuspendRecognition?.();
        await speakResponse(text, lang);
        await waitForSpeechIdle();
    }, [clearResumeListeningTimer, os2SuspendRecognition]);

    // ============================================================
    // resolveResumeAfterSpeechMs — retraso dinámico según la longitud
    // de la respuesta hablada (Fase 7): base + len * factor, con
    // clamp en [min, max] para no degradar la paridad OS2.
    // ============================================================
    const resolveResumeAfterSpeechMs = useCallback((textLength = 0): number => {
        const timing = (FLU_CONFIG as any)?.timing ?? {};
        const base = Number(timing.resumeAfterSpeechMs) || 50;
        const perChar = Number(timing.resumeAfterSpeechPerCharMs) || 0;
        const min = Number(timing.resumeAfterSpeechMinMs) || base;
        const max = Number(timing.resumeAfterSpeechMaxMs) || Math.max(min, 500);
        const raw = base + Math.max(0, textLength) * perChar;
        return Math.min(max, Math.max(min, raw));
    }, []);

    // ============================================================
    // scheduleResumeListening with retry logic
    // ============================================================
    const scheduleResumeListening = useCallback((responseTextLength?: number) => {
        if (!conversationActiveRef.current || typeof window === 'undefined') return;
        clearResumeListeningTimer();
        const delayMs = resolveResumeAfterSpeechMs(responseTextLength ?? 0);
        resumeListeningTimerRef.current = window.setTimeout(() => {
            resumeListeningTimerRef.current = null;
            if (isSpeechBusy()) {
                resumeListeningTimerRef.current = window.setTimeout(() => {
                    resumeListeningTimerRef.current = null;
                    if (isSpeechBusy()) return;
                    if (voiceStatus === 'listening') return;
                    os2StartListening({ resume: true }).catch(() => { });
                }, 120);
                return;
            }
            if (voiceStatus === 'listening') return;
            os2StartListening({ resume: true }).catch(() => { });
        }, delayMs);
    }, [clearResumeListeningTimer, os2StartListening, voiceStatus, conversationActiveRef, resumeListeningTimerRef, resolveResumeAfterSpeechMs]);

    // ============================================================
    // handleNavigationCommand — unified navigation command handler
    // ============================================================
    const handleNavigationCommand = useCallback(async ({
        navegacion,
        transcript,
        speakerName,
        phase,
        resolvedLanguage,
        commandSpeech,
        showListeningAck,
        integrationStore,
        auditLog,
        fluParticipant,
        os2ResetVoiceDisplay,
    }: {
        navegacion: { comando: string | null };
        transcript: string;
        speakerName?: string;
        phase: string;
        resolvedLanguage: string;
        commandSpeech: string;
        showListeningAck?: () => void;
        integrationStore: IntegrationStore;
        auditLog: { logEvent: (type: string, category: string, id: string, data: any, description: string) => Promise<any> };
        fluParticipant: { resetParticipant: () => void };
        os2ResetVoiceDisplay?: () => void;
    }) => {
        if (!navegacion.comando) return;

        const isResetCmd = isSessionResetCommand(navegacion.comando);
        const userRequested = userRequestedNavigationCommand(transcript, navegacion.comando);

        switch (navegacion.comando) {
            case 'GENERAR_RESUMEN':
                dispatchFluEvent(FLU_EVENTS.GENERATE_SUMMARY);
                break;
            case 'GUARDAR_MINUTA':
                dispatchFluEvent(FLU_EVENTS.SAVE_MINUTE);
                break;
            case 'ANALIZAR_DOCUMENTO': {
                dispatchFluEvent(FLU_EVENTS.ANALYZE_DOCUMENT);
                if (transcript) {
                    auditLog.logEvent('command:analizar_documento', 'navigation', uuidv4(), {
                        speaker: speakerName || undefined,
                        transcript,
                        response: '',
                        comando: 'ANALIZAR_DOCUMENTO',
                        phase,
                    }, 'ANALIZAR_DOCUMENTO command executed').catch(console.error);
                }
                if (commandSpeech) {
                    try {
                        await speakFlu(commandSpeech, resolvedLanguage);
                    } catch (speechErr) {
                        console.warn('[useNavigationCommands] ANALIZAR_DOCUMENTO command speech failed:', speechErr);
                    }
                }
                scheduleResumeListening(commandSpeech?.length ?? 0);
                break;
            }
            case 'ANALIZAR_APP': {
                dispatchFluEvent(FLU_EVENTS.ANALYZE_APP);
                if (transcript) {
                    auditLog.logEvent('command:analizar_app', 'navigation', uuidv4(), {
                        speaker: speakerName || undefined,
                        transcript,
                        response: '',
                        comando: 'ANALIZAR_APP',
                        phase,
                    }, 'ANALIZAR_APP command executed').catch(console.error);
                }
                if (commandSpeech) {
                    try {
                        await speakFlu(commandSpeech, resolvedLanguage);
                    } catch (speechErr) {
                        console.warn('[useNavigationCommands] ANALIZAR_APP command speech failed:', speechErr);
                    }
                }
                scheduleResumeListening(commandSpeech?.length ?? 0);
                break;
            }
            case 'GENERAR_DOCUMENTO': {
                dispatchFluEvent(FLU_EVENTS.GENERATE_DOCUMENT);
                if (transcript) {
                    auditLog.logEvent('command:generar_documento', 'navigation', uuidv4(), {
                        speaker: speakerName || undefined,
                        transcript,
                        response: '',
                        comando: 'GENERAR_DOCUMENTO',
                        phase,
                    }, 'GENERAR_DOCUMENTO command executed').catch(console.error);
                }
                if (commandSpeech) {
                    try {
                        await speakFlu(commandSpeech, resolvedLanguage);
                    } catch (speechErr) {
                        console.warn('[useNavigationCommands] GENERAR_DOCUMENTO command speech failed:', speechErr);
                    }
                }
                scheduleResumeListening(commandSpeech?.length ?? 0);
                break;
            }
            case 'GENERAR_VIDEO': {
                dispatchFluEvent(FLU_EVENTS.GENERATE_VIDEO);
                if (transcript) {
                    auditLog.logEvent('command:generar_video', 'navigation', uuidv4(), {
                        speaker: speakerName || undefined,
                        transcript,
                        response: '',
                        comando: 'GENERAR_VIDEO',
                        phase,
                    }, 'GENERAR_VIDEO command executed').catch(console.error);
                }
                if (commandSpeech) {
                    try {
                        await speakFlu(commandSpeech, resolvedLanguage);
                    } catch (speechErr) {
                        console.warn('[useNavigationCommands] GENERAR_VIDEO command speech failed:', speechErr);
                    }
                }
                scheduleResumeListening(commandSpeech?.length ?? 0);
                break;
            }
            case 'FLU_WAKE': {
                showListeningAck?.();
                if (commandSpeech) {
                    try {
                        await speakFlu(commandSpeech, resolvedLanguage);
                    } catch (speechErr) {
                        console.warn('[useNavigationCommands] FLU_WAKE command speech failed:', speechErr);
                    }
                }
                if (transcript) {
                    auditLog.logEvent('command:flu_wake', 'navigation', uuidv4(), {
                        speaker: speakerName || undefined,
                        transcript,
                        response: commandSpeech || '',
                        comando: 'FLU_WAKE',
                        phase,
                    }, 'FLU_WAKE command executed').catch(console.error);
                }
                scheduleResumeListening(commandSpeech?.length ?? 0);
                break;
            }
            case 'INICIAR_CONVERSACION': {
                conversationActiveRef.current = true;
                fluParticipant.resetParticipant();
                if (commandSpeech) {
                    try {
                        await speakFlu(commandSpeech, resolvedLanguage);
                    } catch (speechErr) {
                        console.warn('[useNavigationCommands] INICIAR_CONVERSACION command speech failed:', speechErr);
                    }
                }
                if (transcript) {
                    auditLog.logEvent('command:iniciar_conversacion', 'navigation', uuidv4(), {
                        speaker: speakerName || undefined,
                        transcript,
                        response: commandSpeech || '',
                        comando: 'INICIAR_CONVERSACION',
                        phase,
                    }, 'INICIAR_CONVERSACION command executed').catch(console.error);
                }
                if (isResetCmd) {
                    integrationStore.resetConversationHistory();
                }
                scheduleResumeListening(commandSpeech?.length ?? 0);
                break;
            }
            case 'CERRAR_ESCUCHA': {
                conversationActiveRef.current = false;
                if (commandSpeech) {
                    try {
                        await speakFlu(commandSpeech, resolvedLanguage);
                    } catch (speechErr) {
                        console.warn('[useNavigationCommands] CERRAR_ESCUCHA command speech failed:', speechErr);
                    }
                }
                if (transcript) {
                    auditLog.logEvent('command:cerrar_escucha', 'navigation', uuidv4(), {
                        speaker: speakerName || undefined,
                        transcript,
                        response: '',
                        comando: 'CERRAR_ESCUCHA',
                        phase,
                    }, 'CERRAR_ESCUCHA command executed').catch(console.error);
                }
                integrationStore.setLastResponse('');
                os2ResetVoiceDisplay?.();
                break;
            }
            case 'ABRIR_ESCUCHA': {
                conversationActiveRef.current = true;
                if (commandSpeech) {
                    await speakFlu(commandSpeech, resolvedLanguage);
                }
                if (transcript) {
                    auditLog.logEvent('command:abrir_escucha', 'navigation', uuidv4(), {
                        speaker: speakerName || undefined,
                        transcript,
                        response: '',
                        comando: 'ABRIR_ESCUCHA',
                        phase,
                    }, 'ABRIR_ESCUCHA command executed').catch(console.error);
                }
                integrationStore.setLastResponse('');
                os2ResetVoiceDisplay?.();
                break;
            }
        }
    }, [speakFlu, scheduleResumeListening, conversationActiveRef]);

    return {
        speakFlu,
        clearResumeListeningTimer,
        scheduleResumeListening,
        handleNavigationCommand,
    };
}
