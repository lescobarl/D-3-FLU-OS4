// ============================================================
// FluSettingsTabView — Vista presentacional de la pestaña
// "Configuración" (Settings tab) del panel derecho.
// ------------------------------------------------------------
// Presentacional puro: recibe por props los valores ya resueltos
// en App (config de servicios, catálogos, perfiles, etc.) y agrupa
// los paneles en sus secciones FLU / Mis datos / Gestión. No
// declara hooks propios ni muta estado global.
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
import { ContactsPanel, type ContactsPanelProps } from './ContactsPanel';
import { RemindersPanel, type RemindersPanelProps } from './RemindersPanel';
import { TemporalItemsPanel, type TemporalItemsPanelProps } from './TemporalItemsPanel';
import { ShoppingPanel, type ShoppingPanelProps } from './ShoppingPanel';
import { MateriaGrisPanel, type MateriaGrisPanelProps } from './MateriaGrisPanel';

// Sub-secciones del panel de Ajustes (Fase A2): FLU / Mis datos / Gestión.
export type SettingsGroupId = 'flu' | 'data' | 'management';

export const SETTINGS_GROUPS: ReadonlyArray<{ id: SettingsGroupId; label: string }> = [
    { id: 'flu', label: 'FLU' },
    { id: 'data', label: 'Mis datos' },
    { id: 'management', label: 'Gestión' },
];

export interface FluSettingsTabViewProps {
    /** Tab activa del pizarrón (para FluTabPanel). */
    activeTab: string;
    /** Frame expandido actualmente (PanelFrame expandable). */
    expandedFrameId: string;
    /** Alterna la expansión de un frame por su id. */
    onToggleExpand: (frameId: string) => void;
    /** Sub-sección activa del panel de Ajustes (FLU / Mis datos / Gestión). */
    group: SettingsGroupId;
    /** Cambia la sub-sección activa del panel de Ajustes. */
    onGroupChange: (group: SettingsGroupId) => void;

    // ---- Grupo FLU — identidad, voz y participantes ----
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

    // ---- Grupo Mis datos — agenda personal ----
    /** Contactos de la agenda personal. */
    contacts: ContactsPanelProps;

    // ---- Grupo Gestión — recordatorios, compras y reconocimiento ----
    /** Recordatorios por autor. */
    reminders: RemindersPanelProps;
    /** Alarmas y temporizadores. */
    temporals: TemporalItemsPanelProps;
    /** Lista de compras. */
    shopping: ShoppingPanelProps;
    /** Tabla de reconocimiento (materia gris). */
    materiaGris: MateriaGrisPanelProps;
}

/**
 * Vista presentacional de la pestaña Configuración: renderiza el
 * sub-menú de secciones y los paneles agrupados (FLU / Mis datos /
 * Gestión). Los bundles de props de cada panel se resuelven en App.
 */
export function FluSettingsTabView({
    activeTab,
    expandedFrameId,
    onToggleExpand,
    group,
    onGroupChange,
    flu,
    ambientes,
    paletas,
    assistant,
    participants,
    browser,
    search,
    contacts,
    reminders,
    temporals,
    shopping,
    materiaGris,
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
                {/* Sub-menú de secciones (Fase A2): mismas pestañas, mismo estado, agrupación visual */}
                <div className="flu-settings-groups" role="tablist" aria-label="Secciones de ajustes">
                    {SETTINGS_GROUPS.map((grp) => (
                        <button
                            key={grp.id}
                            type="button"
                            role="tab"
                            aria-selected={group === grp.id}
                            className={[
                                'flu-settings-groups__pill',
                                group === grp.id ? 'is-active' : '',
                            ]
                                .filter(Boolean)
                                .join(' ')}
                            onClick={() => onGroupChange(grp.id)}
                        >
                            {grp.label}
                        </button>
                    ))}
                </div>

                {/* Grupo FLU — identidad, voz y participantes */}
                <div
                    className="flu-settings-group flu-settings-group--flu"
                    role="tabpanel"
                    hidden={group !== 'flu'}
                >
                    <FluSettingsPanel {...flu} />
                    <AmbientesPanel {...ambientes} />
                    <PaletasPanel {...paletas} />
                    <AssistantSettingsPanel {...assistant} />
                    <ParticipantsPanel {...participants} />
                    <BrowserProfilesPanel {...browser} />
                    <SearchControlCenter {...search} />
                </div>

                {/* Grupo Mis datos — agenda personal */}
                <div
                    className="flu-settings-group flu-settings-group--data"
                    role="tabpanel"
                    hidden={group !== 'data'}
                >
                    <ContactsPanel {...contacts} />
                </div>

                {/* Grupo Gestión — recordatorios, compras y reconocimiento */}
                <div
                    className="flu-settings-group flu-settings-group--management"
                    role="tabpanel"
                    hidden={group !== 'management'}
                >
                    <RemindersPanel {...reminders} />
                    <TemporalItemsPanel {...temporals} />
                    <ShoppingPanel {...shopping} />
                    <MateriaGrisPanel {...materiaGris} />
                </div>

                {/* Acción GLOBAL: un solo Guardar/Restablecer para todo el configurador */}
                <SettingsSaveBar language={flu.language} />
                </SettingsSaveProvider>
            </PanelFrame>
        </FluTabPanel>
    );
}

export default FluSettingsTabView;
