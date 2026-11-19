// ============================================================
// FluSettingsTabView — Vista presentacional de la pestaña
// "Configuración" (Settings tab) del panel derecho.
// ------------------------------------------------------------
// Presentacional puro: recibe por props los valores ya resueltos
// en App (config de servicios, catálogos, perfiles, etc.) y agrupa
// los paneles de configuración de FLU. Contactos vive en el Pizarrón,
// no aquí. No declara hooks propios ni muta estado global.
// ============================================================
import { FluTabPanel } from '../voice/components/FluShellTabs';
import { PanelFrame } from '../voice/components/PanelFrame';
import { FluSettingsPanel, type FluSettingsPanelProps } from './FluSettingsPanel';
import { AmbientesPanel, type AmbientesPanelProps } from './AmbientesPanel';
import { PaletasPanel, type PaletasPanelProps } from './PaletasPanel';
import {
    AssistantSettingsPanel,
    type AssistantSettingsPanelProps,
} from './AssistantSettingsPanel';
import { ParticipantsPanel, type ParticipantsPanelProps } from './ParticipantsPanel';
import { BrowserProfilesPanel, type BrowserProfilesPanelProps } from './BrowserProfilesPanel';
import { SearchControlCenter, type SearchControlCenterProps } from './SearchControlCenter';
import { SettingsSaveProvider, SettingsSaveBar } from './SettingsSaveContext';

export interface FluSettingsTabViewProps {
    /** Tab activa del pizarrón (para FluTabPanel). */
    activeTab: string;
    /** Frame expandido actualmente (PanelFrame expandable). */
    expandedFrameId: string;
    /** Alterna la expansión de un frame por su id. */
    onToggleExpand: (frameId: string) => void;

    /** Panel de configuración de FLU (servicios, voz, branding, proveedor IA). */
    flu: FluSettingsPanelProps;
    /** Catálogo de ambientes dinámicos + built-ins. */
    ambientes: AmbientesPanelProps;
    /** Catálogo de paletas de temporada. */
    paletas: PaletasPanelProps;
    /** Asistente: canal de notificaciones, DND y replay de onboarding. */
    assistant: AssistantSettingsPanelProps;
    /** Participantes del hogar (registro + perfiles de comunicación). */
    participants: ParticipantsPanelProps;
    /** Perfiles de navegador curado por participante. */
    browser: BrowserProfilesPanelProps;
    /** Centro de control del buscador curado. */
    search: SearchControlCenterProps;
}

/**
 * Vista presentacional de la pestaña Configuración: renderiza los
 * paneles de configuración de FLU. Los bundles de props se resuelven
 * en App. Contactos se movió al Pizarrón (una sola montura).
 */
export function FluSettingsTabView({
    activeTab,
    expandedFrameId,
    onToggleExpand,
    flu,
    ambientes,
    paletas,
    assistant,
    participants,
    browser,
    search,
}: FluSettingsTabViewProps) {
    return (
        <FluTabPanel tabId="settings" activeTab={activeTab} className="flu-tab-panel--settings">
            <PanelFrame
                frameId="settings"
                title="Configuración"
                className="panel-frame--settings"
                expandable={true}
                {...{
                    expandedFrameId,
                    onToggleExpand,
                }}
            >
                <SettingsSaveProvider>
                    <section className="flu-settings-panel">
                        <FluSettingsPanel {...flu} />
                        <AmbientesPanel {...ambientes} />
                        <PaletasPanel {...paletas} />
                        <AssistantSettingsPanel {...assistant} />
                        <ParticipantsPanel {...participants} />
                        <BrowserProfilesPanel {...browser} />
                        <SearchControlCenter {...search} />

                        {/* Acción GLOBAL: un solo Guardar/Restablecer para todo el configurador */}
                        <SettingsSaveBar language={flu.language} />
                    </section>
                </SettingsSaveProvider>
            </PanelFrame>
        </FluTabPanel>
    );
}

export default FluSettingsTabView;
