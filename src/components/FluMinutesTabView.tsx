// ============================================================
// FluMinutesTabView — Vista presentacional de la pestaña
// "Minutas" (Minutes tab) del panel derecho.
// ------------------------------------------------------------
// Presentacional puro: recibe por props el borrador de minuta, el
// historial y los handlers de generación/guardado. No declara
// hooks propios ni muta estado global. Etiquetas y títulos salen
// de FLU_CONFIG (Rule #1: NO HARDCODE).
// ============================================================
import type { RefObject } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { FluTabPanel } from '../voice/components/FluShellTabs';
import { PanelFrame } from '../voice/components/PanelFrame';
import { MinuteDraftPanel } from '../voice/components/MinuteDraftPanel';
import { MinuteHistoryPanel } from '../voice/components/MinuteHistoryPanel';
import type { MinuteUIEntry } from '../hooks/useMinuteKnowledge';
import type { MinuteDraft } from '../hooks/useMinuteHandlers';

export interface FluMinutesTabViewProps {
    /** Tab activa del pizarrón (para FluTabPanel). */
    activeTab: string;
    /** Frame expandido actualmente (PanelFrame expandable). */
    expandedFrameId: string;
    /** Alterna la expansión de un frame por su id. */
    onToggleExpand: (frameId: string) => void;
    /** Indica si la plataforma soporta voz (habilita generar minuta). */
    isSupported: boolean;
    /** True mientras se resume/genera la minuta con IA. */
    isSummarizing: boolean;
    /** Genera/resume la minuta desde la conversación (con anuncio de voz). */
    onGenerateSummary: (opts?: { announce?: boolean; save?: boolean }) => Promise<boolean>;
    /** Borrador de minuta en edición. */
    draft: MinuteDraft | null;
    /** Actualiza el borrador de minuta en edición. */
    onDraftChange: (draft: MinuteDraft | null) => void;
    /** Guarda la minuta (draft) en IndexedDB. */
    onSaveMinute: (draftOverride?: MinuteDraft | null, opts?: { announce?: boolean }) => Promise<void>;
    /** Ref expuesta por MinuteDraftPanel para disparar su .save() interno. */
    minutePanelRef: RefObject<{ save: () => void } | null>;
    /** Historial de minutas persistidas. */
    history: readonly MinuteUIEntry[];
    /** Minuta seleccionada del historial (id). */
    selectedId: string | null;
    /** Carga una minuta del historial al editar. */
    onSelect: (entry: MinuteUIEntry) => void;
}

/**
 * Vista presentacional de la pestaña Minutes: acciones de
 * generación/guardado, borrador de la minuta y su historial.
 */
export function FluMinutesTabView({
    activeTab,
    expandedFrameId,
    onToggleExpand,
    isSupported,
    isSummarizing,
    onGenerateSummary,
    draft,
    onDraftChange,
    onSaveMinute,
    minutePanelRef,
    history,
    selectedId,
    onSelect,
}: FluMinutesTabViewProps) {
    const ws = FLU_CONFIG.ui?.workspace || {};

    return (
        <FluTabPanel tabId="minutes" activeTab={activeTab} className="flu-tab-panel--minutes">
            <PanelFrame
                frameId={FLU_CONFIG.frames?.minute || 'minute'}
                title={ws.visibleLabels?.summary || 'Minuta'}
                className="panel-frame--minute"
                expandable={true}
                {...{
                    expandedFrameId,
                    onToggleExpand,
                }}
            >
                <div className="minute-actions-row" style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                    <button
                        type="button"
                        className="flu-btn flu-btn--primary"
                        onClick={() => onGenerateSummary({ announce: true })}
                        disabled={!isSupported || isSummarizing}
                    >
                        {isSummarizing
                            ? `${FLU_CONFIG.ui?.buttons?.generateMinute || 'Generar Minuta'}...`
                            : FLU_CONFIG.ui?.buttons?.generateMinute || 'Generar Minuta'}
                    </button>
                    <button
                        type="button"
                        className="flu-btn"
                        onClick={() => minutePanelRef.current?.save()}
                    >
                        {FLU_CONFIG.ui?.buttons?.saveMinute || 'Guardar Minuta'}
                    </button>
                </div>
                <MinuteDraftPanel
                    ref={minutePanelRef}
                    draft={draft}
                    onChange={onDraftChange}
                    onSave={onSaveMinute}
                    emptyLabel={ws.minuteDraftEmpty || 'Sin borrador de minuta'}
                />
            </PanelFrame>

            <PanelFrame
                frameId={FLU_CONFIG.frames?.history || 'history'}
                title={ws.visibleLabels?.history || 'Historial de minutas'}
                className="panel-frame--history"
                expandable={true}
                {...{
                    expandedFrameId,
                    onToggleExpand,
                }}
            >
                <MinuteHistoryPanel
                    entries={history}
                    selectedId={selectedId || undefined}
                    onSelect={onSelect}
                    emptyLabel={ws.minuteHistoryEmpty || 'Sin minutas guardadas'}
                />
            </PanelFrame>
        </FluTabPanel>
    );
}

export default FluMinutesTabView;
