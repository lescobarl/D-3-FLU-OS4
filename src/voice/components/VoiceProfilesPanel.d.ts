// ============================================================
// VoiceProfilesPanel — Tipos del componente OS2 (.jsx)
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

export function VoiceProfilesPanel(props: VoiceProfilesPanelProps): ReactElement | null;
