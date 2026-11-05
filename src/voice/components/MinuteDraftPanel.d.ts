// ============================================================
// MinuteDraftPanel — Tipos del componente OS2 (.jsx)
// ============================================================
// Declarado como const re-exportada con alias para no duplicar el símbolo
// exportado con el .jsx (detector D0).
// ============================================================

import type { ForwardRefExoticComponent, RefAttributes } from 'react';
import type { MinuteDraft } from '../../hooks/useMinuteHandlers';

export interface MinuteDraftHandle {
    save: () => void;
}

export interface MinuteDraftPanelProps {
    draft?: MinuteDraft | null;
    onChange?: (draft: MinuteDraft) => void;
    onSave?: (draft: MinuteDraft) => void;
    emptyLabel?: string;
}

declare const MinuteDraftPanel: ForwardRefExoticComponent<
    MinuteDraftPanelProps & RefAttributes<MinuteDraftHandle>
>;

export { MinuteDraftPanel };
