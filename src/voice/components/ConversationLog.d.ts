// ============================================================
// ConversationLog — Tipos del componente OS2 (.jsx)
// ============================================================
// Declarado como const re-exportada con alias para no duplicar el símbolo
// exportado con el .jsx (detector D0).
// ============================================================

import type { NamedExoticComponent } from 'react';
import type { ConversationEntry } from '../../types/bridge';

export interface ConversationLogProps {
    entries?: readonly ConversationEntry[];
    emptyLabel?: string;
}

declare const ConversationLog: NamedExoticComponent<ConversationLogProps>;

export { ConversationLog };
