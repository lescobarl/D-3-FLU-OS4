// ============================================================
// VoiceProfilesPanel — Tipos del componente OS2 (.jsx)
// ============================================================
// Declarado como const re-exportada con alias para no duplicar el símbolo
// exportado con el .jsx (detector D0).
// ============================================================

import type { ReactElement } from 'react';

export interface VoiceProfileRow {
    label: string;
    profileId?: string;
    key?: string;
}

export interface VoiceProfilesPanelProps {
    participants?: readonly VoiceProfileRow[];
    onRenameProfile?: (profileId: string, label: string) => void | Promise<void>;
    onRenameSessionSpeaker?: (label: string, nextName: string) => void | Promise<void>;
    onRemoveParticipant?: (row: VoiceProfileRow) => void | Promise<void>;
}

declare const VoiceProfilesPanel: (props: VoiceProfilesPanelProps) => ReactElement | null;

export { VoiceProfilesPanel };
