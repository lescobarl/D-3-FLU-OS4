// ============================================================
// MinuteHistoryPanel — Tipos del componente OS2 (.jsx)
// ============================================================
// Declarado como const re-exportada con alias para no duplicar el símbolo
// exportado con el .jsx (detector D0).
// ============================================================

import type { ReactElement } from 'react';
import type { MinuteUIEntry } from '../../hooks/useMinuteKnowledge';

export type MinuteHistoryEntry = MinuteUIEntry;

export interface MinuteHistoryPanelProps {
    entries?: readonly MinuteUIEntry[];
    selectedId?: string;
    onSelect?: (entry: MinuteUIEntry) => void;
    emptyLabel?: string;
}

declare const MinuteHistoryPanel: (props: MinuteHistoryPanelProps) => ReactElement | null;

export { MinuteHistoryPanel };
