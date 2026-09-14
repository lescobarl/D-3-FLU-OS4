// ============================================================
// MinuteHistoryPanel — Tipos del componente OS2 (.jsx)
// ============================================================

import type { ReactElement } from 'react';

export interface MinuteHistoryEntry {
    id: string;
    [key: string]: unknown;
}

export interface MinuteHistoryPanelProps {
    entries?: readonly MinuteHistoryEntry[];
    selectedId?: string;
    onSelect?: (entry: MinuteHistoryEntry) => void;
    emptyLabel?: string;
}

export function MinuteHistoryPanel(props: MinuteHistoryPanelProps): ReactElement | null;
