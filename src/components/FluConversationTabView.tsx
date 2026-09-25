// ============================================================
// FluConversationTabView — Vista presentacional de la pestaña
// "Bitácora" (Conversation tab) del panel derecho.
// ------------------------------------------------------------
// Presentacional puro: recibe por props la transcripción en vivo,
// el historial de conversación y los participantes de voz. No
// declara hooks propios ni muta estado global. Etiquetas y títulos
// salen de FLU_CONFIG (Rule #1: NO HARDCODE).
// ============================================================
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { FluTabPanel } from '../voice/components/FluShellTabs';
import { PanelFrame } from '../voice/components/PanelFrame';
import { ConversationLog } from '../voice/components/ConversationLog';
import { VoiceProfilesPanel, type VoiceProfileRow } from '../voice/components/VoiceProfilesPanel';
import type { ConversationEntry } from '../types/bridge';

export interface FluConversationTabViewProps {
    /** Tab activa del pizarrón (para FluTabPanel). */
    activeTab: string;
    /** Frame expandido actualmente (PanelFrame expandable). */
    expandedFrameId: string;
    /** Alterna la expansión de un frame por su id. */
    onToggleExpand: (frameId: string) => void;
    /**
     * Frase visible canónica (§9.3): misma cadena que burbuja del avatar y barra.
     * La deriva App (`selectVisiblePhrase`) una sola vez; la bitácora NO recalcula.
     */
    visiblePhrase: string;
    /** Historial de conversación (entradas de FLU + usuarios). */
    conversationHistory: readonly ConversationEntry[];
    /** Participantes de voz: label + profileId (unión historial + perfiles). */
    voiceParticipants: readonly { label: string; profileId: string | undefined }[];
    /** Renombra un perfil de voz / speaker de sesión. */
    onRenameProfile: (profileId: string, label: string) => Promise<void>;
    /** Elimina un participante de voz (perfil + historial + auditoría). */
    onRemoveParticipant: (row: VoiceProfileRow) => Promise<void>;
}

/**
 * Vista presentacional de la pestaña Conversation: frase en vivo,
 * bitácora de la conversación y panel de participantes de voz.
 */
export function FluConversationTabView({
    activeTab,
    expandedFrameId,
    onToggleExpand,
    visiblePhrase,
    conversationHistory,
    voiceParticipants,
    onRenameProfile,
    onRemoveParticipant,
}: FluConversationTabViewProps) {
    const ws = FLU_CONFIG.ui?.workspace || {};
    // §9.3: la frase visible llega ya derivada desde App (misma que burbuja y
    // barra). La bitácora no vuelve a seleccionar ni normalizar.
    const livePhrase = String(visiblePhrase || '');

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
                }}
            >
                {/* OS3 parity: live phrase display above conversation log — sin label para ahorrar espacio */}
                <div className="conversation-live-phrase frame-content__response">
                    <div className="conversation-live-phrase__scroll">
                        <span>{livePhrase || '\u00a0'}</span>
                    </div>
                </div>
                <ConversationLog
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
                }}
            >
                <VoiceProfilesPanel {...({
                    participants: voiceParticipants,
                    onRenameProfile,
                    onRenameSessionSpeaker: onRenameProfile,
                    onRemoveParticipant,
                })} />
            </PanelFrame>
        </FluTabPanel>
    );
}

export default FluConversationTabView;
