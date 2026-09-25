// ============================================================
// FluWorkspaceTabView — Vista presentacional de la pestaña
// "Pizarrón" (Workspace tab) del panel derecho.
// ------------------------------------------------------------
// Presentacional puro: recibe por props el bundle completo del
// Pizarrón (WorkspaceHubProps, ya resuelto en App) y los controles
// de expansión de PanelFrame. No declara hooks propios ni muta
// estado global. Etiquetas y títulos salen de FLU_CONFIG.
// ============================================================
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { FluTabPanel } from '../voice/components/FluShellTabs';
import { PanelFrame } from '../voice/components/PanelFrame';
import { WorkspaceHub, type WorkspaceHubProps } from './WorkspaceHub';

export interface FluWorkspaceTabViewProps {
    /** Tab activa del pizarrón (para FluTabPanel). */
    activeTab: string;
    /** Frame expandido actualmente (PanelFrame expandable). */
    expandedFrameId: string;
    /** Alterna la expansión de un frame por su id. */
    onToggleExpand: (frameId: string) => void;
    /** Bundle de props del Pizarrón consolidado (resuelto en App). */
    hub: WorkspaceHubProps;
}

/**
 * Vista presentacional de la pestaña Pizarrón: envuelve el
 * WorkspaceHub consolidado en su PanelFrame expandible.
 */
export function FluWorkspaceTabView({
    activeTab,
    expandedFrameId,
    onToggleExpand,
    hub,
}: FluWorkspaceTabViewProps) {
    return (
        <FluTabPanel tabId="workspace" activeTab={activeTab} className="flu-tab-panel--workspace">
            <PanelFrame
                frameId={FLU_CONFIG.frames?.workspace || 'workspace'}
                title={FLU_CONFIG.ui?.workspace?.title || ''}
                className="panel-frame--workspace"
                expandable={true}
                {...{
                    expandedFrameId,
                    onToggleExpand,
                }}
            >
                <div className="frame-content frame-content--workspace">
                    <WorkspaceHub {...hub} />
                </div>
            </PanelFrame>
        </FluTabPanel>
    );
}

export default FluWorkspaceTabView;
