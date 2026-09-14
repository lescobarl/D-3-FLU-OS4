// ============================================================
// PanelFrame — Tipos del componente OS2 (PanelFrame.jsx)
// ============================================================
// El componente real es JS sin tipos. Esta declaración fija la interfaz que
// consumen las vistas para no recurrir a casts laxos.
// ============================================================

import type { ReactElement, ReactNode } from 'react';

export interface PanelFrameProps {
    frameId: string;
    title: string;
    subtitle?: string;
    expandedFrameId?: string;
    onToggleExpand?: (frameId: string) => void;
    headerActions?: ReactNode;
    className?: string;
    expandable?: boolean;
    children?: ReactNode;
}

export function PanelFrame(props: PanelFrameProps): ReactElement | null;
