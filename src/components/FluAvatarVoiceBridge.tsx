// ============================================================
// FluAvatarVoiceBridge — Componente Puente de Integración
// ============================================================
// Integra el avatar 3D (OS1) con los servicios de voz de OS2.
// NO contiene código nuevo de voz — TODO el manejo de Web Speech API,
// diarización por audio, VAD, speaker clusters, y procesamiento
// de transcripción viene del hook useFluVoiceAssistant de OS2.
//
// Flujo completo (full-duplex):
//   1. IDLE → LISTENING: useFluVoiceAssistant.startListening()
//   2. LISTENING → THINKING: useFluVoiceAssistant.processCapture()
//   3. THINKING → SPEAKING: onContractResolved → speakResponse
//   4. SPEAKING → IDLE/LISTENING: useAvatarVoiceSync monitorea fin de TTS
//
// Reactividad emocional + gestual:
//   - El avatar cambia su expresión Y reproduce animaciones corporales
//     según el sentimiento detectado en el mensaje del usuario
//   - Mapeo: positive→feliz+Jump, negative→triste+Emo, question→curioso, etc.
//
// NOTA: Las props de voz (voiceStatus, voiceError, liveTranscript, etc.)
// se reciben a través de FluBridgeContext en lugar de prop drilling.
// ============================================================

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { BunnyViewer, useBunnyStore } from '../avatar';
import type { BunnyAnimation } from '../avatar';
import { speakResponse } from '../voice/lib/fluSpeech';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { useIntegrationStore, detectSentiment } from '../store/integrationStore';
import { useAvatarVoiceSync } from '../hooks/useAvatarVoiceSync';
import { geminiService } from '../services/gemini';
import { generateResponse } from '../services/fallbackResponses';
import { WELCOME_MESSAGE } from '../core/config/appConfig';
import { relayLog } from '../lib/clientLogRelay';
import type { ConversationState } from '../types/bridge';
import { useFluBridge } from '../context/FluBridgeContext';
import { SeasonalDecoration } from '../core/branding/SeasonalDecoration';
import { useEnvironmentStore } from '../store/environmentStore';
import { getAmbiente } from '../core/environments/environmentRegistry';
import type { ResolvedCommunicationProfile } from '../core/personalization/communicationProfileService';

// -----------------------------------------------------------
// Props — mínimas, el resto viene de FluBridgeContext
// -----------------------------------------------------------
interface FluAvatarVoiceBridgeProps {
    height?: string;
    width?: string;
    /** Estado de branding para decoraciones estacionales del avatar */
    brandingMode?: 'auto' | 'manual' | 'disabled';
    brandingSeason?: string;
    brandingIsBirthday?: boolean;
    brandingCelebrandoA?: string;
    /**
     * FASE P — Personalización profunda por persona.
     * Perfil de comunicación ya resuelto para la persona del turno actual
     * (nivel de explicación + tono + ttsRate). null/undefined = sin perfil.
     */
    communicationProfile?: ResolvedCommunicationProfile | null;
    /**
     * FASE P — Resolución perezosa del perfil a partir del texto del turno.
     * Se usa cuando communicationProfile no viene pre-resuelto desde App.
     * Debe devolver null si no hay persona/participante identificable.
     */
    onResolveCommunicationProfile?: (text: string) => Promise<ResolvedCommunicationProfile | null>;
}

// -----------------------------------------------------------
// StatusOverlay — Indicador visual mínimo sobre el avatar
// Solo muestra emoción cuando no es neutral (el estado ya está en el header)
// -----------------------------------------------------------
function StatusOverlay({ state, emotion }: { state: ConversationState; emotion: string }) {
    return (
        <div className="flu-bridge-status-overlay">
            {emotion && emotion !== 'neutral' && (
                <span className="flu-bridge-status-emotion">
                    🎭 {emotion}
                </span>
            )}
        </div>
    );
}

// -----------------------------------------------------------
// useKeyboardShortcuts — Atajos de teclado
// -----------------------------------------------------------
function useKeyboardShortcuts({
    onPushToTalkStart,
    onPushToTalkEnd,
    onEscape,
    onFocusInput,
    isListening,
    isSpeaking,
    pushToTalk,
}: {
    onPushToTalkStart: () => void;
    onPushToTalkEnd: () => void;
    onEscape: () => void;
    onFocusInput: () => void;
    isListening: boolean;
    isSpeaking: boolean;
    pushToTalk: boolean;
}) {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Evitar conflictos con inputs
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                if (e.key === 'Escape') {
                    (e.target as HTMLElement).blur();
                    onEscape();
                }
                return;
            }

            if (pushToTalk && (e.key === ' ' || e.code === 'Space')) {
                e.preventDefault();
                if (!isListening && !isSpeaking) {
                    onPushToTalkStart();
                }
                return;
            }

            if (e.key === 'Escape') {
                onEscape();
                return;
            }

            if (e.key === '/' && !isListening) {
                e.preventDefault();
                onFocusInput();
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (pushToTalk && (e.key === ' ' || e.code === 'Space')) {
                e.preventDefault();
                if (isListening) {
                    onPushToTalkEnd();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [onPushToTalkStart, onPushToTalkEnd, onEscape, onFocusInput, isListening, isSpeaking, pushToTalk]);
}

// -----------------------------------------------------------
// VoiceControls — Panel de control de voz
// -----------------------------------------------------------
interface VoiceControlsProps {
    liveTranscript: string;
    transcript: string;
}

function VoiceControls({
    liveTranscript,
    transcript,
}: VoiceControlsProps) {
    const displayText = liveTranscript || transcript || '';
    return (
        <div className="voice-controls">
            {/* Transcripción en vivo — siempre visible con scroll */}
            <div className="voice-controls__transcript">
                <div className="voice-controls__transcript-scroll">
                    <span
                        className="voice-controls__transcript-text"
                        style={{
                            color: displayText ? '#e0e0e0' : '#556',
                            fontStyle: displayText ? 'normal' : 'italic',
                        }}
                    >
                        {displayText || '\u00a0'}
                    </span>
                </div>
            </div>
        </div>
    );
}

// ============================================================
// FluAvatarVoiceBridge — Componente Principal
// ============================================================
// Este componente NO implementa Web Speech API ni procesamiento
// de voz propio. TODO viene de useFluVoiceAssistant (OS2).
//
// Responsabilidades:
//   1. Renderizar el avatar 3D (OS1) + controles de voz (UI)
//   2. Conectar useFluVoiceAssistant al integrationStore (OS3)
//   3. Sincronizar avatar con estado de conversación (useAvatarVoiceSync)
//   4. Manejar input manual de texto (handleSpeak)
//
// Las props de voz (voiceStatus, voiceError, liveTranscript, etc.)
// se obtienen de FluBridgeContext en lugar de props directas.
// ============================================================
export function FluAvatarVoiceBridge({
    height = '100%',
    width = '100%',
    brandingMode,
    brandingSeason,
    brandingIsBirthday,
    brandingCelebrandoA,
    communicationProfile,
    onResolveCommunicationProfile,
}: FluAvatarVoiceBridgeProps) {
    const integrationStore = useIntegrationStore();
    // Ambiente activo (rebranding por oficio): decoración con precedencia sobre la estacional
    const activeAmbienteId = useEnvironmentStore((s) => s.activeAmbienteId);
    const activeAmbiente = activeAmbienteId ? getAmbiente(activeAmbienteId) : null;
    const environmentDecoration = activeAmbiente?.tema.decoracion ?? null;
    const storeRef = useRef(integrationStore);
    // Keep storeRef current without triggering re-renders
    storeRef.current = integrationStore;
    const [isListening, setIsListening] = useState(false);
    const welcomeSpokenRef = useRef(false);
    // Ref para detectar transiciones de voiceError (evitar re-disparar en cada re-render)
    const prevVoiceErrorRef = useRef<string | null | undefined>(null);
    // Usar el hook de sincronización avatar-voz
    const { syncAvatarToState, applyEmotion, triggerParticipantEmotion, applyContextualEmotion, pendingEmotionAnimsRef } = useAvatarVoiceSync();

    // ---- Obtener voice props desde FluBridgeContext ----
    const bridge = useFluBridge();
    const {
        voiceStatus,
        voiceError,
        liveTranscript,
        onStartListening,
        onStopListening,
        onToggleListening,
        onParticipantEmotionRef,
        onContextualEmotionRef,
        onEmotionAnimsRef,
        apiKey,
        language,
        welcomeMessage,
        onStateChange,
        onGeminiError,
    } = bridge;

    // Exponer triggerParticipantEmotion a App.tsx vía ref
    useEffect(() => {
        if (onParticipantEmotionRef) {
            onParticipantEmotionRef.current = triggerParticipantEmotion;
        }
        return () => {
            if (onParticipantEmotionRef) {
                onParticipantEmotionRef.current = null;
            }
        };
    }, [triggerParticipantEmotion, onParticipantEmotionRef]);

    // Exponer applyContextualEmotion a App.tsx vía ref (para usarlo en onContractResolved)
    useEffect(() => {
        if (onContextualEmotionRef) {
            onContextualEmotionRef.current = applyContextualEmotion;
        }
        return () => {
            if (onContextualEmotionRef) {
                onContextualEmotionRef.current = null;
            }
        };
    }, [applyContextualEmotion, onContextualEmotionRef]);

    // Exponer pendingEmotionAnimsRef a App.tsx vía ref (Fase 7: callback directo)
    // Reemplaza el mecanismo anterior basado en integrationStore.uiState.pendingEmotionAnims.
    // App.tsx escribe directamente en este ref: onEmotionAnimsRef.current = resolvedAnims;
    useEffect(() => {
        if (onEmotionAnimsRef) {
            onEmotionAnimsRef.current = (anims: string[]) => {
                pendingEmotionAnimsRef.current = anims;
            };
        }
        return () => {
            if (onEmotionAnimsRef) {
                onEmotionAnimsRef.current = null;
            }
        };
    }, [onEmotionAnimsRef, pendingEmotionAnimsRef]);

    // -------------------------------------------------------
    // NOTA: useFluVoiceAssistant se instancia en App.tsx (padre).
    // Los valores se reciben a través de FluBridgeContext:
    //   - voiceStatus, voiceError, liveTranscript
    //   - onStartListening, onStopListening, onToggleListening
    //
    // VoiceAssistantBar también recibe valores reales del hook
    // (listeningAck, isSupported, fluParticipantPresentation, etc.)
    // directamente desde App.tsx — eliminando hardcodes.
    // -------------------------------------------------------

    // -------------------------------------------------------
    // Sincronizar isListening con el estado de voz
    // -------------------------------------------------------
    useEffect(() => {
        const isOs2Listening = voiceStatus === 'listening';
        setIsListening(isOs2Listening);
        if (isOs2Listening) {
            storeRef.current.setConversationState('LISTENING');
            storeRef.current.setMicActive(true);
        }
    }, [voiceStatus]);

    // -------------------------------------------------------
    // Sincronizar liveTranscript al store
    // -------------------------------------------------------
    useEffect(() => {
        if (liveTranscript) {
            storeRef.current.setCurrentTranscript(liveTranscript);
        }
    }, [liveTranscript]);

    // -------------------------------------------------------
    // Sincronizar errores al store
    // -------------------------------------------------------
    useEffect(() => {
        // Solo reaccionar a un NUEVO error (transición), no en cada re-render con el
        // mismo error persistente (onGeminiError cambia de referencia en cada render de App).
        if (voiceError && prevVoiceErrorRef.current !== voiceError) {
            storeRef.current.setConversationState('ERROR');
            storeRef.current.pushBridgeEvent({ type: 'error', timestamp: Date.now(), payload: voiceError });
            onGeminiError?.(voiceError);
        }
        prevVoiceErrorRef.current = voiceError;
    }, [voiceError, onGeminiError]);

    // -------------------------------------------------------
    // handleStartListening — delegar a prop
    // -------------------------------------------------------
    const handleStartListening = useCallback(async () => {
        await onStartListening?.();
    }, [onStartListening]);

    // -------------------------------------------------------
    // handleStopListening — delegar a prop
    // -------------------------------------------------------
    const handleStopListening = useCallback(async () => {
        await onStopListening?.({ closing: true });
    }, [onStopListening]);

    const handleSpeak = useCallback((text: string) => {
        const store = storeRef.current;
        const botName = store.config.personality.name || 'FLU';
        // User typed text manually — add to history first (not from speech recognition)
        store.addUserMessage(text, botName);
        store.setConversationState('THINKING');
        // Indicador visual de procesamiento (se apaga en el finally de processText)
        store.setThinking(true);
        store.pushBridgeEvent({ type: 'thinking:start', timestamp: Date.now() });

        // DATA-DRIVEN: aplicar expresión contextual basada en sentimiento del usuario
        // Crea un arco emocional natural: usuario dice algo positivo → FLU reacciona feliz
        // Usa el EmotionEngine (resolveContextualExpression) — NO hay switch hardcodeado
        const sentiment = detectSentiment(text);
        applyContextualEmotion(sentiment);

        // Use Gemini if apiKey is available, otherwise use local response
        const processText = async () => {
            try {
                let responseText = '';
                let geminiEmocion: string | undefined;
                let geminiAnimacion: string | undefined;
                const hasStoredApiKey = (() => {
                    try {
                        return Boolean(String(localStorage.getItem('flu-text-api-key') ?? '').trim());
                    } catch { return false; }
                })();
                // Key resuelta: prop de React o lectura fresca de localStorage
                // (defiende contra desync prop↔storage — Fix "API key no configurada")
                const resolvedApiKey = String(
                    apiKey ||
                    (() => {
                        try { return localStorage.getItem('flu-text-api-key') ?? ''; } catch { return ''; }
                    })()
                ).trim();
                // FASE P — Personalización profunda por persona:
                // Perfil de comunicación (nivel de explicación + tono + ttsRate).
                // Se resuelve ANTES de generar el contrato para poder inyectar
                // explanationLevel/tone en el prompt y aplicar el multiplicador TTS.
                // Regla: usa el perfil pre-resuelto si viene; si no, inténtalo
                // desde el texto (tolerante a fallos: sin perfil → comportamiento actual).
                let resolvedProfile: ResolvedCommunicationProfile | null = communicationProfile ?? null;
                if (!resolvedProfile && typeof onResolveCommunicationProfile === 'function') {
                    try {
                        resolvedProfile = await onResolveCommunicationProfile(text);
                    } catch (profileError) {
                        console.warn('[Bridge] No se pudo resolver el perfil de comunicación:', profileError);
                    }
                }
                const explanationLevel = resolvedProfile?.explanationLevel ?? '';
                const profileTone = resolvedProfile?.tone ?? '';
                // Multiplicador TTS: speakSingleChunk REEMPLAZA utterance.rate con el
                // override (no lo multiplica), así que combinamos la velocidad global
                // del usuario con el factor del perfil. Sin perfil → sin override (la
                // velocidad global de la store se aplica de forma natural).
                const baseRate = integrationStore.voiceConfig?.rate ?? 1;
                if (resolvedApiKey) {
                    try {
                        const personality = store.config.personality;
                        const contract = await geminiService.generateFluContract(
                            {
                                apiKey: resolvedApiKey,
                                language,
                                role: personality.profile,
                                theme: '',
                                traits: personality.traits,
                                tone: profileTone || personality.tone,
                                explanationLevel,
                            },
                            text,
                            store.conversationHistory.map((e) => ({
                                role: e.speakerName === personality.name ? 'assistant' : 'user',
                                text: e.text || '',
                                speakerName: e.speakerName,
                            })),
                        );
                        responseText = contract.respuesta_voz;
                        // Extraer animación/emoción del contrato para pasarlas al avatar
                        geminiEmocion = contract.emocion;
                        geminiAnimacion = contract.animacion;
                    } catch (geminiError: any) {
                        const errorMsg = geminiError?.message || String(geminiError);
                        console.warn('[Bridge] Gemini error, falling back to local response:', errorMsg);
                        onGeminiError?.(errorMsg);
                        responseText = generateResponse(text, store.config.personality.name, store.conversationHistory, language);
                    }
                } else {
                    responseText = generateResponse(text, store.config.personality.name, store.conversationHistory, language);
                }

                // CRÍTICO: NO aplicar animaciones de emoción durante THINKING.
                // Hacerlo cambia currentAnimation y blendQueue, disparando una
                // recarga completa de BunnyViewer (limpieza de huesos + recarga
                // de FBX). Si luego cambiamos a SPEAKING, se dispara OTRA recarga,
                // causando doble recarga en rápida sucesión → corrupción de
                // Three.js → WebGL context loss → pantalla negra.
                //
                // Flujo correcto: ir directo a SPEAKING para que BunnyViewer
                // cargue UNA SOLA VEZ Idle_2 + MouthMove.
                const emotionLabel = geminiEmocion || geminiAnimacion || '';
                const isSpeakingExpression = emotionLabel === 'hablando' || emotionLabel === 'hablando2';
                relayLog('LOG', 'FluBridge', `handleSpeak: emotionLabel="${emotionLabel}", geminiEmocion="${geminiEmocion}", geminiAnimacion="${geminiAnimacion}" — yendo directo a SPEAKING`);

                store.setLastResponse(responseText);
                store.addFluMessage(responseText);

                // Ir directo a SPEAKING — syncAvatarToState aplicará
                // setExpression hablando/etc., que resuelve las animaciones del habla.
                // Una sola recarga de BunnyViewer, sin doble carga.
                store.setConversationState('SPEAKING');
                store.setFluSpeaking(true);
                store.incrementInteractionCount();
                store.pushBridgeEvent({ type: 'speaking:start', timestamp: Date.now() });

                await speakResponse(
                    responseText,
                    language,
                    resolvedProfile ? { rate: baseRate * resolvedProfile.ttsRate } : undefined,
                );

                // Transición de estado: SPEAKING → IDLE después de terminar de hablar
                // Esto asegura que la animación de boca (MouthMove) se detenga
                // y el avatar vuelva a su estado de reposo natural
                store.setConversationState('IDLE');
                store.setFluSpeaking(false);
                store.pushBridgeEvent({ type: 'speaking:end', timestamp: Date.now() });
            } catch (error) {
                console.error('[Bridge] Error:', error);
                store.setConversationState('ERROR');
                store.pushBridgeEvent({ type: 'error', timestamp: Date.now(), payload: error });
            } finally {
                // Apagar el indicador de procesamiento SIEMPRE (éxito o error)
                store.setThinking(false);
            }
        };

        processText();
    }, [apiKey, language, applyContextualEmotion, onGeminiError, pendingEmotionAnimsRef, communicationProfile, onResolveCommunicationProfile]);

    // -------------------------------------------------------
    // Push-to-talk: iniciar escucha
    // -------------------------------------------------------
    const handlePushToTalkStart = useCallback(() => {
        handleStartListening();
    }, [handleStartListening]);

    // -------------------------------------------------------
    // Push-to-talk: detener escucha
    // -------------------------------------------------------
    const handlePushToTalkEnd = useCallback(() => {
        handleStopListening();
    }, [handleStopListening]);

    // -------------------------------------------------------
    // Escape: detener escucha
    // -------------------------------------------------------
    const handleEscape = useCallback(() => {
        if (isListening) {
            handleStopListening();
        }
    }, [isListening, handleStopListening]);

    // -------------------------------------------------------
    // Atajos de teclado
    // -------------------------------------------------------
    useKeyboardShortcuts({
        onPushToTalkStart: handlePushToTalkStart,
        onPushToTalkEnd: handlePushToTalkEnd,
        onEscape: handleEscape,
        onFocusInput: () => { },
        isListening,
        isSpeaking: integrationStore.conversationState === 'SPEAKING',
        pushToTalk: false,
    });

    // -------------------------------------------------------
    // Ref para isListening (para useEffects que no deben depender de él)
    // -------------------------------------------------------
    const isListeningRef = useRef(isListening);
    isListeningRef.current = isListening;

    // -------------------------------------------------------
    // Consumir comandos de voz desde VoiceAssistantBar
    // -------------------------------------------------------
    useEffect(() => {
        const cmd = integrationStore.uiState.voiceCommand;
        if (!cmd) return;

        // Consumir el comando (resetear a null)
        integrationStore.consumeVoiceCommand();

        const langKey = typeof language === 'string' && language.startsWith('en') ? 'en' : 'es';

        switch (cmd) {
            case 'start-listening':
                onStartListening?.();
                speakResponse(FLU_CONFIG.ui.commandSpeech.ABRIR_ESCUCHA[langKey] || FLU_CONFIG.ui.commandSpeech.ABRIR_ESCUCHA.es, language).catch(() => { });
                break;
            case 'stop-listening':
                onStopListening?.({ closing: true });
                speakResponse(FLU_CONFIG.ui.commandSpeech.CERRAR_ESCUCHA[langKey] || FLU_CONFIG.ui.commandSpeech.CERRAR_ESCUCHA.es, language).catch(() => { });
                break;
            case 'toggle-listening':
                if (isListeningRef.current) {
                    onStopListening?.({ closing: true });
                    speakResponse(FLU_CONFIG.ui.commandSpeech.CERRAR_ESCUCHA[langKey] || FLU_CONFIG.ui.commandSpeech.CERRAR_ESCUCHA.es, language).catch(() => { });
                } else {
                    onStartListening?.();
                    speakResponse(FLU_CONFIG.ui.commandSpeech.ABRIR_ESCUCHA[langKey] || FLU_CONFIG.ui.commandSpeech.ABRIR_ESCUCHA.es, language).catch(() => { });
                }
                break;
            case 'start-conversation':
                if (!isListeningRef.current) {
                    onStartListening?.();
                }
                const iniciarText = FLU_CONFIG.ui.commandSpeech.INICIAR_CONVERSACION?.[langKey] || FLU_CONFIG.ui.commandSpeech.INICIAR_CONVERSACION?.es || 'Iniciando conversación';
                speakResponse(iniciarText, language).catch(() => { });
                break;
            case 'process-transcript':
                // Procesar el transcript actual (desde "Flu participa")
                const transcript = integrationStore.currentTranscript;
                if (transcript && transcript.trim()) {
                    handleSpeak(transcript);
                } else {
                    const emptyText = FLU_CONFIG.ui.commandSpeech.FLU_ADELANTE_EMPTY[langKey] || FLU_CONFIG.ui.commandSpeech.FLU_ADELANTE_EMPTY.es;
                    speakResponse(emptyText, language).catch(() => { });
                }
                break;
        }
    }, [integrationStore.uiState.voiceCommand]); // eslint-disable-line react-hooks/exhaustive-deps

    // -------------------------------------------------------
    // Notificar cambios de estado
    // -------------------------------------------------------
    useEffect(() => {
        onStateChange?.(integrationStore.conversationState);
    }, [integrationStore.conversationState, onStateChange]);

    // -------------------------------------------------------
    // Render
    // -------------------------------------------------------
    return (
        <div className="flu-bridge-container" style={{ width, height }}>
            {/* SeasonalDecoration — decoración 3D + señales/animaciones de celebración.
                La visibilidad de la gorra/pelo la controla ÚNICAMENTE el perfil
                (useAvatarVoiceSync → imageConfig). */}
            {(brandingMode && brandingSeason) || environmentDecoration ? (
                <SeasonalDecoration
                    mode={brandingMode ?? 'disabled'}
                    activeSeason={brandingSeason ?? ''}
                    isBirthday={brandingIsBirthday ?? false}
                    celebrandoA={brandingCelebrandoA}
                    environmentDecoration={environmentDecoration}
                />
            ) : null}

            {/* Contenedor del avatar 3D */}
            <div className="flu-bridge-avatar-area">
                <BunnyViewer orientation={integrationStore.advancedConfig?.orientation ?? 0.525} />
                {/* StatusOverlay removed: the expression chip is now in the app header (App.tsx)
                    next to ESCUCHANDO (OS2 parity: single source of truth for visual state). */}
            </div>

            {/* VoiceControls — Transcript display only (OS2 parity: live transcript from useFluVoiceAssistant) */}
            <VoiceControls
                liveTranscript={liveTranscript || ''}
                transcript={integrationStore.currentTranscript}
            />

        </div>
    );
}
