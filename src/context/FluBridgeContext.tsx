// ============================================================
// FluBridgeContext — Contexto React para Props del Bridge
// ============================================================
// Fase 6 del plan de mejora arquitectónica.
// Elimina el prop drilling de ~20 props desde App.tsx hacia
// FluAvatarVoiceBridge.tsx agrupándolas en un contexto React.
//
// Props agrupadas:
//   - Voice state: voiceStatus, voiceError, liveTranscript
//   - Voice actions: onStartListening, onStopListening, onToggleListening
//   - Bridge refs: onParticipantEmotionRef, onContextualEmotionRef
//   - Config: apiKey, language, welcomeMessage
//   - Callbacks: onStateChange, onFluParticipa, onWorkspaceImage, onGeminiError
// ============================================================

import React, { createContext, useContext, useMemo } from 'react';
import type { ConversationState } from '../types/bridge';

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------
export interface FluBridgeContextValue {
    // Voice state from useFluVoiceAssistant (OS2)
    voiceStatus?: string;
    voiceError?: string | null;
    liveTranscript?: string;
    /** Última frase completa confirmada por el hook (fuente canónica compartida
        con la bitácora — regla: burbuja y transcripción muestran lo mismo). */
    lastTranscript?: string;

    // Voice actions
    onStartListening?: () => Promise<void>;
    onStopListening?: (opts?: { closing?: boolean }) => Promise<void>;
    onToggleListening?: () => Promise<void>;

    // Bridge refs for emotion/participant sync
    onParticipantEmotionRef?: React.MutableRefObject<((event: 'granted' | 'ignored' | 'rejected' | 'raised') => void) | null>;
    onContextualEmotionRef?: React.MutableRefObject<((sentiment: 'positive' | 'negative' | 'neutral' | 'question' | undefined) => void) | null>;
    /** Ref para recibir animaciones de emoción resueltas (reemplaza pendingEmotionAnims del store) */
    onEmotionAnimsRef?: React.MutableRefObject<((anims: string[]) => void) | null>;

    // Config
    apiKey?: string;
    language?: string;
    welcomeMessage?: string;

    // Callbacks
    onStateChange?: (state: ConversationState) => void;
    onFluParticipa?: () => void;
    onWorkspaceImage?: (imageUrl: string) => void;
    onGeminiError?: (error: string | null) => void;
}

// -----------------------------------------------------------
// Context
// -----------------------------------------------------------
const FluBridgeContext = createContext<FluBridgeContextValue | null>(null);

// -----------------------------------------------------------
// Provider
// -----------------------------------------------------------
export function FluBridgeProvider({
    children,
    value,
}: {
    children: React.ReactNode;
    value: FluBridgeContextValue;
}) {
    // Memoize to prevent unnecessary re-renders
    const ctx = useMemo(() => value, [
      value,
    ]);

    return (
        <FluBridgeContext.Provider value={ctx}>
            {children}
        </FluBridgeContext.Provider>
    );
}

// -----------------------------------------------------------
// Hook
// -----------------------------------------------------------
export function useFluBridge(): FluBridgeContextValue {
    const ctx = useContext(FluBridgeContext);
    if (!ctx) {
        // Return empty object as fallback (component can still work without context)
        return {};
    }
    return ctx;
}
