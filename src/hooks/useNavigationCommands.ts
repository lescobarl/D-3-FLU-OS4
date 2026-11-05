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

import { useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { GenerationWorkspaceTipo } from '../core/config/sharedConfig';
import { deriveSearchQuery } from '../voice/api/audio'
import { COMMAND_IDS, userRequestedNavigationCommand } from '../voice/api/commands'
import { FLU_CONFIG, isSessionResetCommand } from '../voice/api/config'
import { logFluReply, setNavSettlePending } from '../voice/api/conversation'
import { registerSpeakerIdentityFromCommand } from '../voice/api/identity'
import { isSpeechBusy, speakResponse, waitForSpeechIdle } from '../voice/api/speech';
import { dispatchFluEvent, FLU_EVENTS, dispatchFluSearch, onFluSearchReady } from '../core/events/fluEvents';
import { resolveBrowserNavigation } from '../core/browser/browserNavigation';
import { extractSiteFromPhrase, resolveSiteCandidate } from '../core/browser/browserSession';
import {
    applyLanguageToHost,
    resolveSearchLanguage,
    stripLanguageWords,
} from '../core/search/searchLanguage';
import type { IntegrationStore } from '../store/integrationStore';
import { buildSelfManifesto } from '../core/selfKnowledge/selfKnowledge';
import type { AuditLogEntry } from '../core/db/fluDatabase';
import { logCaughtError } from '../lib/caughtError';

import { normalizeLang } from '../core/config/localeConfig';
import { pickText } from '../lib/uiStrings';
import type { IdentitySessionRefs } from '../app/useIdentitySessionRef';
/** Overrides opcionales de voz por llamada (p.ej. "grito" de victoria en juegos). */
export interface FluSpeechOptions {
    volume?: number;
    rate?: number;
    pitch?: number;
}

/** Contrato de auditoría usado por los comandos de navegación. */
export interface NavigationAuditLog {
    logEvent: (type: string, category: string, id: string, data: unknown, description: string) => Promise<AuditLogEntry>;
}

/**
 * Devuelve `String(primerValorVerdadero)` o `''`. Equivale a la cadena
 * `a || b || c || ''` seguida de coerción a string.
 */
function firstString(...values: unknown[]): string {
    for (const value of values) {
        if (value) return String(value);
    }
    return '';
}

/**
 * Parametros de `handleNavigationCommand`. Dueño unico del contrato: la
 * interfaz del hook y su implementacion lo importan en vez de repetirlo.
 */
export interface NavigationCommandParams {
    navegacion: { comando: string | null; destino?: string | null; parametros?: Record<string, unknown> };
    transcript: string;
    speakerName?: string;
    phase: string;
    resolvedLanguage: string;
    commandSpeech: string;
    showListeningAck?: () => void;
    integrationStore: IntegrationStore;
    auditLog: NavigationAuditLog;
    fluParticipant: { resetParticipant: () => void };
    os2ResetVoiceDisplay?: () => void;
    /** Puente de la sesion de IDENTIDAD (clusters vivos + primario): MISMA instancia
     *  que el hook de voz. */
    identitySession?: { current: IdentitySessionRefs | null } | null;
    /** Puerta única e idempotente de generación de medios (video/doc). */
    requestMedia?: (tipo: GenerationWorkspaceTipo, commandText: string) => boolean;
}

export interface NavigationCommands {
    speakFlu: (text: string, lang: string, opts?: FluSpeechOptions) => Promise<void>;
    clearResumeListeningTimer: () => void;
    scheduleResumeListening: (responseTextLength?: number) => void;
    handleNavigationCommand: (params: NavigationCommandParams) => Promise<void>;
}

export function useNavigationCommands(
    conversationActiveRef: React.MutableRefObject<boolean>,
    resumeListeningTimerRef: React.MutableRefObject<number | null>,
    os2SuspendRecognition: (() => Promise<void>) | undefined,
    os2StartListening: (opts?: { resume?: boolean }) => Promise<void>,
    voiceStatus: string,
    startConversationRef: React.MutableRefObject<
        ((options?: { announce?: boolean }) => Promise<void>) | null
    >,
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

    // DUENO UNICO del par "suspender -> reanudar" la escucha: quien habla la reanuda. La escucha
    // quedaba SUSPENDIDA cuando un llamante hablaba sin rearmarla (el saludo posterior al
    // onboarding): medido 2026-10-11 18:04 (SPEAKING -> IDLE y ningun LISTENING despues).
    const resumeAfterSpeechRef = useRef<(textLength?: number) => void>(() => {});

    // ============================================================
    // speakFlu — suspend recognition, speak, wait for idle
    // ============================================================
    const speakFlu = useCallback(async (text: string, lang: string, opts?: FluSpeechOptions) => {
        clearResumeListeningTimer();
        await os2SuspendRecognition?.();
        await speakResponse(text, lang, opts);
        // FLU es un participante: TODA locución suya queda en el historial
        // (contexto de la IA). Escritor único de la fila: `logFluReply`.
        logFluReply(text);
        await waitForSpeechIdle();
        // Reanuda la escucha SIEMPRE que la conversacion siga activa (el guard vive dentro).
        resumeAfterSpeechRef.current?.(text.length);
    }, [clearResumeListeningTimer, os2SuspendRecognition]);

    // ============================================================
    // resolveResumeAfterSpeechMs — retraso dinámico según la longitud
    // de la respuesta hablada (Fase 7): base + len * factor, con
    // clamp en [min, max] para no degradar la paridad OS2.
    // ============================================================
    const resolveResumeAfterSpeechMs = useCallback((textLength = 0): number => {
        const timing = FLU_CONFIG?.timing ?? {};
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
                    os2StartListening({ resume: true }).catch((e: unknown) => { logCaughtError('src/hooks/useNavigationCommands.ts', e) });
                }, 120);
                return;
            }
            if (voiceStatus === 'listening') return;
            os2StartListening({ resume: true }).catch((e: unknown) => { logCaughtError('src/hooks/useNavigationCommands.ts', e) });
        }, delayMs);
    }, [clearResumeListeningTimer, os2StartListening, voiceStatus, conversationActiveRef, resumeListeningTimerRef, resolveResumeAfterSpeechMs]);
    resumeAfterSpeechRef.current = scheduleResumeListening;

    // ============================================================
    // Consolidación BUSCAR — una sola ejecución por turno de voz.
    // Chrome reinicia el reconocedor y entrega el mismo comando en varias
    // revisiones (parcial → completo). Ejecutar cada una dispararía la
    // búsqueda 2+ veces; se ejecuta cuando el turno se asienta (la última
    // revisión gana).
    // ============================================================
    const pendingNavRef = useRef<{ query: string; run: () => void } | null>(null);
    const navSettleTimerRef = useRef<number | null>(null);

    /** Limpia timer y bandera del asentamiento de navegación (dueño único). */
    const clearNavSettle = useCallback(() => {
        if (navSettleTimerRef.current !== null) {
            window.clearTimeout(navSettleTimerRef.current);
            navSettleTimerRef.current = null;
        }
        pendingNavRef.current = null;
        setNavSettlePending(false);
    }, []);

    const flushNavSettle = useCallback(() => {
        const pending = pendingNavRef.current;
        clearNavSettle();
        if (pending) pending.run();
    }, [clearNavSettle]);

    const scheduleNavSettle = useCallback((query: string, run: () => void) => {
        if (typeof window === 'undefined') {
            run();
            return;
        }
        const prev = pendingNavRef.current;
        // Misma emisión (una extiende a la otra): reemplazar sin ejecutar el parcial.
        const related = prev !== null && (query.startsWith(prev.query) || prev.query.startsWith(query));
        if (prev && !related) {
            // Búsqueda distinta ya pendiente: ejecutarla antes de encolar la nueva.
            flushNavSettle();
        }
        pendingNavRef.current = { query, run };
        if (navSettleTimerRef.current !== null) {
            window.clearTimeout(navSettleTimerRef.current);
            navSettleTimerRef.current = null;
        }
        // Marca global: hay corrección parcial→completo en vuelo. El dedup de
        // capturas no debe descartar el superconjunto entrante.
        const settleMs = Number(FLU_CONFIG?.timing?.searchCommandSettleMs) || 2800;
        // La bandera lleva el MISMO plazo que el temporizador: si el temporizador se
        // retrasa, vence y NO deja el pipeline congelado (defecto del dueno 2026-10-12).
        setNavSettlePending(true, settleMs);
        navSettleTimerRef.current = window.setTimeout(() => {
            navSettleTimerRef.current = null;
            const pending = pendingNavRef.current;
            pendingNavRef.current = null;
            setNavSettlePending(false);
            if (pending) pending.run();
        }, settleMs);
    }, [flushNavSettle]);

    // Limpieza del timer de asentamiento al desmontar. También se limpia la
    // bandera global: antes se borraba el timer sin apagarla y quedaba pegada.
    useEffect(() => clearNavSettle, [clearNavSettle]);

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
        requestMedia,
        identitySession,
    }: NavigationCommandParams) => {
        if (!navegacion.comando) return;

        const isResetCmd = isSessionResetCommand(navegacion.comando);
        const userRequested = userRequestedNavigationCommand(transcript, navegacion.comando);

        /** Registra un evento de navegación con el contexto de log común. */
        const logCommand = (action: string, label: string, datos: Record<string, unknown>): void => {
            auditLog.logEvent(action, 'navigation', uuidv4(), datos, label)
                .catch((e) => logCaughtError('src/hooks/useNavigationCommands.ts: auditLog.logEvent', e));
        };

        /** Habla una locución de comando y registra el fallo con su contexto. */
        const speakCommand = async (speech: string | undefined, contexto: string): Promise<void> => {
            if (!speech) return;
            try {
                await speakFlu(speech, resolvedLanguage);
            } catch (speechErr) {
                logCaughtError(contexto, speechErr);
            }
        };

        /** Reinicia la respuesta y la visualización de voz (dueño único). */
        const resetVoiceDisplay = (): void => {
            integrationStore.setLastResponse('');
            os2ResetVoiceDisplay?.();
        };

        /**
         * Registra el comando (si trae datos), habla su respuesta y reanuda la
         * escucha. Con `esperar` aguarda la locución (órdenes de medios); sin él
         * la deja en segundo plano (navegación). Dueño único de esa secuencia.
         */
        const registrarYHablar = async (
            registro: { action: string; label: string; datos: Record<string, unknown> } | null,
            speech?: string,
            opciones: { esperar?: boolean; contexto?: string } = {},
        ): Promise<void> => {
            if (registro) {
                auditLog.logEvent(registro.action, 'navigation', uuidv4(), registro.datos, registro.label)
                    .catch((e) => logCaughtError('src/hooks/useNavigationCommands.ts: auditLog.logEvent', e));
            }
            if (speech) {
                if (opciones.esperar) {
                    await speakCommand(speech, opciones.contexto || '[useNavigationCommands] speakFlu');
                } else {
                    speakFlu(speech, resolvedLanguage).catch((e) => logCaughtError('src/hooks/useNavigationCommands.ts: speakFlu', e));
                }
            }
            scheduleResumeListening(speech?.length ?? 0);
        };

        switch (navegacion.comando) {
            // RUTA UNICA del registro de nombre propio (A1): el MISMO dueno que la
            // ruta `wake-intro` del commit (`registerSpeakerIdentity`). Antes el comando
            // no tenia consumidor: FLU decia "Registrado {name}." y NO registraba nada
            // (el registro solo ocurria como efecto colateral del commit del stream).
            case COMMAND_IDS.REGISTRAR_PARTICIPANTE: {
                const sesionIdentidad = identitySession?.current || null;
                const registrado = registerSpeakerIdentityFromCommand({
                    transcript,
                    speakerName: speakerName || '',
                    // La VOZ que dice el nombre es la del TURNO: su timbre medido lo ata a ESA
                    // voz (no a la etiqueta heredada ni a la continuidad). Sin esta firma el
                    // nombre quedaba en la clave de la etiqueta y solo cambiaba la ultima
                    // intervencion (defecto medido por el dueno 2026-10-18).
                    signatureVector: sesionIdentidad?.getLastTurnSignature?.() || null,
                    clusters: sesionIdentidad?.speakerClustersRef?.current || [],
                    refs: {
                        sessionPrimarySpeakerRef: sesionIdentidad?.sessionPrimarySpeakerRef,
                        setClusters: sesionIdentidad?.setClusters,
                        // El nombre dicho por VOZ entra en la base de participantes: si esta
                        // en la base, se ve en la seccion de participantes (punto del dueno).
                        registerParticipant: sesionIdentidad?.registerParticipant,
                    },
                });
                logCommand('command:registrar_participante', 'REGISTRAR_PARTICIPANTE command executed', {
                    speaker: registrado.name || speakerName || undefined,
                    transcript,
                    response: commandSpeech,
                    comando: COMMAND_IDS.REGISTRAR_PARTICIPANTE,
                    phase,
                });
                break;
            }
            case COMMAND_IDS.GENERAR_RESUMEN:
                dispatchFluEvent(FLU_EVENTS.GENERATE_SUMMARY);
                break;
            case COMMAND_IDS.GUARDAR_MINUTA:
                dispatchFluEvent(FLU_EVENTS.SAVE_MINUTE);
                break;
            case COMMAND_IDS.ANALIZAR_DOCUMENTO: {
                dispatchFluEvent(FLU_EVENTS.ANALYZE_DOCUMENT);
                await registrarYHablar(
                    transcript ? {
                        action: 'command:analizar_documento',
                        label: 'ANALIZAR_DOCUMENTO command executed',
                        datos: {
                            speaker: speakerName || undefined,
                            transcript,
                            response: '',
                            comando: COMMAND_IDS.ANALIZAR_DOCUMENTO,
                            phase,
                        },
                    } : null,
                    commandSpeech,
                    { esperar: true, contexto: '[useNavigationCommands] ANALIZAR_DOCUMENTO command speech failed' },
                );
                break;
            }
            case COMMAND_IDS.ANALIZAR_APP: {
                dispatchFluEvent(FLU_EVENTS.ANALYZE_APP);
                await registrarYHablar(
                    transcript ? {
                        action: 'command:analizar_app',
                        label: 'ANALIZAR_APP command executed',
                        datos: {
                            speaker: speakerName || undefined,
                            transcript,
                            response: '',
                            comando: COMMAND_IDS.ANALIZAR_APP,
                            phase,
                        },
                    } : null,
                    commandSpeech,
                    { esperar: true, contexto: '[useNavigationCommands] ANALIZAR_APP command speech failed' },
                );
                break;
            }
            case COMMAND_IDS.GENERAR_DOCUMENTO: {
                // RUTA ÚNICA: la puerta idempotente que provee App.
                requestMedia?.('doc', transcript);
                await registrarYHablar(
                    transcript ? {
                        action: 'command:generar_documento',
                        label: 'GENERAR_DOCUMENTO command executed',
                        datos: {
                            speaker: speakerName || undefined,
                            transcript,
                            response: '',
                            comando: COMMAND_IDS.GENERAR_DOCUMENTO,
                            phase,
                        },
                    } : null,
                    commandSpeech,
                    { esperar: true, contexto: '[useNavigationCommands] GENERAR_DOCUMENTO command speech failed' },
                );
                break;
            }
            case COMMAND_IDS.GENERAR_VIDEO: {
                // RUTA ÚNICA: la puerta idempotente que provee App.
                requestMedia?.('video', transcript);
                await registrarYHablar(
                    transcript ? {
                        action: 'command:generar_video',
                        label: 'GENERAR_VIDEO command executed',
                        datos: {
                            speaker: speakerName || undefined,
                            transcript,
                            response: '',
                            comando: COMMAND_IDS.GENERAR_VIDEO,
                            phase,
                        },
                    } : null,
                    commandSpeech,
                    { esperar: true, contexto: '[useNavigationCommands] GENERAR_VIDEO command speech failed' },
                );
                break;
            }
            case COMMAND_IDS.FLU_WAKE: {
                showListeningAck?.();
                await speakCommand(commandSpeech, '[useNavigationCommands] FLU_WAKE command speech failed');
                if (transcript) {
                    logCommand('command:flu_wake', 'FLU_WAKE command executed', {
                        speaker: speakerName || undefined,
                        transcript,
                        response: commandSpeech || '',
                        comando: COMMAND_IDS.FLU_WAKE,
                        phase,
                    });
                }
                scheduleResumeListening(commandSpeech?.length ?? 0);
                break;
            }
            case FLU_CONFIG.navigation.sessionResetCommand: {
                // Guardián de voz: INICIAR_CONVERSACION solo se ejecuta si el
                // usuario lo pidió explícitamente ("iniciar conversación").
                // Una pregunta conversacional ("platícame de los autos") que la
                // IA clasifique por error como INICIAR_CONVERSACION NO debe
                // reiniciar la conversación ni hablar el comando tras responder.
                if (!userRequested) break;
                fluParticipant.resetParticipant();
                await speakCommand(commandSpeech, '[useNavigationCommands] INICIAR_CONVERSACION command speech failed');
                // UN dueno: App.handleStartConversation hace reset + audit + modo + escucha.
                if (isResetCmd) {
                    await startConversationRef.current?.({ announce: false });
                }
                if (transcript) {
                    logCommand('command:iniciar_conversacion', 'INICIAR_CONVERSACION command executed', {
                        speaker: speakerName || undefined,
                        transcript,
                        response: commandSpeech || '',
                        comando: FLU_CONFIG.navigation.sessionResetCommand,
                        phase,
                    });
                }
                break;
            }
            case COMMAND_IDS.CERRAR_ESCUCHA: {
                // Guardián de voz: solo se ejecuta si el usuario lo pidió
                // explícitamente ("cerrar escucha"). Evita que la IA cierre la
                // escucha por error tras una respuesta conversacional.
                if (!userRequested) break;
                conversationActiveRef.current = false;
                await speakCommand(commandSpeech, '[useNavigationCommands] CERRAR_ESCUCHA command speech failed');
                if (transcript) {
                    logCommand('command:cerrar_escucha', 'CERRAR_ESCUCHA command executed', {
                        speaker: speakerName || undefined,
                        transcript,
                        response: '',
                        comando: COMMAND_IDS.CERRAR_ESCUCHA,
                        phase,
                    });
                }
                resetVoiceDisplay();
                break;
            }
            case COMMAND_IDS.ABRIR_ESCUCHA: {
                // Guardián de voz: solo se ejecuta si el usuario lo pidió
                // explícitamente ("abrir escucha"). Evita que la IA abra la
                // escucha por error tras una respuesta conversacional.
                if (!userRequested) break;
                conversationActiveRef.current = true;
                if (commandSpeech) {
                    await speakFlu(commandSpeech, resolvedLanguage);
                }
                if (transcript) {
                    logCommand('command:abrir_escucha', 'ABRIR_ESCUCHA command executed', {
                        speaker: speakerName || undefined,
                        transcript,
                        response: '',
                        comando: COMMAND_IDS.ABRIR_ESCUCHA,
                        phase,
                    });
                }
                resetVoiceDisplay();
                break;
            }
            case COMMAND_IDS.NAVEGAR: {
                // Guardián de voz: NAVEGAR solo se ejecuta si el usuario lo pidió
                // explícitamente ("navega a wikipedia"). Una pregunta conversacional
                // ("platicame de los aviones") que la IA clasifique por error como
                // NAVEGAR NO debe disparar nada; Flu responde conversacional en App.
                if (!userRequested) break;
                const parametros: Record<string, unknown> = navegacion.parametros || {};
                const browserCfg = FLU_CONFIG.browser || {};
                const allowlist = Array.isArray(browserCfg.defaultProfile?.allowlist)
                    ? browserCfg.defaultProfile.allowlist
                    : [];
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
                const profileLang = normalizeLang(browserCfg.defaultProfile?.language);
                const requestLang = resolveSearchLanguage(transcript, profileLang, languageWords);
                const phraseForSite = stripLanguageWords(transcript, languageWords);
                const input = resolveSiteCandidate(
                    explicitSite || extractSiteFromPhrase(phraseForSite, siteStopwords),
                    allowlist,
                );
                const scheme = String(browserCfg.allowlistScheme || 'https');
                const langInput = applyLanguageToHost(input, requestLang, languageHosts);
                const browserUi = FLU_CONFIG.browser?.ui || {};
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
                // Consolidación: una sola ejecución por turno (la última revisión
                // del comando gana) — evita navegar/buscar 2 veces por los
                // reinicios del reconocedor (parcial → completo).
                scheduleNavSettle(searchQuery || transcript, () => {
                    if (searchQuery) {
                        dispatchFluSearch({ query: searchQuery, lang: requestLang });
                    }
                    void registrarYHablar(
                        transcript ? {
                            action: 'command:navegar',
                            label: 'NAVEGAR command executed',
                            datos: {
                                speaker: speakerName || undefined,
                                transcript,
                                response: searchQuery,
                                comando: COMMAND_IDS.NAVEGAR,
                                phase,
                                url: result.url,
                                host: result.host,
                                lang: requestLang,
                            },
                        } : null,
                        commandSpeech,
                    );
                });
                break;
            }
            case COMMAND_IDS.BUSCAR: {
                // Guardián de voz: BUSCAR solo se ejecuta si el usuario lo pidió
                // explícitamente ("buscá capital de Francia"). Una pregunta
                // conversacional que la IA clasifique por error como BUSCAR NO
                // debe disparar nada; Flu responde conversacional en App.
                if (!userRequested) break;
                const parametros: Record<string, unknown> = navegacion.parametros || {};
                const browserCfg = FLU_CONFIG.browser || {};
                const searchCfg = browserCfg.search || {};
                const searchUi = searchCfg.ui || {};
                // F1 — Idioma: igual que NAVEGAR, el idioma pedido por voz
                // ("…en inglés") define el idioma de la búsqueda y se quita de
                // la frase para que los marcadores no se cuelen en la consulta
                // ("buscá capital de Francia en inglés" → "capital de Francia").
                const languageWords = browserCfg.languageWords || {};
                const profileLang = normalizeLang(browserCfg.defaultProfile?.language);
                const requestLang = resolveSearchLanguage(transcript, profileLang, languageWords);
                // §9: ÚNICA derivación de la query. Toma los parámetros del LLM si
                // existen o el transcript canónico, y limpia con un solo limpiador
                // (deriveSearchQuery). Antes había dos derivadores en el mismo bloque.
                const rawQuery = deriveSearchQuery({
                    provided: firstString(parametros.consulta, parametros.query, parametros.busqueda),
                    transcript,
                    voiceCommands: FLU_CONFIG.voiceCommands,
                });
                const query = stripLanguageWords(rawQuery, languageWords);
                if (!query) {
                    // Sin consulta → FLU anuncia la etiqueta voiceNoQuery y no
                    // se escribe nada en el Pizarrón (los resultados web viven
                    // SOLO en la pestaña Buscar).
                    const noQuerySpeech = searchUi.voiceNoQuery || '¿Qué querés que busque?';
                    if (noQuerySpeech) {
                        await speakCommand(noQuerySpeech, '[useNavigationCommands] BUSCAR no-query speech failed');
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
                // Consolidación: la búsqueda se ejecuta UNA vez cuando el turno se
                // asienta (la última revisión del comando gana). Evita buscar 2
                // veces por los reinicios del reconocedor (parcial → completo).
                scheduleNavSettle(query, () => {
                    dispatchFluSearch({ query, lang: requestLang });
                    // §4: cuando los resultados ya están pintados, FLU lo dice de
                    // forma natural (no solo el acuse al buscar).
                    const offReady = onFluSearchReady(() => {
                        offReady();
                        const readyMsg =
                            ('resultsReady' in searchUi ? String(searchUi.resultsReady) : '') ||
                            (pickText(resolvedLanguage, 'listo_ya_tengo_los_resultados_los_tenes_en'));
                        speakFlu(readyMsg, resolvedLanguage).catch((e) => logCaughtError('src/hooks/useNavigationCommands.ts: speakFlu', e));
                    });
                    void registrarYHablar(
                        transcript ? {
                            action: 'command:buscar',
                            label: 'BUSCAR command executed',
                            datos: {
                                speaker: speakerName || undefined,
                                transcript,
                                response: query,
                                comando: COMMAND_IDS.BUSCAR,
                                phase,
                                query,
                                lang: requestLang,
                            },
                        } : null,
                        commandSpeech,
                    );
                });
                break;
            }
            // P1-C (§1.3.4) — autoconocimiento (CONOCER_FLU): fast-path local sin
            // Gemini. FLU responde enumerando sus capacidades reales compiladas
            // desde la configuración (buildSelfManifesto, nunca hardcode).
            case COMMAND_IDS.CONOCER_FLU: {
                const manifestoLang: 'es' | 'en' = normalizeLang(resolvedLanguage);
                const manifesto = buildSelfManifesto(manifestoLang);
                if (manifesto) {
                    await speakCommand(manifesto, '[useNavigationCommands] CONOCER_FLU speech failed');
                }
                auditLog.logEvent(
                    'command:conocer_flu',
                    'navigation',
                    uuidv4(),
                    {
                        speaker: speakerName || undefined,
                        transcript,
                        response: manifesto,
                        comando: COMMAND_IDS.CONOCER_FLU,
                        phase,
                    },
                    'CONOCER_FLU command executed',
                ).catch((e) => logCaughtError('src/hooks/useNavigationCommands.ts: auditLog.logEvent', e));
                scheduleResumeListening(manifesto?.length ?? 0);
                break;
            }
        }
    }, [speakFlu, scheduleResumeListening, conversationActiveRef, scheduleNavSettle, startConversationRef]);

    return {
        speakFlu,
        clearResumeListeningTimer,
        scheduleResumeListening,
        handleNavigationCommand,
    };
}
