// ============================================================
// FluConversationTabView — Vista presentacional de la pestaña
// "Bitácora" (Conversation tab) del panel derecho.
// ------------------------------------------------------------
// Presentacional puro: recibe por props la transcripción en vivo,
// el historial de conversación y los participantes de voz. No
// declara hooks propios ni muta estado global. Etiquetas y títulos
// salen de FLU_CONFIG (Rule #1: NO HARDCODE).
// ============================================================
import type { ComponentType } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { FluTabPanel } from '../voice/components/FluShellTabs';
import { PanelFrame } from '../voice/components/PanelFrame';
import { ConversationLog } from '../voice/components/ConversationLog';
import { VoiceProfilesPanel } from '../voice/components/VoiceProfilesPanel';

// Componentes OS2 en JS (sin declaraciones TS): cast para compatibilidad.
const ConversationLogAny = ConversationLog as ComponentType<any>;

export interface FluConversationTabViewProps {
    /** Tab activa del pizarrón (para FluTabPanel). */
    activeTab: string;
    /** Frame expandido actualmente (PanelFrame expandable). */
    expandedFrameId: string;
    /** Alterna la expansión de un frame por su id. */
    onToggleExpand: (frameId: string) => void;
    /** Transcripción en vivo del micrófono (STT). */
    liveTranscript: string;
    /** Última frase completa que FLU ejecutó (fuente canónica tras el silencio). */
    lastTranscript?: string;
    /** Transcript actual de la conversación (store). */
    currentTranscript: string;
    /**
     * Última frase completa del usuario derivada del historial (fuente única
     * canónica, calculada en App.tsx — misma que usa la burbuja del avatar).
     * Reemplaza el escaneo local duplicado: burbuja y bitácora ya no pueden divergir.
     */
    lastHeardText?: string;
    /** Historial de conversación (entradas de FLU + usuarios). */
    conversationHistory: readonly any[];
    /** Participantes de voz: label + profileId (unión historial + perfiles). */
    voiceParticipants: readonly { label: string; profileId: string | undefined }[];
    /** Renombra un perfil de voz / speaker de sesión. */
    onRenameProfile: (profileId: string, label: string) => Promise<void>;
    /** Elimina un participante de voz (perfil + historial + auditoría). */
    onRemoveParticipant: (row: any) => Promise<void>;
}

/**
 * Vista presentacional de la pestaña Conversation: frase en vivo,
 * bitácora de la conversación y panel de participantes de voz.
 */
export function FluConversationTabView({
    activeTab,
    expandedFrameId,
    onToggleExpand,
    liveTranscript,
    lastTranscript = '',
    currentTranscript,
    lastHeardText = '',
    conversationHistory,
    voiceParticipants,
    onRenameProfile,
    onRemoveParticipant,
}: FluConversationTabViewProps) {
    const ws = FLU_CONFIG.ui?.workspace || {};
    // La frase en vivo muestra el texto COMPLETO que FLU oyó (incluida la wake
    // word "ok flu"): antes se quitaba con stripWakeWordForDisplay y, al limpiar
    // liveTranscript tras ejecutar, el display quedaba sin "ok flu" o vacío
    // (Bug #4). Fuente: liveTranscript; si ya se limpió, la ÚLTIMA frase del
    // usuario del historial (que conserva la frase completa); respaldo final.
    // Fuente única de "última frase del usuario": la deriva App.tsx desde el
    // historial real (misma que alimenta la burbuja del avatar). El escaneo
    // local duplicado se eliminó para que burbuja y bitácora nunca difieran.
    const lastHeard = String(lastHeardText || '').trim();
    const livePhrase = (liveTranscript || lastTranscript || lastHeard || currentTranscript || '').trim();

    return (
        <FluTabPanel tabId="conversation" activeTab={activeTab} className="flu-tab-panel--conversation">
            <PanelFrame
                frameId={FLU_CONFIG.frames?.conversation || 'conversation'}
                title={ws.visibleLabels?.log || 'Bitácora'}
                subtitle={ws.conversationSubtitle || 'Transcripción en vivo de la conversación'}
                className="panel-frame--log"
                expandable={true}
                {...{
                    expandedFrameId,
                    onToggleExpand,
                } as any}
            >
                {/* OS3 parity: live phrase display above conversation log — sin label para ahorrar espacio */}
                <div className="conversation-live-phrase frame-content__response">
                    <div className="conversation-live-phrase__scroll">
                        <span>{livePhrase || '\u00a0'}</span>
                    </div>
                </div>
                <ConversationLogAny
                    entries={conversationHistory}
                    emptyLabel={ws.conversationEmpty || 'Sin conversación'}
                />
            </PanelFrame>

            <PanelFrame
                frameId={FLU_CONFIG.frames?.voiceProfiles || 'voiceProfiles'}
                title={ws.participantsTitle || 'Participantes'}
                className="panel-frame--participants"
                expandable={true}
                {...{
                    expandedFrameId,
                    onToggleExpand,
                } as any}
            >
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <VoiceProfilesPanel {...({
                    participants: voiceParticipants,
                    onRenameProfile,
                    onRenameSessionSpeaker: onRenameProfile,
                    onRemoveParticipant,
                } as any)} />
            </PanelFrame>
        </FluTabPanel>
    );
}

export default FluConversationTabView;
