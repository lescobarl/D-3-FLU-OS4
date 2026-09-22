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

import { useState, useCallback, useRef, useEffect } from 'react';
import { BunnyViewer } from '../avatar';
import { speakResponse } from '../voice/lib/fluSpeech';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { useIntegrationStore } from '../store/integrationStore';
import { useAvatarVoiceSync } from '../hooks/useAvatarVoiceSync';
import { useFluBridge } from '../context/FluBridgeContext';
import { SeasonalDecoration } from '../core/branding/SeasonalDecoration';
import { useEnvironmentStore } from '../store/environmentStore';
import { getAmbiente } from '../core/environments/environmentRegistry';

// -----------------------------------------------------------
// Props — mínimas, el resto viene de FluBridgeContext
// -----------------------------------------------------------
interface FluAvatarVoiceBridgeProps {
    height?: string;
    width?: string;
    /**
     * Frase visible canónica (§9.3): misma cadena que bitácora y barra.
     * La deriva App una sola vez; el avatar no recalcula.
     */
    visiblePhrase?: string;
    /** Estado de branding para decoraciones estacionales del avatar */
    brandingMode?: 'auto' | 'manual' | 'disabled';
    brandingSeason?: string;
    brandingIsBirthday?: boolean;
    brandingCelebrandoA?: string;
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
    /** Frase visible canónica (§9.3): misma cadena que bitácora y barra. */
    visiblePhrase?: string;
}

function VoiceControls({ visiblePhrase = '' }: VoiceControlsProps) {
    // §9.3: la frase visible llega ya derivada desde App (misma que bitácora y
    // barra). El avatar no vuelve a seleccionar ni normalizar.
    const displayText = String(visiblePhrase || '');
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
//
// Las props de voz (voiceStatus, voiceError, liveTranscript, etc.)
// se obtienen de FluBridgeContext en lugar de props directas.
// ============================================================
export function FluAvatarVoiceBridge({
    height = '100%',
    width = '100%',
    visiblePhrase = '',
    brandingMode,
    brandingSeason,
    brandingIsBirthday,
    brandingCelebrandoA,
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
    // Ref para detectar transiciones de voiceError (evitar re-disparar en cada re-render)
    const prevVoiceErrorRef = useRef<string | null | undefined>(null);
    // Usar el hook de sincronización avatar-voz
    const { triggerParticipantEmotion, applyContextualEmotion, pendingEmotionAnimsRef } = useAvatarVoiceSync();

    // ---- Obtener voice props desde FluBridgeContext ----
    const bridge = useFluBridge();
    const {
        voiceStatus,
        voiceError,
        liveTranscript,
        onStartListening,
        onStopListening,
        onParticipantEmotionRef,
        onContextualEmotionRef,
        onEmotionAnimsRef,
        language,
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
    // Sincronizar liveTranscript al store (espejo FIEL: set y clear).
    // Antes solo se escribía cuando liveTranscript tenía texto y el espejo
    // quedaba con un interino INCOMPLETO tras limpiar live — contaminando
    // las cadenas de display que caían al mirror. Las cadenas ya resuelven
    // con lastTranscript + historial ANTES del mirror, así que limpiarlo
    // no pierde la última frase real.
    // -------------------------------------------------------
    useEffect(() => {
        storeRef.current.setCurrentTranscript(liveTranscript || '');
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
        }
    }, [integrationStore.uiState.voiceCommand]);

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
            <VoiceControls visiblePhrase={visiblePhrase} />

        </div>
    );
}
