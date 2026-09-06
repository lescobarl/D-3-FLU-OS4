// ============================================================
// FluSystemTabView — Vista presentacional de la pestaña "Sistemas
// Autónomos" (System tab) del panel derecho.
// ------------------------------------------------------------
// Presentacional puro: recibe por props el estado de autonomía
// (state/actions) y los controles de expansión de PanelFrame.
// No declara hooks propios ni muta estado global.
// ============================================================
import { FluTabPanel } from '../voice/components/FluShellTabs';
import { PanelFrame } from '../voice/components/PanelFrame';
import { AutonomyStatusPanel, type AutonomyState, type AutonomyActions } from '../core/autonomy';

export interface FluSystemTabViewProps {
    /** Tab activa del pizarrón (para FluTabPanel). */
    activeTab: string;
    /** Frame expandido actualmente (PanelFrame expandable). */
    expandedFrameId: string;
    /** Alterna la expansión de un frame por su id. */
    onToggleExpand: (frameId: string) => void;
    /** Estado consolidado de los sistemas autónomos. */
    state: AutonomyState;
    /** Acciones de control de los sistemas autónomos. */
    actions: AutonomyActions;
}

/**
 * Vista presentacional de la pestaña System: envuelve el panel de
 * monitoreo de sistemas autónomos en su PanelFrame expandible.
 */
export function FluSystemTabView({
    activeTab,
    expandedFrameId,
    onToggleExpand,
    state,
    actions,
}: FluSystemTabViewProps) {
    return (
        <FluTabPanel tabId="system" activeTab={activeTab} className="flu-tab-panel--system">
            <PanelFrame
                frameId="autonomy"
                title="Sistemas Autónomos"
                className="panel-frame--autonomy"
                expandable={true}
                {...{
                    expandedFrameId,
                    onToggleExpand,
                } as any}
            >
                <AutonomyStatusPanel state={state} actions={actions} />
            </PanelFrame>
        </FluTabPanel>
    );
}

export default FluSystemTabView;
