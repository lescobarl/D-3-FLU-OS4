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
import { dispatchFluEvent, FLU_EVENTS, dispatchFluSearch } from '../core/events/fluEvents';
import { resolveBrowserNavigation } from '../core/browser/browserNavigation';
import { extractReadableContent, truncateContent } from '../core/browser/browserReadability';
import { extractSiteFromPhrase, resolveSiteCandidate } from '../core/browser/browserSession';
import { extractQueryFromWebSearchPhrase } from '../voice/lib/audioMath';
import {
    applyLanguageToHost,
    resolveSearchLanguage,
    stripLanguageWords,
} from '../core/search/searchLanguage';
import type { IntegrationStore } from '../store/integrationStore';
import { buildSelfManifesto } from '../core/selfKnowledge/selfKnowledge';

/** Overrides opcionales de voz por llamada (p.ej. "grito" de victoria en juegos). */
export interface FluSpeechOptions {
    volume?: number;
    rate?: number;
    pitch?: number;
}

export interface NavigationCommands {
    speakFlu: (text: string, lang: string, opts?: FluSpeechOptions) => Promise<void>;
    clearResumeListeningTimer: () => void;
    scheduleResumeListening: (responseTextLength?: number) => void;
    handleNavigationCommand: (params: {
        navegacion: { comando: string | null; destino?: string | null; parametros?: Record<string, unknown> };
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
    const speakFlu = useCallback(async (text: string, lang: string, opts?: FluSpeechOptions) => {
        clearResumeListeningTimer();
        await os2SuspendRecognition?.();
        await speakResponse(text, lang, opts);
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
        navegacion: { comando: string | null; destino?: string | null; parametros?: Record<string, unknown> };
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
                // Guardián de voz: INICIAR_CONVERSACION solo se ejecuta si el
                // usuario lo pidió explícitamente ("iniciar conversación").
                // Una pregunta conversacional ("platícame de los autos") que la
                // IA clasifique por error como INICIAR_CONVERSACION NO debe
                // reiniciar la conversación ni hablar el comando tras responder.
                if (!userRequested) break;
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
                // Guardián de voz: solo se ejecuta si el usuario lo pidió
                // explícitamente ("cerrar escucha"). Evita que la IA cierre la
                // escucha por error tras una respuesta conversacional.
                if (!userRequested) break;
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
                // Guardián de voz: solo se ejecuta si el usuario lo pidió
                // explícitamente ("abrir escucha"). Evita que la IA abra la
                // escucha por error tras una respuesta conversacional.
                if (!userRequested) break;
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
            case 'NAVEGAR': {
                // Guardián de voz: NAVEGAR solo se ejecuta si el usuario lo pidió
                // explícitamente ("navega a wikipedia"). Una pregunta conversacional
                // ("platicame de los aviones") que la IA clasifique por error como
                // NAVEGAR NO debe disparar nada; Flu responde conversacional en App.
                if (!userRequested) break;
                const parametros = (navegacion.parametros || {}) as Record<string, any>;
                const browserCfg = (FLU_CONFIG as any).browser || {};
                const allowlist = Array.isArray(browserCfg.defaultProfile?.allowlist)
                    ? browserCfg.defaultProfile.allowlist
                    : ['wikipedia.org', 'educ.ar'];
                const siteStopwords = Array.isArray(browserCfg.siteStopwords)
                    ? browserCfg.siteStopwords
                    : [];
                // Si el sitio llegó explícito (contrato de IA: parametros.sitio/url)
                // se respeta. Si no, se extrae de la frase por voz
                // ("navega en wikipedia" → "wikipedia") y se resuelve contra la
                // allowlist ("wikipedia" → "wikipedia.org"). Así una frase natural
                // navega de verdad en vez de pasarse entera como host (%20) y
                // terminar bloqueada con "Sitio: navega%20en%20wikipedia".
                const explicitSite = String(
                    parametros.sitio || parametros.url || parametros.destino || navegacion.destino || '',
                ).trim();
                // F1 — Idioma: el idioma pedido por voz ("…en inglés") define
                // el subdominio (Wikipedia es/en) y el Accept-Language del
                // proxy. Los marcadores de idioma se quitan de la frase para
                // que no se cuelen en el candidato de sitio ("navega en
                // wikipedia en inglés" → sitio "wikipedia").
                const languageWords = browserCfg.languageWords || {};
                const languageHosts = browserCfg.languageHosts || {};
                const profileLang = String(browserCfg.defaultProfile?.language || 'es');
                const requestLang = resolveSearchLanguage(transcript, profileLang, languageWords);
                const phraseForSite = stripLanguageWords(transcript, languageWords);
                const input = resolveSiteCandidate(
                    explicitSite || extractSiteFromPhrase(phraseForSite, siteStopwords),
                    allowlist,
                );
                const scheme = String(browserCfg.allowlistScheme || 'https');
                const langInput = applyLanguageToHost(input, requestLang, languageHosts);
                const browserUi = (FLU_CONFIG as any).browser?.ui || {};
                const result = resolveBrowserNavigation(langInput, allowlist, scheme, {
                    resultTitle: browserUi.resultTitle || 'Navegación curada',
                    blockedTitle: browserUi.blockedTitle || 'Sitio no permitido',
                    invalidTitle: browserUi.invalidTitle || 'No pude entender la dirección',
                    pointSite: browserUi.pointSite || 'Sitio: ',
                    pointUrl: browserUi.pointUrl || 'URL: ',
                    pointQuery: browserUi.pointQuery || 'Búsqueda: ',
                });
                // Los resultados de navegación web viven SOLO en la pestaña
                // "Buscar" del Pizarrón (requisito del usuario), nunca en la
                // pestaña "Respuesta de Flu". NAVEGAR se unifica con BUSCAR:
                // se dispara una búsqueda web del sitio resuelto en la pestaña
                // Buscar (WorkspaceSearch), que aplica la curación de allowlist.
                const searchQuery = result.host || input || '';
                if (searchQuery) {
                    dispatchFluSearch({ query: searchQuery, lang: requestLang });
                }
                if (transcript) {
                    auditLog.logEvent('command:navegar', 'navigation', uuidv4(), {
                        speaker: speakerName || undefined,
                        transcript,
                        response: searchQuery,
                        comando: 'NAVEGAR',
                        phase,
                        url: result.url,
                        host: result.host,
                        lang: requestLang,
                    }, 'NAVEGAR command executed').catch(console.error);
                }
                if (commandSpeech) {
                    try {
                        await speakFlu(commandSpeech, resolvedLanguage);
                    } catch (speechErr) {
                        console.warn('[useNavigationCommands] NAVEGAR command speech failed:', speechErr);
                    }
                }
                scheduleResumeListening(commandSpeech?.length ?? 0);
                break;
            }
            case 'BUSCAR': {
                // Guardián de voz: BUSCAR solo se ejecuta si el usuario lo pidió
                // explícitamente ("buscá capital de Francia"). Una pregunta
                // conversacional que la IA clasifique por error como BUSCAR NO
                // debe disparar nada; Flu responde conversacional en App.
                if (!userRequested) break;
                const parametros = (navegacion.parametros || {}) as Record<string, any>;
                const browserCfg = (FLU_CONFIG as any).browser || {};
                const searchCfg = browserCfg.search || {};
                const searchUi = searchCfg.ui || {};
                // F1 — Idioma: igual que NAVEGAR, el idioma pedido por voz
                // ("…en inglés") define el idioma de la búsqueda y se quita de
                // la frase para que los marcadores no se cuelen en la consulta
                // ("buscá capital de Francia en inglés" → "capital de Francia").
                const languageWords = searchCfg.languageWords || browserCfg.languageWords || {};
                const profileLang = String(browserCfg.defaultProfile?.language || 'es');
                const requestLang = resolveSearchLanguage(transcript, profileLang, languageWords);
                const rawQuery = String(
                    parametros.consulta ||
                        parametros.query ||
                        parametros.busqueda ||
                        // Voz determinista (parametros vacíos): la consulta real es
                        // el transcript SIN el gatillo de búsqueda ("busca en la web
                        // cómo saltan los conejos" → "cómo saltan los conejos"). Así
                        // la barra de búsqueda muestra lo que se envió realmente.
                        extractQueryFromWebSearchPhrase(transcript, (FLU_CONFIG as any).voiceCommands) ||
                        '',
                ).trim();
                const query = stripLanguageWords(rawQuery, languageWords);
                if (!query) {
                    // Sin consulta → FLU anuncia la etiqueta voiceNoQuery y no
                    // se escribe nada en el Pizarrón (los resultados web viven
                    // SOLO en la pestaña Buscar).
                    const noQuerySpeech = searchUi.voiceNoQuery || '¿Qué querés que busque?';
                    if (noQuerySpeech) {
                        try {
                            await speakFlu(noQuerySpeech, resolvedLanguage);
                        } catch (speechErr) {
                            console.warn('[useNavigationCommands] BUSCAR no-query speech failed:', speechErr);
                        }
                    }
                    scheduleResumeListening(noQuerySpeech?.length ?? 0);
                    break;
                }
                // Los resultados de búsqueda web viven SOLO en la pestaña
                // "Buscar" del Pizarrón (requisito del usuario), nunca en la
                // pestaña "Respuesta de Flu". BUSCAR se unifica con NAVEGAR:
                // se dispara una búsqueda web en la pestaña Buscar
                // (WorkspaceSearch), que aplica la curación de allowlist y
                // muestra los resultados. Aquí no se hace fetch ni se escribe
                // workspaceArtifact.
                dispatchFluSearch({ query, lang: requestLang });
                if (transcript) {
                    auditLog.logEvent('command:buscar', 'navigation', uuidv4(), {
                        speaker: speakerName || undefined,
                        transcript,
                        response: query,
                        comando: 'BUSCAR',
                        phase,
                        query,
                        lang: requestLang,
                    }, 'BUSCAR command executed').catch(console.error);
                }
                if (commandSpeech) {
                    try {
                        await speakFlu(commandSpeech, resolvedLanguage);
                    } catch (speechErr) {
                        console.warn('[useNavigationCommands] BUSCAR command speech failed:', speechErr);
                    }
                }
                scheduleResumeListening(commandSpeech?.length ?? 0);
                break;
            }
            // P1-C (§1.3.4) — autoconocimiento (CONOCER_FLU): fast-path local sin
            // Gemini. FLU responde enumerando sus capacidades reales compiladas
            // desde la configuración (buildSelfManifesto, nunca hardcode).
            case 'CONOCER_FLU': {
                const manifestoLang: 'es' | 'en' = resolvedLanguage === 'en' ? 'en' : 'es';
                const manifesto = buildSelfManifesto(manifestoLang);
                if (manifesto) {
                    try {
                        await speakFlu(manifesto, resolvedLanguage);
                    } catch (speechErr) {
                        console.warn('[useNavigationCommands] CONOCER_FLU speech failed:', speechErr);
                    }
                }
                auditLog.logEvent(
                    'command:conocer_flu',
                    'navigation',
                    uuidv4(),
                    {
                        speaker: speakerName || undefined,
                        transcript,
                        response: manifesto,
                        comando: 'CONOCER_FLU',
                        phase,
                    },
                    'CONOCER_FLU command executed',
                ).catch(console.error);
                scheduleResumeListening(manifesto?.length ?? 0);
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
