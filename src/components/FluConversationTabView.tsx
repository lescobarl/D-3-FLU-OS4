// ============================================================
// FluConversationTabView — Vista presentacional de la pestaña
// "Bitácora" (Conversation tab) del panel derecho.
// ------------------------------------------------------------
// Presentacional puro: recibe por props la transcripción en vivo,
// el historial de conversación y los participantes de voz. No
// declara hooks propios ni muta estado global. Etiquetas y títulos
// salen de FLU_CONFIG (Rule #1: NO HARDCODE).
// ============================================================
import { FLU_CONFIG } from '../voice/api/config';
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
     * Frase viva del reconocedor (misma fuente que la caja). Se pinta como la
     * primera fila de la bitácora mientras se dicta; al commitearla desaparece y
     * deja su lugar a la fila real. No se escribe en el store: es presentación.
     */
    liveTranscript: string;
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
    liveTranscript,
    conversationHistory,
    voiceParticipants,
    onRenameProfile,
    onRemoveParticipant,
}: FluConversationTabViewProps) {
    const ws = FLU_CONFIG.ui?.workspace || {};

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
                <ConversationLog
                    entries={conversationHistory}
                    liveText={liveTranscript}
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
