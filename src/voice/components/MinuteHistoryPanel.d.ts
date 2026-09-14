// ============================================================
// MinuteHistoryPanel — Tipos del componente OS2 (.jsx)
// ============================================================
// Declarado como const re-exportada con alias para no duplicar el símbolo
// exportado con el .jsx (detector D0).
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

declare const MinuteHistoryPanel: (props: MinuteHistoryPanelProps) => ReactElement | null;

export { MinuteHistoryPanel };
