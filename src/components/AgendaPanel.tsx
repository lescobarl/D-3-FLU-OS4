// ============================================================
// src/components/AgendaPanel.tsx
// UI ÚNICA del calendario unificado: vista día/semana/mes.
// ------------------------------------------------------------
// Lee los items (ya filtrados por participante) y los colores derivados de
// FLU_CONFIG.agenda.colors. Reemplaza a HoyPanel/HorarioPizarron/RemindersPanel/
// TemporalItemsPanel. Borrado = lógico (onCancel → agendaService.cancel).
// ============================================================
import { useMemo, useState } from 'react';
import { summarizeAgenda } from '../core/agenda/agendaSummary';
import type { AgendaView } from '../core/agenda/agendaQuery';
import type { AgendaColorMap, AgendaItem } from '../core/agenda/agendaModel';

const VIEWS: ReadonlyArray<{ key: AgendaView; label: string }> = [
    { key: 'day', label: 'Hoy' },
    { key: 'week', label: 'Semana' },
    { key: 'month', label: 'Mes' },
];

export interface AgendaPanelProps {
    items: readonly AgendaItem[];
    colors: AgendaColorMap;
    onCancel?: (id: string) => void;
    /** Reloj inyectable (testeo); por defecto Date.now(). */
    now?: number;
}

export function AgendaPanel({ items, colors, onCancel, now }: AgendaPanelProps) {
    const [view, setView] = useState<AgendaView>('day');
    const summary = useMemo(
        () => summarizeAgenda(items, view, typeof now === 'number' ? now : Date.now(), colors),
        [items, view, colors, now],
    );

    return (
        <div className="agenda-panel" data-testid="agenda-panel">
            <div className="agenda-tabs" role="tablist">
                {VIEWS.map((v) => (
                    <button
                        key={v.key}
                        type="button"
                        role="tab"
                        data-testid={`agenda-view-${v.key}`}
                        aria-selected={view === v.key}
                        className={view === v.key ? 'active' : ''}
                        onClick={() => setView(v.key)}
                    >
                        {v.label}
                    </button>
                ))}
            </div>

            {summary.empty ? (
                <p data-testid="agenda-empty">Sin pendientes.</p>
            ) : (
                <ul className="agenda-list">
                    {summary.lines.map((line) => (
                        <li
                            key={line.id}
                            data-testid={`agenda-item-${line.id}`}
                            style={{ borderLeftColor: line.color }}
                        >
                            <span className="agenda-time">{line.time}</span>
                            <strong className="agenda-label">{line.label}</strong>
                            {onCancel ? (
                                <button
                                    type="button"
                                    data-testid={`agenda-cancel-${line.id}`}
                                    onClick={() => onCancel(line.id)}
                                    aria-label="Cancelar"
                                >
                                    ×
                                </button>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
